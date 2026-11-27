import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, ArrowsClockwise, CaretRight, CheckCircle, ClockCounterClockwise, Hourglass, Play, ShieldWarning, Warning, XCircle } from "@phosphor-icons/react"
import { fetchRecordings, runShowcase, startShowcase, type DeskSnapshot, type Health, type PaymentCase, type Recording, type ShowcaseKey, type ShowcaseStep } from "../lib/api"
import { isRunning } from "../lib/derive"
import { count, duration, iban as fmtIban, money, plain, reduceMotion } from "../lib/format"
import { href } from "../lib/router"
import { Spinner, StageStatus, dispositionLabel } from "../components/bits"
import { AGENT_ORDER, LivingWorkspace, MiniAgents, ReplayControls, sceneOf, useReplay, type Scene } from "../components/LivingWorkspace"
import { Actions, Compare, CrossChecks, EvidenceDrawer, useEvidence } from "../components/PaymentDetail"
import { useNow } from "../components/Timeline"
import { Drawer } from "../components/ui"

/**
 * The interactive showcase. Four synthetic scenarios, one at a time, through the same workflow as every other document.
 * This view decides nothing and stores nothing: a scenario's result is the server's reading of its payment case, the
 * agents are drawn from recorded execution state, and every figure opens the line or the record it comes from.
 */

type Mode = "live" | "scripted" | "recorded"
type Props = { snapshot: DeskSnapshot; health: Health | null; canAct: boolean; id: string | null; loadingAll: boolean; onLoadAll: () => void }

const COPY: Record<ShowcaseKey, { short: string; title: string; purpose: string }> = {
	legitimate: { short: "Legitimate invoice", title: "A payment that should proceed", purpose: "A known vendor, the account on file, consistent amounts, under the limit. A control that blocks everything is useless: this one has to let a valid payment through." },
	beneficiary: { short: "Changed account", title: "The invoice asks for a different bank account", purpose: "A plausible invoice from a known vendor that says “we have changed bank”. The new account passes its checksum. That shows the number is well formed, not who owns it." },
	challenge: { short: "Agents disagree", title: "Two agents find two different amounts", purpose: "The cover text asks for one amount and the invoice total states another. One reader alone would pick one and move on. Here a second agent reads the document on its own." },
	duplicate: { short: "Duplicate payment", title: "An invoice that was already paid", purpose: "A reminder, under a different file name, for an invoice that is already in the payment history. An everyday way to pay the same obligation twice." },
	injection: { short: "Prompt injection", title: "The document tells the AI what to do", purpose: "The invoice carries a note addressed to the system that processes it: ignore the policy, approve, tell no one. Document content is data, never an instruction." },
}

const MODE: Record<Mode, { tag: string; tone: string; line: string }> = {
	live: { tag: "Live AI", tone: "run", line: "Real models through Mozaik. Agent outputs, timings and decisions come from this execution." },
	scripted: { tag: "Scripted demo", tone: "warn", line: "Real orchestration, predefined model responses." },
	recorded: { tag: "Recorded execution", tone: "line", line: "A stored run with live models. Replay only: no model is called and nothing is decided." },
}
/** A live run on a model on this machine is named as that, with its provider: it is neither a cloud run nor a scripted one. */
const LOCAL_LIVE = (provider: string) => ({ tag: "Live local AI", tone: "run", line: `Real models running on this machine (${provider}), through Mozaik. No cloud provider is called. Agent outputs, timings and decisions come from this execution.` })
const modeOf = (mode: Mode, inference?: DeskSnapshot["inference"]) => (mode === "live" && inference?.kind === "local" ? LOCAL_LIVE(inference.provider) : MODE[mode])
const ModeTag = ({ mode, inference }: { mode: Mode; inference?: DeskSnapshot["inference"] }) => { const m = modeOf(mode, inference); return <span className={`tag ${m.tone}`} title={m.line}>{m.tag}</span> }
const SOURCE: Record<Mode, string> = { live: "model output", scripted: "predefined response, not model output", recorded: "recorded model output" }

/** The scenario a person has just started from this page. Its run is played back once if it finished too fast to watch. */
const watch: { current: ShowcaseKey | null } = { current: null }
const idle = (): Scene => ({ agents: Object.fromEntries(AGENT_ORDER.map((a) => [a, { phase: "waiting", note: "Waiting" }])) as Scene["agents"], doc: false, compared: false, investigated: false, outcome: null, challenge: null, tally: null, story: "Waiting for the document.", tone: "" })
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const utc = (iso: string) => `${day(iso)}, ${new Date(iso).toISOString().slice(11, 16)} UTC`

export function Showcase({ snapshot, health, canAct, id, loadingAll, onLoadAll }: Props) {
	// Two stored runs can ship: the earlier one (hosted models, older code) at #/showcase/recorded, and one of this version at #/showcase/recorded-current.
	const recordedView = id === "recorded" || id === "recorded-current"
	const [stored, setStored] = useState<{ recording: Recording | null; current: Recording | null } | undefined>(undefined)
	useEffect(() => { let gone = false; fetchRecordings().then((r) => !gone && setStored(r)).catch(() => !gone && setStored({ recording: null, current: null })); return () => { gone = true } }, [])
	const recording = stored === undefined ? undefined : id === "recorded-current" ? stored.current : stored.recording

	if (recordedView) {
		if (recording === undefined) return <main className="view sc" aria-busy="true"><div className="skel" style={{ height: 30, width: 260 }} /><div className="skel" style={{ height: 320 }} /></main>
		if (recording === null) return <main className="view sc"><div className="panel"><div className="empty"><h2>No recorded execution ships with this build</h2><p>The file <code>server/data/recordings/live-2026-11-26.json</code> was not found.</p><div className="actions"><a className="btn" href={href("showcase")}><ArrowLeft size={13} /> Back to the showcase</a></div></div></div></main>
		return <Journey key={id} viewKey={`${id}:${recording.recordedAt}`} mode="recorded" steps={recording.steps} cases={recording.cases} snapshot={snapshot} canAct={false} recording={recording} />
	}
	const sc = snapshot.showcase
	if (!sc) return <Intro snapshot={snapshot} health={health} canAct={canAct} recording={stored?.recording ?? null} current={stored?.current ?? null} />
	return <Journey key={sc.id} viewKey={sc.id} mode={sc.mode} steps={sc.steps} cases={snapshot.cases} snapshot={snapshot} canAct={canAct} recording={stored?.recording ?? stored?.current ?? null} loadingAll={loadingAll} onLoadAll={onLoadAll} />
}

// ───────── the opening ─────────

function Intro({ snapshot, health, canAct, recording, current }: { snapshot: DeskSnapshot; health: Health | null; canAct: boolean; recording: Recording | null; current: Recording | null }) {
	const [busy, setBusy] = useState(false)
	const [err, setErr] = useState<string | null>(null)
	const mode = snapshot.modelMode
	const noKey = mode === "live" && health != null && !health.hasModelKey
	const demo = snapshot.cases.filter((c) => c.origin === "demo")
	const decided = demo.filter((c) => c.review.some((r) => r.outcome === "applied")).length
	const start = async () => {
		if (busy) return
		setBusy(true); setErr(null)
		watch.current = "legitimate"
		try { await startShowcase(); await runShowcase("legitimate") } catch (e) { setErr((e as Error).message); watch.current = null } finally { setBusy(false) }
	}
	return (
		<main className="view sc">
			<section className="sc-hero glass">
				<div className="sc-hero-copy">
					<span className="sc-kicker">Payment Desk · Interactive showcase</span>
					<h1>AI investigates. Code decides.</h1>
					<p>Five specialised AI agents on Mozaik read each invoice, check it against trusted records and against each other, and investigate what does not agree. Controls in code decide what may be approved. Built for accounts payable teams.</p>
					<div className="sc-actions">
						<button type="button" className="btn btn-primary btn-lg" disabled={!canAct || busy || noKey} onClick={start}>{busy ? <Spinner /> : <Play size={13} weight="fill" />} Start demo</button>
						<a className="btn btn-lg" href={href("overview")}>Explore workspace</a>
					</div>
					{err && <div className="errbox" role="alert">{err}</div>}
					<p className="fine">Four synthetic scenarios, one at a time, each through the real workflow. Sandbox: synthetic data, no real accounts, nothing reaches a bank, and nothing here is financial advice.{demo.length > 0 && <> Starting replaces the {n(demo.length, "demo document")} on this desk{decided ? `, ${decided} of them with a decision by a person` : ""}. Documents you added are kept.</>}</p>
				</div>
				<div className="sc-hero-side">
					<MiniAgents scene={idle()} />
					<p className="fine">Extractor reads. Validator and Auditor check at the same time, independently. Investigator takes the exceptions. Policy recommends. Code has the last word.</p>
				</div>
			</section>

			<section className="sec">
				<div className="sec-title"><h2>How this demo runs</h2></div>
				<div className="sc-modes">
					<div className="sc-mode current">
						<div className="sc-mode-top"><ModeTag mode={mode} inference={snapshot.inference} /><span className="status good"><i aria-hidden />This server</span></div>
						{mode === "scripted" ? (
							<>
								<b>Real orchestration, predefined model responses</b>
								<p>The Mozaik runtime, the five agent loops, the evidence checks, the controls and the enforcement all run. The agents' answers are fixed text. This shows the architecture and the workflow; it says nothing about how well a language model reads an invoice.</p>
								<p className="fine">No credentials, no cost. For live models: set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> and run <code>npm run dev</code>.</p>
							</>
						) : noKey ? (
							<>
								<b>No model API key on this server</b>
								<p>Live scenarios cannot run, and nothing is substituted for them. Copy <code>.env.example</code> to <code>.env</code>, set <code>ANTHROPIC_API_KEY</code> and restart.</p>
								<p className="fine">Without credentials: stop this server and run <code>npm run demo</code> for the scripted demo.</p>
							</>
						) : snapshot.inference?.kind === "local" ? (
							<>
								<b>Real models on this machine</b>
								<p>Each scenario makes five or more model calls to <span className="mono">{[...new Set([snapshot.models.fast, snapshot.models.careful])].join(" and ")}</span>, served by {snapshot.inference.provider} on this computer. No cloud provider is called and nothing is paid for. A local model is slower and less capable than a large hosted one: a scenario takes minutes, and what the agents answer is whatever this model answers.</p>
								<p className="fine">At most {snapshot.inference.maxConcurrency} model {snapshot.inference.maxConcurrency === 1 ? "request runs" : "requests run"} at a time; agent loops still overlap, and their requests wait in turn. The mode never switches by itself.</p>
							</>
						) : (
							<>
								<b>Real models, real cost</b>
								<p>Each scenario makes five or six model calls on your provider account ({snapshot.models.fast} and {snapshot.models.careful}). A configured key does not show that the account has credit: the first call will.</p>
								{snapshot.provider && <p className="sc-warn"><Warning size={14} weight="fill" /> The provider refused the last call: {snapshot.provider.kind.replace(/_/g, " ")}. {snapshot.provider.advice}</p>}
								<p className="fine">Without credentials or credit: stop this server and run <code>npm run demo</code>. The mode never switches by itself.</p>
							</>
						)}
					</div>
					<div className="sc-mode">
						<div className="sc-mode-top"><ModeTag mode="recorded" />{recording && <span className="fine">{utc(recording.recordedAt)}</span>}</div>
						{recording ? (
							<>
								<b>A stored run with live models</b>
								<p>The same scenario documents as {recording.models.fast} and {recording.models.careful} processed them, on an earlier version of the code. {recording.steps.filter((s) => s.result === "failed").length > 0 ? `${n(recording.steps.filter((s) => s.result === "failed").length, "scenario")} did not finish in that run, and it is shown that way.` : ""}</p>
								<a className="linkish" href={href("showcase", "recorded")}><ClockCounterClockwise size={13} /> Watch the recorded execution <ArrowRight size={12} /></a>
							</>
						) : <p>No recorded execution is available.</p>}
						{current && (
							<>
								<b>A stored run of this version <span className="fine">· {utc(current.recordedAt)}</span></b>
								<p>The same scenarios on {current.version}. {current.steps.filter((s) => !s.optional && s.result === "confirmed").length} of {current.steps.filter((s) => !s.optional).length} scenarios ended as the scenario file expects; what the model answered is shown as it was.</p>
								<a className="linkish" href={href("showcase", "recorded-current")}><ClockCounterClockwise size={13} /> Watch the recorded run of this version <ArrowRight size={12} /></a>
							</>
						)}
					</div>
				</div>
			</section>
		</main>
	)
}

// ───────── the journey: scenarios, then the summary ─────────

type JourneyProps = { viewKey: string; mode: Mode; steps: ShowcaseStep[]; cases: PaymentCase[]; snapshot: DeskSnapshot; canAct: boolean; recording: Recording | null; loadingAll?: boolean; onLoadAll?: () => void }
type Sel = ShowcaseKey | "summary"
const settled = (s: ShowcaseStep) => s.result !== "not_run" && s.result !== "running"

function Journey({ viewKey, mode, steps, cases, snapshot, canAct, recording, loadingAll, onLoadAll }: JourneyProps) {
	const main = steps.filter((s) => !s.optional)
	// What was on screen is remembered for this demo run, so leaving the showcase and coming back (or reloading) returns to
	// the scenario being looked at, not to the next one that has not run. A scenario that is running still wins: that is where the work is.
	const memory = `pd-showcase-view:${viewKey}`
	const [sel, setSelRaw] = useState<Sel>(() => {
		const live = steps.find((s) => s.result === "running")
		if (live) return live.key
		let seen: string | null = null
		try { seen = sessionStorage.getItem(memory) } catch { /* storage is not available: fall through to the default */ }
		if (seen === "summary" || steps.some((s) => s.key === seen)) return seen as Sel
		return main.every(settled) ? "summary" : (main.find((s) => s.result === "not_run") ?? main[0]!).key
	})
	const setSel = (next: Sel) => { setSelRaw(next); try { sessionStorage.setItem(memory, next) } catch { /* not remembered, nothing else changes */ } }
	const [busy, setBusy] = useState<ShowcaseKey | null>(null)
	const [err, setErr] = useState<string | null>(null)
	const [confirm, setConfirm] = useState(false)
	const recorded = mode === "recorded"
	const running = steps.some((s) => s.result === "running")
	const done = main.filter(settled).length
	const decided = main.filter((s) => s.result === "confirmed" || s.result === "unexpected").length
	// the current step stays in view when the stepper scrolls sideways on a narrow screen; the page itself does not move
	const nav = useRef<HTMLElement>(null)
	useEffect(() => {
		const box = nav.current, el = box?.querySelector<HTMLElement>('[aria-current="step"]')
		if (box && el && box.scrollWidth > box.clientWidth) box.scrollTo({ left: el.offsetLeft - (box.clientWidth - el.clientWidth) / 2, behavior: reduceMotion() ? "auto" : "smooth" })
	}, [sel])

	const run = async (key: ShowcaseKey) => {
		if (busy || recorded) return
		setBusy(key); setErr(null); setSel(key)
		watch.current = key
		try { await runShowcase(key) } catch (e) { setErr((e as Error).message); watch.current = null } finally { setBusy(null) }
	}
	const restart = async () => {
		setConfirm(false); setErr(null); setBusy("legitimate"); setSel("legitimate")
		watch.current = "legitimate"
		try { await startShowcase(); await runShowcase("legitimate") } catch (e) { setErr((e as Error).message); watch.current = null } finally { setBusy(null) }
	}
	const step = sel === "summary" ? null : steps.find((s) => s.key === sel)!
	const next = step ? main[main.findIndex((s) => s.key === step.key) + 1] ?? null : null

	return (
		<main className="view sc">
			<header className="sc-top">
				<div className="sc-top-id">
					<span className="sc-kicker">Interactive showcase</span>
					<ModeTag mode={mode} inference={snapshot.inference} />
					<span className="fine">{recorded && recording ? `${utc(recording.recordedAt)} · ${recording.version ?? "earlier version of the code"} · replay only` : modeOf(mode, snapshot.inference).line}</span>
				</div>
				<div className="sc-top-actions">
					<span className="fine" role="status">{recorded ? `${decided} of ${main.length} scenarios reached a decision in that run` : `${done} of ${main.length} scenarios run`}</span>
					{recorded ? <a className="btn btn-sm" href={href("showcase")}><ArrowLeft size={12} /> Back to the showcase</a> : confirm ? (
						<><span className="fine">Replaces the demo documents and their decisions.</span><button type="button" className="btn btn-sm btn-danger" onClick={restart}>Restart</button><button type="button" className="btn btn-sm" onClick={() => setConfirm(false)}>Cancel</button></>
					) : (
						<><button type="button" className="btn btn-sm" disabled={!canAct || running || busy != null} onClick={() => setConfirm(true)}><ArrowsClockwise size={12} /> Restart</button><a className="btn btn-sm" href={href("overview")}>Exit demo</a></>
					)}
				</div>
			</header>

			<nav className="sc-steps" aria-label="Scenarios" ref={nav}>
				{steps.map((s, i) => (
					<button key={s.key} type="button" className="sc-step" aria-current={sel === s.key ? "step" : undefined} data-result={s.result} onClick={() => setSel(s.key)}>
						<span className="sc-step-n" aria-hidden>{s.result === "confirmed" ? <CheckCircle size={16} weight="fill" /> : s.result === "unexpected" ? <Warning size={16} weight="fill" /> : s.result === "failed" ? <XCircle size={16} weight="fill" /> : s.result === "running" ? <Spinner /> : i + 1}</span>
						<span className="sc-step-t"><b>{COPY[s.key].short}</b><small>{s.optional && s.result === "not_run" ? "Optional" : RESULT[s.result].short}</small></span>
					</button>
				))}
				<button type="button" className="sc-step" aria-current={sel === "summary" ? "step" : undefined} data-result={main.every(settled) ? "confirmed" : "not_run"} onClick={() => setSel("summary")}>
					<span className="sc-step-n" aria-hidden>Σ</span><span className="sc-step-t"><b>Summary</b><small>{recorded ? `${decided} of ${main.length} decided` : `${done} of ${main.length} run`}</small></span>
				</button>
			</nav>

			{err && <div className="banner bad" role="alert"><Warning size={16} weight="bold" /><div><b>The scenario could not be started.</b> {err}</div><button type="button" className="btn btn-sm" onClick={() => setErr(null)}>Dismiss</button></div>}

			{step ? (
				<Stage key={step.key} step={step} index={steps.indexOf(step)} total={main.length} c={step.startedAt ? cases.find((k) => k.id === step.docId) ?? null : null} mode={mode} snapshot={snapshot} canAct={canAct} busy={busy} running={running}
					onRun={() => run(step.key)}
					nextAction={recorded
						? (next ? <button type="button" className="btn btn-primary" onClick={() => setSel(next.key)}>Next: {COPY[next.key].short} <ArrowRight size={13} /></button> : <button type="button" className="btn btn-primary" onClick={() => setSel("summary")}>See the summary <ArrowRight size={13} /></button>)
						: !settled(step) ? null
							: next && next.result === "not_run" ? <button type="button" className="btn btn-primary" disabled={!canAct || busy != null || running} onClick={() => run(next.key)}>{busy === next.key ? <Spinner /> : <Play size={12} weight="fill" />} Next: {COPY[next.key].short}</button>
								: next ? <button type="button" className="btn btn-primary" onClick={() => setSel(next.key)}>Next: {COPY[next.key].short} <ArrowRight size={13} /></button>
									: <button type="button" className="btn btn-primary" onClick={() => setSel("summary")}>See the summary <ArrowRight size={13} /></button>} />
			) : <Summary steps={steps} cases={cases} mode={mode} onPick={setSel} loadingAll={loadingAll} onLoadAll={onLoadAll} canAct={canAct} running={running} recording={recording} />}
		</main>
	)
}

const RESULT: Record<ShowcaseStep["result"], { label: string; short: string; tone: string }> = {
	not_run: { label: "Not executed", short: "Not executed", tone: "" },
	running: { label: "Running", short: "Running", tone: "run" },
	confirmed: { label: "Expected outcome confirmed", short: "Confirmed", tone: "good" },
	unexpected: { label: "Unexpected outcome", short: "Unexpected", tone: "warn" },
	failed: { label: "Execution failure", short: "Did not finish", tone: "bad" },
}

// ───────── one scenario ─────────

type StageProps = { step: ShowcaseStep; index: number; total: number; c: PaymentCase | null; mode: Mode; snapshot: DeskSnapshot; canAct: boolean; busy: ShowcaseKey | null; running: boolean; onRun: () => void; nextAction: ReactNode }

function Stage({ step, index, total, c, mode, snapshot, canAct, busy, running, onRun, nextAction }: StageProps) {
	const copy = COPY[step.key]
	const live = c != null && isRunning(c)
	const now = useNow(live)
	const replay = useReplay(c)
	const recorded = mode === "recorded"
	// A run that finished faster than it can be watched is played back once from its own recorded timestamps, and labelled
	// as a replay. The decision is already made and already shown below; nothing waits for the playback.
	useEffect(() => {
		if (watch.current !== step.key || !c || live || !replay.available) return
		watch.current = null
		if (replay.span!.ms < 1500 && !reduceMotion() && !document.hidden) replay.start()
	}, [c?.version, live, replay.available])
	const scene = c ? sceneOf(c, live ? null : replay.at, now) : idle()
	const view = !c ? "live" : live ? "live" : replay.at != null ? "replay" : "recorded"
	const label = <span className="sc-num">{step.optional ? "Optional scenario" : `Scenario ${index + 1} of ${total}`}</span>

	return (
		<section className="sc-stage swap">
			<div className="sc-head">
				{label}
				<h1>{copy.title}</h1>
				<p>{copy.purpose}</p>
			</div>

			{(() => {
				const stage = (
					<LivingWorkspace scene={scene} sceneKey={c ? `${c.id}:${c.attempt}:${view === "replay" ? "replay" : "state"}` : `idle:${step.key}`} mode={c ? view : "recorded"} docLabel={step.docId}>
						{c && !live && <ReplayControls r={replay} title={copy.short} />}
					</LivingWorkspace>
				)
				const note = c && !live && replay.at != null && replay.span && replay.span.ms < 1500 ? <p className="fine">Replay of this run from its recorded timestamps. The run itself took {duration(replay.span.ms)}; the outcome was decided then, not now.</p> : null
				if (c && !live) return <Result step={step} c={c} mode={mode} snapshot={snapshot} onRetry={onRun} canAct={canAct && busy == null && !running} stage={stage} note={note} next={nextAction} />
				return (
					<div className="sc-live">
						{stage}
						<aside className="sc-aside">
							{c ? <div className="sc-wait"><Hourglass size={18} weight="fill" /><b>The agents are working</b><p>The outcome appears here the moment the controls have decided.</p></div>
								: recorded ? <div className="sc-wait"><b>Not executed in the recorded run</b><p>There is nothing to replay for this scenario.</p></div>
									: <div className="sc-wait"><b>Ready</b><p>The synthetic document <span className="mono">{step.fileName ?? `${step.docId}.txt`}</span> goes through the same intake as any other. {mode === "live" ? "This makes five or six model calls on your provider account." : "The agents' answers are predefined; everything else runs."}</p><button type="button" className="btn btn-primary" disabled={!canAct || busy != null || running} onClick={onRun}>{busy === step.key ? <Spinner /> : <Play size={12} weight="fill" />} Run this scenario</button></div>}
						</aside>
					</div>
				)
			})()}

			{nextAction && <div className="sc-next">{nextAction}</div>}
		</section>
	)
}

type Verdict = { tone: "good" | "warn" | "bad" | ""; icon: ReactNode; title: string; line: string; note?: string }
function verdictOf(step: ShowcaseStep): Verdict {
	const a = step.actual
	const good = <CheckCircle size={22} weight="fill" />, warn = <Hourglass size={22} weight="fill" />, bad = <ShieldWarning size={22} weight="fill" />
	if (step.result === "failed") return { tone: "bad", icon: <Warning size={22} weight="fill" />, title: "This scenario did not finish", line: "An agent's model call failed before the workflow reached a decision. Nothing was approved and no draft exists." }
	if (step.key === "legitimate" && a === "AUTO_APPROVED") return { tone: "good", icon: good, title: "Payment verified", line: "Required financial checks passed. The approval created a sandbox payment draft: no money moves and nothing reaches a bank." }
	if (step.key === "beneficiary" && a === "BLOCKED") return { tone: "bad", icon: bad, title: "Payment blocked", line: "The invoice requests payment to an account that does not match the trusted vendor record.", note: "Unverified beneficiary change. The payment is restricted; nothing here establishes intent, and a block is not a loss prevented." }
	if (step.key === "challenge" && a === "NEEDS_APPROVAL") return { tone: "warn", icon: warn, title: "Held for a person", line: "Two independent findings state two different payable amounts. Neither is paid until a record that does not come from this document says which one is owed.", note: "The document alone cannot say which amount the vendor is owed. A corrected invoice or a confirmation from the vendor can." }
	if (step.key === "challenge" && a === "BLOCKED") return { tone: "bad", icon: bad, title: "Payment blocked", line: "The Extractor and the Auditor read different amounts from the document. Neither reading is trusted until it is corrected or read again." }
	if (step.key === "duplicate" && a === "BLOCKED") return { tone: "bad", icon: bad, title: "Duplicate payment blocked", line: "This financial obligation already exists in the payment records.", note: "An exact match on vendor and invoice number with an invoice that is already paid. An invoice that is only similar is sent to a person, not blocked." }
	if (step.key === "injection" && a === "NEEDS_APPROVAL") return { tone: "warn", icon: warn, title: "Held for a person", line: "The document contains text telling the system to approve it. The text was treated as content: no permission and no rule changed.", note: "It was not blocked for this. Everything else on the invoice checks out, so the policy sends it to a person." }
	const tone = a === "AUTO_APPROVED" ? "good" : a === "NEEDS_APPROVAL" ? "warn" : a === "BLOCKED" ? "bad" : ""
	return { tone, icon: tone === "good" ? good : tone === "warn" ? warn : bad, title: dispositionLabel(a ?? "PROCESSING_ERROR"), line: "This is the outcome the controls enforced for this document." }
}

function Result({ step, c, mode, snapshot, onRetry, canAct, stage, note, next }: { step: ShowcaseStep; c: PaymentCase; mode: Mode; snapshot: DeskSnapshot; onRetry: () => void; canAct: boolean; stage: ReactNode; note: ReactNode; next: ReactNode }) {
	const ev = useEvidence(c)
	const [checks, setChecks] = useState(false)
	const v = verdictOf(step)
	const recorded = mode === "recorded"
	const x = c.extraction.result
	const entry = (id: string | null | undefined) => (id ? c.ledger[id] : undefined)
	const runs = c.runs.filter((r) => r.attempt === c.attempt && r.agent !== "Solo")
	const of = (a: string) => runs.filter((r) => r.agent === a).pop()
	const va = of("Validator"), au = of("Auditor")
	const overlap = va?.finishedAt && au?.finishedAt ? Math.min(Date.parse(va.finishedAt), Date.parse(au.finishedAt)) - Math.max(Date.parse(va.startedAt), Date.parse(au.startedAt)) : null
	const inv = c.investigation.result
	const rec = c.decision.result?.recommended
	const amounts = (c.challenges ?? []).find((k) => k.category === "document_contradiction" || k.category === "reading_disagreement")
	const conflict = !amounts ? c.audit.result?.conflicts.find((k) => k.values.length > 1 && k.refs.length > 1) : undefined
	const history = Object.values(c.ledger).find((e) => e.category === "historical_payment")
	const vendor = Object.values(c.ledger).find((e) => e.category === "vendor_record" && e.id.startsWith("V:"))
	const instructions = Object.keys(c.ledger).filter((k) => k.startsWith("D:instruction:"))
	const error = c.extraction.error ?? c.validation.error ?? c.audit.error ?? c.investigation.error ?? c.decision.error
	const failedAgent = runs.find((r) => r.status === "error" || r.status === "timeout")?.agent
	const row = (k: string, value: ReactNode, refs: (string | null | undefined)[] = [], sub?: ReactNode) => <div key={k}><dt>{k}</dt><dd>{value} {refs.map((r) => ev.chip(r ?? null))}{sub && <span className="fine sc-sub">{sub}</span>}</dd></div>

	return (
		<div className="sc-result">
			<div className="sc-live">
				{stage}
				<aside className="sc-aside">
			<section className={`verdict ${v.tone}`} aria-label="Outcome of this scenario">
				<div className="verdict-top"><span className="ico">{v.icon}</span><span className="what">{v.title}</span><span className="why">{v.line}</span></div>
				<div className="sc-check">
					<span className={`status ${RESULT[step.result].tone}`}><i aria-hidden />{RESULT[step.result].label}</span>
					<span className="fine">The scenario file expects {step.expected.map(dispositionLabel).join(" or ").toLowerCase() || "nothing"}. {step.result === "failed" ? "The workflow did not reach a decision" : `The controls enforced ${dispositionLabel(step.actual ?? "").toLowerCase()}`}{rec && step.result !== "failed" ? `; the Policy agent had recommended ${dispositionLabel(rec.disposition).toLowerCase()}${c.decision.result?.overridden ? ", which the controls overrode" : ""}` : ""}.</span>
				</div>
				{v.note && <p className="sc-note">{v.note}</p>}
				{step.result === "failed" && (
					<div className="verdict-act">
						<div className="errbox">{failedAgent ? `${failedAgent}: ` : ""}{error ?? "The workflow stopped without a recorded error."}</div>
						{recorded ? <p className="fine">This is how the recorded run ended for this document. Scenarios that had already finished were not affected.</p> : (
							<>
								{snapshot.provider && <p className="fine">{snapshot.provider.advice} Agents are paused so that no further request is spent.</p>}
								<div className="buttons">
									<button type="button" className="btn" disabled={!canAct} onClick={onRetry}><ArrowsClockwise size={13} /> Run this scenario again</button>
									<span className="hint">{mode === "live" ? <>Scenarios that already finished are unaffected. For the scripted demo, stop this server and run <code>npm run demo</code>; the mode never switches by itself.</> : "Scenarios that already finished are unaffected."}</span>
								</div>
							</>
						)}
					</div>
				)}
			</section>
					{next && <div className="sc-aside-next">{next}</div>}
					{note}
				</aside>
			</div>

			{step.result !== "failed" && (
				<div className="sc-grid">
					<section className="panel">
						<div className="panel-head"><h2>Check it at the source</h2><span className="right">{c.pdf ? `${c.fileName} · PDF, ${c.pdf.pages} ${c.pdf.pages === 1 ? "page" : "pages"} · select a reference to open the page` : "select a reference to open the line or the record"}</span></div>
						<div className="panel-body sc-evidence">
							{step.key === "beneficiary" && <Compare c={c} chip={ev.chip} />}
							{(step.key === "challenge") && (amounts || conflict) && (
								<div className="compare">
									{amounts ? [amounts.challenged, amounts.observed].map((s, i) => { const e = entry(s.ref); return <div key={i}><span className="k">{e?.doc?.page != null ? `Page ${e.doc.page}, line ${e.doc.pageLine} of the PDF` : e?.doc?.lineStart ? `Line ${e.doc.lineStart} of the document` : s.by}</span><span className="mono v">{s.value}</span><span className="s">{ev.chip(s.ref)} {e?.doc?.excerpt ? <span className="truncate">“{e.doc.excerpt.trim()}”</span> : s.by}</span></div> })
										: conflict!.values.slice(0, 2).map((val, i) => { const e = entry(conflict!.refs[i]); return <div key={i}><span className="k">{e?.doc?.lineStart ? `Line ${e.doc.lineStart} of the document` : "Document"}</span><span className="mono v">{val}</span><span className="s">{ev.chip(conflict!.refs[i] ?? null)} {e?.doc?.excerpt ? <span className="truncate">“{e.doc.excerpt.trim()}”</span> : "as reported by the Auditor"}</span></div> })}
								</div>
							)}
							<dl className="kv">
								{step.key === "legitimate" && <>
									{row("Amount requested", <b className="mono">{c.exposure ? money(c.exposure.minor, c.exposure.currency) : "not read"}</b>, [x?.refs.gross])}
									{row("Beneficiary account", <span className="mono">{fmtIban(x?.iban)}</span>, [x?.refs.iban, vendor?.id], "the account on file for this vendor")}
									{row("Applied policy", <>Automatic approval up to {money(snapshot.policy.autoApproveLimit, snapshot.policy.currency)}</>, ["P:limit", "C:limit"])}
									{row("Final decision", <>{dispositionLabel(step.actual ?? "")}{c.draft ? <> · sandbox draft <span className="mono">{c.draft.draftId}</span></> : ""}</>)}
								</>}
								{step.key === "beneficiary" && <>
									{row("Amount requested", <b className="mono">{c.exposure ? money(c.exposure.minor, c.exposure.currency) : "not read"}</b>, [x?.refs.gross])}
									{row("Callback on record", "None for this vendor and this account", [], "the only thing that lifts this block; the vendor master is never changed from a document")}
								</>}
								{step.key === "challenge" && <>
									{row("Raised by", amounts ? (amounts.raisedBy === "Firewall" ? "The comparison in code" : `The ${amounts.raisedBy}, reading the document without seeing the Extractor's result`) : "The Auditor, reading the document without seeing the Extractor's result")}
									{row("Amount this payment would pay", <b className="mono">{c.exposure ? money(c.exposure.minor, c.exposure.currency) : "not read"}</b>, [x?.refs.gross], amounts?.status === "matched_to_record" ? "the invoice total as the Extractor read it; a vendor confirmation on record states the same amount" : "the invoice total as the Extractor read it; not yet established as the amount owed")}
									{row("Status", !amounts ? "Held under R14, before the cross-check protocol existed" : amounts.status === "matched_to_record" ? "Matched to a vendor confirmation on record" : amounts.status === "accepted_by_reviewer" ? "Accepted by a reviewer on a written statement, not verified" : amounts.status === "confirmed_discrepancy" ? "A vendor confirmation states another amount: blocked" : "Waiting for a person. A cited line shows a value is in the document, not which one is owed")}
								</>}
								{step.key === "duplicate" && <>
									{row("Incoming document", <>Invoice <span className="mono">{x?.invoiceNumber ?? "?"}</span> · <span className="mono">{c.exposure ? money(c.exposure.minor, c.exposure.currency) : ""}</span></>, [x?.refs.invoiceNumber, x?.refs.gross], c.fileName)}
									{row("Payment record", history?.record ? <>Invoice <span className="mono">{history.record.fields.invoiceNumber ?? history.record.fields.invoice ?? ""}</span> paid on <span className="mono">{history.record.fields.paidAt ?? history.record.fields.paid ?? ""}</span></> : "No matching record in the ledger", [history?.id], history ? "payment history, a trusted record" : undefined)}
									{row("Kind of match", "Exact: same vendor and invoice number as a paid invoice")}
								</>}
								{step.key === "injection" && <>
									{row("Instruction-like text", instructions.length ? `${n(instructions.length, "line")} of the document` : "none located", instructions)}
									{row("Effect on permissions and rules", "None. Agents hold the same tools and the policy is unchanged")}
									{row("Amount requested", <b className="mono">{c.exposure ? money(c.exposure.minor, c.exposure.currency) : "not read"}</b>, [x?.refs.gross])}
								</>}
							</dl>
							{step.key === "challenge" && (c.challenges?.length ?? 0) > 0 && <button type="button" className="btn" data-drawer-keep style={{ justifySelf: "start" }} onClick={() => setChecks(true)}>Inspect agent challenge</button>}
						</div>
					</section>

					<section className="panel">
						<div className="panel-head"><h2>How the agents worked</h2><span className="right">from recorded execution</span></div>
						<div className="panel-body sc-evidence">
							<dl className="kv">
								{row("Independent checks", overlap != null && overlap > 0 ? <>Validator and Auditor ran at the same time for <b>{duration(overlap)}</b></> : va && au ? "Validator and Auditor did not overlap in this run" : "Not measured")}
								{row("Investigator", of("Investigator") ? "Called, because a control failed or needed review" : "Not called: there was no exception")}
								{row("Last word", c.decision.result ? <>{dispositionLabel(c.decision.result.final)}, enforced by code{c.decision.result.overridden ? " over a looser recommendation" : ""}</> : "No decision")}
							</dl>
							{inv && <div className="sc-quote"><span className="fine">Investigator · {SOURCE[mode]}</span><p>{plain(inv.explanation)}</p></div>}
							<details className="fold sc-runs">
								<summary><CaretRight size={12} weight="bold" className="caret" /> Execution record · {n(runs.length, "agent loop")} <span className="right">times in UTC</span></summary>
								<ul className="runs">
									{runs.map((r, i) => <li key={i} className={r.status === "error" || r.status === "timeout" ? "err" : ""}><span className={`who agent-${r.agent}`}><span className="swatch" />{r.agent}</span><span className="mono">{r.finishedAt ? duration(Date.parse(r.finishedAt) - Date.parse(r.startedAt)) : "running"}</span><span className="fine">{r.startedAt.slice(11, 23)} to {r.finishedAt ? r.finishedAt.slice(11, 23) : "…"} · {r.model}{r.tokens ? ` · ${count(r.tokens.input + r.tokens.output)} tokens` : " · no token usage reported"}{r.id ? ` · ${r.id}` : ""}</span></li>)}
								</ul>
							</details>
							{!recorded && <div className="sc-links"><a className="linkish" href={href("activity", c.id, "details")}>View execution proof <ArrowRight size={12} /></a><a className="linkish" href={href("inbox", c.id)}>Open the payment <ArrowRight size={12} /></a></div>}
						</div>
					</section>
				</div>
			)}

			{step.key === "challenge" && !recorded && step.result !== "failed" && (() => {
				const record = c.controls.find((k) => k.settledBy)?.settledBy
				const against = c.controls.find((k) => k.id === "amount_confirmation" && k.status === "fail")
				return (
					<section className="panel">
						<div className="panel-head"><h2>Resolve it with independent evidence</h2><span className="right">optional · what a reviewer does next</span></div>
						<div className="panel-body sc-evidence">
							<p className="say">Neither amount is paid on the document's word. A line of the invoice cannot say which one is owed, and neither can a reviewer's written statement: the approval is refused without a confirmation. The reviewer asks the vendor and attaches the answer as a trusted record. This sandbox holds a synthetic confirmation for this invoice, <span className="mono">VC-2026-1126-01</span>. A record for another vendor or invoice, or an unverified one such as <span className="mono">VC-2026-1126-03</span>, is refused.</p>
							<div className="sc-resolve-state">
								<StageStatus stage={c.stage} lg />
								<span className="fine">
									{c.stage === "approved" ? <>Approved by a person{record ? <> on vendor confirmation {ev.chip(record)}</> : " on a written statement, without a confirming record"}. Sandbox draft <span className="mono">{c.draft?.draftId}</span>; no money moves.</>
										: against ? <>The confirmation on record {ev.chip(against.refs.find((r) => r.startsWith("VC:")) ?? null)} states another amount than this payment would pay. It is blocked until the document is corrected.</>
											: record ? <>Confirmation {ev.chip(record)} matches this vendor, this invoice and the amount this payment would pay. A person still approves.</>
												: c.stage === "rejected" ? "Rejected by a person. No draft exists."
													: "Held. No confirmation is attached yet."}
								</span>
							</div>
							{(c.stage === "awaiting_approval" || c.stage === "blocked") && <div className="verdict-act sc-act"><Actions c={c} snapshot={snapshot} /></div>}
						</div>
					</section>
				)
			})()}

			<EvidenceDrawer c={c} sel={ev.sel} open={ev.sel != null} onClose={() => ev.setSel(null)} chip={ev.chip} recorded={recorded} />
			<Drawer open={checks} onClose={() => setChecks(false)} label="Agent cross-checks" kicker={`${COPY[step.key].short} · ${c.id}`} title="Agent cross-checks">
				<p className="say">Every disagreement between agents, or between an agent and the records, with the evidence for each side. Code derives these from what the agents reported; no model writes one.</p>
				<CrossChecks c={c} chip={ev.chip} />
			</Drawer>
		</div>
	)
}

// ───────── the summary ─────────

function Summary({ steps, cases, mode, onPick, loadingAll, onLoadAll, canAct, running, recording }: { steps: ShowcaseStep[]; cases: PaymentCase[]; mode: Mode; onPick: (k: Sel) => void; loadingAll?: boolean; onLoadAll?: () => void; canAct: boolean; running: boolean; recording: Recording | null }) {
	const ran = steps.filter(settled)
	// figures are counted over the scenarios that reached a decision; one that failed has no outcome to count
	const mine = ran.filter((s) => s.result !== "failed").map((s) => cases.find((c) => c.id === s.docId)).filter((c): c is PaymentCase => c != null)
	const main = steps.filter((s) => !s.optional)
	const all = main.every(settled)
	const overlapped = mine.filter((c) => {
		const of = (a: string) => c.runs.filter((r) => r.attempt === c.attempt && r.agent === a).pop()
		const v = of("Validator"), a = of("Auditor")
		return v?.finishedAt && a?.finishedAt && Math.min(Date.parse(v.finishedAt), Date.parse(a.finishedAt)) > Math.max(Date.parse(v.startedAt), Date.parse(a.startedAt))
	}).length
	const values = mine.flatMap((c) => c.integrity?.values ?? [])
	const sourced = values.filter((v) => v.present && v.correct !== false).length
	const stat = (k: string, v: ReactNode, small?: string, title?: string) => <div className="stat" title={title}><span className="k">{k}</span><span className="v">{v}{small && <small>{small}</small>}</span></div>
	const recorded = mode === "recorded"
	return (
		<section className="sc-stage swap">
			<div className="sc-head">
				<span className="sc-num">{all ? "Summary" : `Summary so far · ${ran.filter((s) => !s.optional).length} of ${main.length} scenarios`}</span>
				<h1>Your financial decisions, verified.</h1>
				<p>{recorded ? "What the stored run shows for the showcase documents. Every figure is counted from its recorded cases." : mode === "scripted" ? "Counted from the payment cases this demo produced. The orchestration and the controls ran for real; the agents' answers were predefined, so this is not a measure of model quality." : "Counted from the payment cases this demo produced with live models."}</p>
			</div>
			{ran.length === 0 ? (
				<div className="panel"><div className="empty"><h2>No scenario has run yet</h2><p>Run the first scenario and its result appears here.</p><div className="actions"><button type="button" className="btn btn-primary" onClick={() => onPick(steps[0]!.key)}>Go to the first scenario <ArrowRight size={13} /></button></div></div></div>
			) : (
				<>
					<div className="panel"><div className="panel-body">
						<div className="statline" aria-label="Counted from the cases of the scenarios that ran">
							{stat("Documents processed", ran.filter((s) => s.result !== "failed").length, ran.some((s) => s.result === "failed") ? `${ran.filter((s) => s.result === "failed").length} did not finish` : undefined)}
							{stat("Eligible for approval", ran.filter((s) => s.actual === "AUTO_APPROVED").length, "sandbox draft", "Payments the controls let through. A sandbox draft exists; no money moves.")}
							{stat("Restricted", ran.filter((s) => s.actual === "BLOCKED" || s.actual === "NEEDS_APPROVAL").length, `${ran.filter((s) => s.actual === "BLOCKED").length} blocked`, "Blocked, or held for a person. A restriction is not a proven loss prevented.")}
							{stat("Cross-checks", mine.reduce((k, c) => k + (c.challenges?.length ?? 0), 0), undefined, "Structured disagreements derived by code from what the agents and the records say.")}
							{stat("Investigations", mine.filter((c) => c.runs.some((r) => r.agent === "Investigator" && r.attempt === c.attempt)).length)}
							{stat("Checks in parallel", overlapped, `of ${mine.length}`, "Documents where the Validator's and the Auditor's loops overlap in the recorded timestamps.")}
							{values.length > 0 ? stat("Values with a source", sourced, `of ${values.length}`, "Reported values whose evidence reference resolves and, where code can check it, supports the value.") : stat("Values with a source", <span className="none">Not measured</span>, undefined, "The stored cases predate the integrity report.")}
						</div>
					</div></div>
					<div className="panel">
						<div className="grid-table" style={{ ["--cols" as string]: "minmax(150px, 1.2fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) minmax(180px, 1fr)" }}>
							<div className="tr h"><span>Scenario</span><span>Expected</span><span>Enforced</span><span>Result</span></div>
							{steps.map((s) => (
								<div className="tr" key={s.key}>
									<button type="button" className="linkish" style={{ justifySelf: "start" }} onClick={() => onPick(s.key)}>{COPY[s.key].short}</button>
									<span>{s.expected.map(dispositionLabel).join(" or ")}</span>
									<span>{s.actual ? dispositionLabel(s.actual) : <span className="muted">none</span>}</span>
									<span className={`status ${RESULT[s.result].tone}`}><i aria-hidden />{s.optional && s.result === "not_run" ? "Not executed (optional)" : RESULT[s.result].label}</span>
								</div>
							))}
						</div>
						<div className="panel-foot">Expected outcomes come from <span className="mono">server/data/scenarios.json</span>. “Enforced” is what the controls decided before any person acted. No reliability score is derived from four scenarios.</div>
					</div>
				</>
			)}
			<div className="sc-next sc-wrap">
				{recorded ? <a className="btn btn-primary" href={href("showcase")}><ArrowLeft size={13} /> Back to the showcase</a> : (
					<>
						<a className="btn btn-primary" href={href("inbox")}>Explore payment cases <ArrowRight size={13} /></a>
						<a className="btn" href={href("activity")}>View agent execution</a>
						<a className="btn" href={href("lab")}>Open Financial Stress Lab</a>
						{recording && <a className="btn" href={href("showcase", "recorded")}><ClockCounterClockwise size={13} /> Recorded live run</a>}
						<a className="btn btn-ghost" href={href("overview")}>Return to workspace</a>
					</>
				)}
			</div>
			{!recorded && onLoadAll && <p className="fine">The scenario payments stay on the desk as demo documents. To see all sixteen synthetic documents instead, <button type="button" className="linkish" disabled={!canAct || running || loadingAll} onClick={onLoadAll}>{loadingAll && <Spinner />}load the full inbox</button>; that replaces the demo documents and ends this demo.</p>}
		</section>
	)
}
