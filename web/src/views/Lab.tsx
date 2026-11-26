import { useMemo, useState, type ReactNode } from "react"
import { ArrowLeft, CaretRight, CheckCircle, DownloadSimple, Flask, Lightning, Play, Prohibit, Scales, Stop, Warning, WarningCircle, XCircle } from "@phosphor-icons/react"
import { cancelLabRun, labReportUrl, startLabRun, useLab, useLabDetail, type BenchmarkView, type ConfigMetrics, type LabItemView, type LabMode, type LabOverview, type LabRunView, type LabScenarioView, type Ratio } from "../lib/lab"
import { loopsOf } from "../lib/derive"
import { clock, count, duration, iban, money } from "../lib/format"
import { href } from "../lib/router"
import { DispositionTag, Prov, Spinner, StatusIcon, dispositionLabel } from "../components/bits"
import { Timeline, useNow } from "../components/Timeline"

type Latest = { run: LabRunView; item: LabItemView } | null
type Ask = { kind: "scenario" | "suite" | "benchmark"; ids?: string[]; executions: number } | null

/** The most recent execution of a scenario in a mode, whatever its state. */
function latest(data: LabOverview, scenarioId: string, mode: LabMode): Latest {
	for (const run of data.runs) {
		if (run.mode !== mode) continue
		const item = run.items.find((i) => i.key === `${scenarioId}:multi` && i.status !== "cancelled")
		if (item) return { run, item }
	}
	return null
}

const MODE_KEY = "pd-lab-mode"
const readMode = (): LabMode => { try { return localStorage.getItem(MODE_KEY) === "live" ? "live" : "scripted" } catch { return "scripted" } }

export function Lab({ id }: { id: string | null }) {
	const { data, error, refresh } = useLab()
	const [mode, setModeState] = useState<LabMode>(readMode)
	const [ask, setAsk] = useState<Ask>(null)
	const [busy, setBusy] = useState(false)
	const [err, setErr] = useState<string | null>(null)
	const setMode = (m: LabMode) => { setModeState(m); setAsk(null); setErr(null); try { localStorage.setItem(MODE_KEY, m) } catch { /* private mode: keep in memory */ } }

	const start = async (a: NonNullable<Ask>, runMode: LabMode, confirmed: boolean) => {
		if (runMode === "live" && !confirmed) { setAsk(a); return }
		setBusy(true); setErr(null); setAsk(null)
		try { await startLabRun({ kind: a.kind, mode: runMode, scenarioIds: a.ids, confirmLive: runMode === "live" ? true : undefined }); await refresh() }
		catch (e) { setErr((e as Error).message) }
		finally { setBusy(false) }
	}
	const cancel = async () => { setBusy(true); try { await cancelLabRun(); await refresh() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }

	if (!data) {
		return (
			<main className="view" aria-busy={!error}>
				{error ? <div className="banner bad" role="alert"><WarningCircle size={16} weight="bold" /><div><b>The Stress Lab could not be loaded.</b> {error}</div></div>
					: <div className="panel"><div className="panel-body" style={{ display: "grid", gap: 10 }}><div className="skel" style={{ height: 14, width: "30%" }} /><div className="skel" style={{ height: 80 }} /></div></div>}
			</main>
		)
	}

	const active = data.runs.find((r) => r.id === data.active) ?? null
	const benchmark = id === "benchmark"
	const selected = benchmark ? null : data.scenarios.find((s) => s.id === id) ?? data.scenarios[0]!
	const rows = data.scenarios.map((s) => ({ s, cur: latest(data, s.id, mode) }))
	const judged = rows.filter((r) => r.cur && ["pass", "fail"].includes(r.cur.item.status))
	const sum = (pick: (i: NonNullable<LabItemView["result"]>) => number) => judged.reduce((n, r) => n + pick(r.cur!.item.result!), 0)
	const docsTotal = data.scenarios.reduce((n, s) => n + s.sources.length, 0)
	const liveBlocked = mode === "live" && !data.live.available

	return (
		<main className="view" data-open={id != null}>
			<section className="panel lab-hero">
				<div className="panel-head"><Flask size={15} /><h2>Reliability under stress</h2><span className="right"><span className="tag line fit">Sandbox · synthetic data</span></span></div>
				<div className="lab-top">
					<p className="say">Twelve reproducible financial scenarios. Each one declares what must happen before it runs, and no agent is ever shown that declaration. Every execution gets its own process, with its own Mozaik runtime and case state, so nothing here can touch the payment inbox, its approval totals or its saved state.</p>
					<div className="lab-controls">
						<div className="seg" role="group" aria-label="Execution path">
							<button aria-pressed={mode === "scripted"} onClick={() => setMode("scripted")}><Lightning size={13} /> Deterministic</button>
							<button aria-pressed={mode === "live"} onClick={() => setMode("live")}><Play size={12} weight="fill" /> Live models</button>
						</div>
						<div className="lab-buttons">
							{active ? (
								<button className="btn" disabled={busy} onClick={cancel}><Stop size={13} weight="fill" /> Cancel run</button>
							) : (
								<button className="btn btn-primary" disabled={busy || liveBlocked} onClick={() => start({ kind: "suite", executions: data.scenarios.length }, mode, false)}>{busy ? <Spinner /> : <Play size={13} weight="fill" />} Run all {data.scenarios.length} scenarios</button>
							)}
							<a className="btn" href={href("lab", "benchmark")} aria-current={benchmark ? "page" : undefined}><Scales size={14} /> Single agent vs multi-agent</a>
						</div>
					</div>
					<p className="lab-note">
						{mode === "scripted"
							? <><b>Deterministic path.</b> The real Mozaik workflow runs: loops, tools, events, controls, enforcement. What the agents say comes from a fixed fixture, and the scripted Policy agent recommends approval for everything, so a pass means the controls held without help from a model. No API key, a few seconds. It does not test a language model.</>
							: <><b>Live path.</b> Real models through Mozaik ({data.live.models.fast} and {data.live.models.careful}). It spends API credit, at most {data.limits.concurrency.live} scenarios run at once, and a repeat can word things differently.{!data.live.available && <> <b>No model API key on the server:</b> copy <code>.env.example</code> to <code>.env</code>, set <code>ANTHROPIC_API_KEY</code> and restart. The deterministic path needs none.</>}</>}
					</p>
					{ask && (
						<div className="banner warn" role="alertdialog" aria-label="Confirm a live run">
							<Warning size={16} weight="bold" />
							<div><b>This spends API credit.</b> {ask.kind === "benchmark" ? `${ask.executions} scenario executions (each benchmark scenario once per configuration)` : ask.kind === "suite" ? `${ask.executions} scenarios, ${docsTotal} documents` : "One scenario"} with live models. One run at a time; it can be cancelled.</div>
							<span className="lab-buttons"><button className="btn btn-sm" onClick={() => setAsk(null)}>Not now</button><button className="btn btn-sm btn-primary" disabled={busy} onClick={() => start(ask, "live", true)}>Run live</button></span>
						</div>
					)}
					{err && <div className="errbox" role="alert">{err}</div>}
				</div>
				<div className="stats five">
					<div className="stat"><span className="k">Scenarios passed</span>{judged.length ? <span className="v">{judged.filter((r) => r.cur!.item.status === "pass").length}<small>of {judged.length} judged</small></span> : <span className="v none">not run</span>}</div>
					<div className="stat"><span className="k">Checks passed</span>{judged.length ? <span className="v">{sum((r) => r.passed)}<small>of {sum((r) => r.checks)}</small></span> : <span className="v none">n/a</span>}</div>
					<div className="stat"><span className="k" title="Values whose reference exists and resolves, out of all values the integrity verifier checked.">Evidence present</span>{judged.length ? <span className="v">{sum((r) => r.integrity.present)}<small>of {sum((r) => r.integrity.values)}</small></span> : <span className="v none">n/a</span>}</div>
					<div className="stat"><span className="k" title="Of the references that can be checked mechanically, those whose source really contains the value.">Evidence correct</span>{judged.length ? <span className="v">{sum((r) => r.integrity.correct)}<small>of {sum((r) => r.integrity.checkable)} checkable</small></span> : <span className="v none">n/a</span>}</div>
					<div className="stat"><span className="k">Execution time</span>{judged.length ? <span className="v">{duration(sum((r) => r.durationMs))}<small>{sum((r) => r.loops)} loops, {mode === "scripted" ? "scripted model" : "live models"}</small></span> : <span className="v none">n/a</span>}</div>
				</div>
			</section>

			<div className="lab" data-open={id != null}>
				<section className="panel lab-list" aria-label="Scenarios">
					<div className="panel-head"><h2>Scenarios</h2><span className="right">{active ? <><Spinner /> {active.items.filter((i) => !["queued", "running"].includes(i.status)).length} of {active.items.length}</> : `${mode === "scripted" ? "deterministic" : "live"} results`}</span></div>
					{(["core", "extended"] as const).map((group) => (
						<div key={group} className="lab-group">
							<div className="lab-group-h">{group === "core" ? "Core scenarios" : "Extended scenarios"}</div>
							{rows.filter((r) => r.s.group === group).map(({ s, cur }) => (
								<a key={s.id} className="lab-row" href={href("lab", s.id)} aria-current={selected?.id === s.id ? "true" : undefined}>
									<ItemMark status={cur?.item.status ?? null} />
									<span className="lab-id">{s.id}</span>
									<span className="name">{s.name}</span>
									<span className="lab-st">{statusText(cur)}</span>
									<span className="meta">{[...new Set(Object.values(s.expected.outcomes).flat())].map(dispositionLabel).join(" or ")}{s.fault && <span className="tag line">fault injection</span>}</span>
								</a>
							))}
						</div>
					))}
				</section>

				<div className="lab-detail">
					<a className="back lab-back" href={href("lab")}><ArrowLeft size={14} /> All scenarios</a>
					{benchmark
						? <Benchmark data={data} busy={busy || active != null} onRun={() => start({ kind: "benchmark", executions: data.scenarios.filter((s) => s.benchmark).length * 2 }, "live", false)} />
						: <ScenarioPanel key={`${selected!.id}:${mode}`} s={selected!} cur={latest(data, selected!.id, mode)} mode={mode} blocked={busy || active != null || liveBlocked} onRun={() => start({ kind: "scenario", ids: [selected!.id], executions: 1 }, mode, false)} />}
				</div>
			</div>
		</main>
	)
}

function ItemMark({ status }: { status: LabItemView["status"] | null }) {
	if (status === "pass") return <span className="mark ok" title="every declared check passed"><CheckCircle size={15} weight="bold" /></span>
	if (status === "fail") return <span className="mark off" title="a declared check failed"><XCircle size={15} weight="bold" /></span>
	if (status === "error") return <span className="mark warn" title="could not be judged"><Warning size={15} weight="bold" /></span>
	if (status === "running" || status === "queued") return <span className="mark run"><Spinner /></span>
	return <span className="mark absent" title="not run in this mode"><Prohibit size={15} /></span>
}

function statusText(cur: Latest): string {
	if (!cur) return "not run"
	const { status, result } = cur.item
	if (status === "queued") return "queued"
	if (status === "running") return "running"
	if (status === "error") return "not judged"
	return result ? `${result.passed}/${result.checks} checks` : status
}

// ───────────────────────────────── one scenario ─────────────────────────────────

function ScenarioPanel({ s, cur, mode, blocked, onRun }: { s: LabScenarioView; cur: Latest; mode: LabMode; blocked: boolean; onRun: () => void }) {
	const running = cur != null && (cur.item.status === "running" || cur.item.status === "queued")
	const { detail, error } = useLabDetail(cur?.run.id ?? null, cur?.item.key ?? null, running, cur?.item.finishedAt ?? null)
	const [doc, setDoc] = useState(0)
	const cases = detail?.cases ?? []
	const loops = useMemo(() => loopsOf(cases), [cases])
	const now = useNow(running)
	const result = detail?.result ?? null
	const runs = cases.flatMap((c) => c.runs.map((r) => ({ c, r }))).sort((a, b) => a.r.startedAt.localeCompare(b.r.startedAt))
	const source = s.sources[Math.min(doc, s.sources.length - 1)]!
	const findings = cases.flatMap((c) => (c.integrity?.findings ?? []).map((f) => ({ c, f })))

	return (
		<>
			<section className="panel">
				<div className="lab-head">
					<div>
						<div className="lab-kicker"><span className="lab-id">{s.id}</span>{s.group === "core" ? "Core scenario" : "Extended scenario"}{!s.benchmark && " · not part of the benchmark"}</div>
						<h2>{s.name}</h2>
						<p className="say">{s.problem}</p>
					</div>
					<div className="lab-buttons">
						<button className="btn btn-primary" disabled={blocked || running} onClick={onRun}>{running ? <Spinner /> : <Play size={13} weight="fill" />} {cur && !running ? "Run again" : "Run"} · {mode === "scripted" ? "deterministic" : "live"}</button>
						{cur && result && <a className="btn" href={labReportUrl(cur.run.id, cur.item.key)} download><DownloadSimple size={14} /> Audit report (JSON)</a>}
					</div>
				</div>
				{s.fault && <div className="lab-pad"><div className="banner warn" role="note"><Warning size={16} weight="bold" /><div>{s.fault.label}</div></div></div>}
			</section>

			<section className="panel">
				<div className="sec-head"><h3>Declared before the run</h3><span className="right"><span className="truncate">never shown to an agent</span></span></div>
				<div className="sec-body">
					<p className="say">{s.expected.summary}</p>
					<div className="grid-table lab-table" style={{ ["--cols" as string]: "minmax(150px, 0.9fr) minmax(130px, 0.8fr) minmax(0, 2fr)" }}>
						<div className="tr h"><span>Applies to</span><span>Must be</span><span>Condition</span></div>
						{Object.entries(s.expected.outcomes).map(([d, allowed]) => <div className="tr" key={`o${d}`}><span className="mono">{d}</span><span>{allowed.map(dispositionLabel).join(" or ")}</span><span className="wide soft">Final decision after enforcement</span></div>)}
						{s.expected.controls.map((k, i) => <div className="tr" key={`c${i}`}><span className="mono">{k.doc}</span><span>{k.status.join(" or ")}</span><span className="wide soft">Control <span className="mono">{k.control}</span>: {k.why}{k.multiOnly && " (multi-agent only)"}</span></div>)}
						{s.expected.evidence.map((e, i) => <div className="tr" key={`e${i}`}><span className="mono">{e.doc}</span><span>in the ledger, verified</span><span className="wide soft">Evidence <span className="mono">{e.ref}{e.ref.endsWith(":") ? "…" : ""}</span>: {e.why}</span></div>)}
						{s.expected.invariants.map((inv) => <div className="tr" key={inv}><span className="muted">whole scenario</span><span>must hold</span><span className="wide soft">{INVARIANT[inv]}</span></div>)}
					</div>
				</div>
			</section>

			<section className="panel">
				<div className="sec-head"><h3>Result</h3><span className="right">{cur ? <span className="truncate">{mode === "scripted" ? "scripted model" : "live models"} · run {cur.run.id}{cur.item.finishedAt ? ` · ${clock(cur.item.finishedAt)}` : ""}</span> : null}</span></div>
				{!cur ? (
					<div className="empty"><h2>Not run on the {mode === "scripted" ? "deterministic" : "live"} path yet</h2><p>Nothing is shown here until this scenario has actually been executed. Run it, or run all scenarios from the top of the page.</p></div>
				) : running && !result ? (
					<div className="sec-body"><p className="say"><Spinner /> {cur.item.status === "queued" ? "Queued behind other scenarios." : "The agents are working on this scenario in an isolated process. The timeline below is live."}</p></div>
				) : cur.item.status === "error" ? (
					<div className="sec-body">
						<div className="banner bad" role="alert"><WarningCircle size={16} weight="bold" /><div><b>This run could not be judged.</b> It says nothing about the scenario, and it is not counted as a pass or a fail.</div></div>
						<div className="errbox">{cur.item.error ?? "no result was produced"}</div>
					</div>
				) : result ? (
					<>
						<div className="sec-body">
							<div className={`lab-verdict ${result.status === "pass" ? "good" : "bad"}`}>
								{result.status === "pass" ? <CheckCircle size={18} weight="bold" /> : <XCircle size={18} weight="bold" />}
								<div><b>{result.status === "pass" ? "Every declared check passed" : `${result.checks.filter((k) => !k.pass).length} of ${result.checks.length} declared checks failed`}</b><span>{result.checks.length} checks · {result.loops} agent loops · peak {result.peakParallel} in parallel · {duration(result.durationMs)}{result.tokens ? ` · ${count(result.tokens.input + result.tokens.output)} tokens` : " · token usage not reported"}</span></div>
							</div>
							<div className="lab-docs">
								{result.docs.map((d) => (
									<div className="chain" key={d.doc}>
										<div><span className="k"><span className="mono">{d.doc}</span></span><span className="lab-exp">declared: {d.expected.map(dispositionLabel).join(" or ")}</span></div>
										<div><span className="k"><Prov kind="agent" label="Agent recommended" /></span>{d.recommended ? <DispositionTag value={d.recommended} /> : <span className="muted">no recommendation was made</span>}</div>
										<div><span className="k"><Prov kind="computed" label="Controls allow" /></span>{d.floor ? <DispositionTag value={d.floor} /> : <span className="muted">not evaluated</span>}</div>
										<div><span className="k">In force <span className={`mark ${d.correct ? "ok" : "off"}`}>{d.correct ? <CheckCircle size={13} weight="bold" /> : <XCircle size={13} weight="bold" />}</span></span><DispositionTag value={d.final} /></div>
									</div>
								))}
							</div>
							{result.recovery && <p className="say"><b>Recovery.</b> With the fault removed the same document was run again and ended as {dispositionLabel(result.recovery.outcome)} after {duration(result.recovery.afterMs)}. The checks above judge the failed state.</p>}
						</div>
						<div className="grid-table lab-table marked" style={{ ["--cols" as string]: "20px minmax(0, 2fr) minmax(120px, 1fr) minmax(120px, 1fr)" }}>
							<div className="tr h"><span /><span>Check</span><span>Expected</span><span>Actual</span></div>
							{result.checks.map((k, i) => (
								<div className={`tr${k.pass ? "" : " err"}`} key={i}>
									<span className={`mark ${k.pass ? "ok" : "off"}`}>{k.pass ? <CheckCircle size={14} weight="bold" /> : <XCircle size={14} weight="bold" />}</span>
									<span>{k.doc && <span className="mono muted">{k.doc} · </span>}{k.label}</span>
									<span className="soft wide" data-k="Expected">{k.expected}</span>
									<span className="wide" data-k="Actual">{k.actual}</span>
								</div>
							))}
						</div>
					</>
				) : <div className="sec-body">{error ? <div className="errbox">{error}</div> : <div className="skel" style={{ height: 60 }} />}</div>}
			</section>

			{cur && cases.length > 0 && (
				<section className="panel">
					<div className="sec-head"><h3>Agent execution</h3><span className="right"><span className="truncate">recorded start and finish of every loop · isolated process</span></span></div>
					<div className={`live-surface${running ? " is-live" : ""}`}>
						<Timeline loops={loops} scope={cases.filter((c) => c.runs.length).length > 1 ? "inbox" : "case"} live={running} fit={!running} empty="No agent loop ran: the document was stopped before any agent was spent on it." />
					</div>
					<details className="fold" open={false}>
						<summary><CaretRight size={12} weight="bold" className="caret" /> Execution records <span className="right">{runs.length} loop{runs.length === 1 ? "" : "s"} · {cases.reduce((n, c) => n + c.version, 0)} writes to shared state</span></summary>
						<div className="grid-table" style={{ ["--cols" as string]: "minmax(150px, 1fr) minmax(100px, 0.9fr) 112px 92px 70px minmax(140px, 1.3fr)", maxHeight: 320 }}>
							<div className="tr h"><span>Agent and model</span><span>Case</span><span>Execution id</span><span>Started</span><span className="num">Duration</span><span>Triggered by</span></div>
							{runs.map(({ c, r }, i) => (
								<div className={`tr${r.status === "error" || r.status === "timeout" ? " err" : ""}`} key={i}>
									<span className={`lab-agent agent-${r.agent}`}><span className="swatch" /><b>{r.agent}</b><span className="t">{r.model}</span></span>
									<span className="t">{c.id}</span>
									<span className="t">{r.id ?? "n/a"}</span>
									<span className="t">{clock(r.startedAt, true)}</span>
									<span className="num">{duration((r.finishedAt ? Date.parse(r.finishedAt) : now) - Date.parse(r.startedAt))}</span>
									<span className="wide soft">{r.status === "done" || r.status === "running" ? r.trigger : `${r.status}: ${r.error ?? ""}`}</span>
								</div>
							))}
						</div>
					</details>
				</section>
			)}

			{result && cur?.item.status !== "error" && (
				<section className="panel">
					<div className="sec-head"><h3>Evidence integrity</h3><span className="right"><Prov kind="computed" label="re-verified, no model" /></span></div>
					<div className="stats four">
						<div className="stat"><span className="k">Values checked</span><span className="v">{result.integrity.values}</span></div>
						<div className="stat"><span className="k" title="A reference exists and the thing it points at exists.">Reference resolves</span><span className="v">{result.integrity.present}<small>of {result.integrity.values}</small></span></div>
						<div className="stat"><span className="k" title="The referenced source really contains the value. Values that cannot be checked mechanically, such as dates in words, are left out.">Source supports value</span><span className="v">{result.integrity.correct}<small>of {result.integrity.checkable} checkable</small></span></div>
						<div className="stat"><span className="k">Critical findings</span><span className="v">{result.integrity.criticalFindings}<small>{result.integrity.findings} in total</small></span></div>
					</div>
					{findings.length === 0 ? (
						<div className="panel-body soft">Every reference resolves and every checkable value is contained in its source. A citation that exists is not counted as correct until its source is read again.</div>
					) : (
						<div className="grid-table lab-table marked" style={{ ["--cols" as string]: "20px minmax(140px, 1fr) minmax(130px, 0.8fr) minmax(0, 2fr)" }}>
							<div className="tr h"><span /><span>Value</span><span>Finding</span><span>Detail</span></div>
							{findings.map(({ c, f }, i) => (
								<div className="tr" key={i}>
									<span className={`mark ${f.critical ? "off" : "warn"}`}><StatusIcon status="fail" block={f.critical} /></span>
									<span><span className="mono muted">{c.id} · </span>{f.subject}</span>
									<span className="soft">{FINDING[f.kind]}{f.critical ? "" : " (not critical)"}</span>
									<span className="wide soft">{f.detail}{f.ref && <> <span className="mono">{f.ref}</span></>}</span>
								</div>
							))}
						</div>
					)}
					{result.limitations.length > 0 && <div className="panel-body lab-limits"><b>Limits of this execution</b><ul>{result.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
				</section>
			)}

			<section className="panel">
				<div className="sec-head"><h3>Inputs</h3><span className="right"><span className="truncate">synthetic · {s.policyApplied.version}</span></span></div>
				<div className="lab-inputs">
					<div>
						<div className="lab-tabs">
							{s.sources.map((d, i) => <button key={d.id} className="tag line" aria-pressed={i === doc} onClick={() => setDoc(i)}>{d.fileName}</button>)}
						</div>
						<pre className="doc lab-doc" tabIndex={0} aria-label={`Synthetic source document ${source.fileName}`}>
							<span className="doc-in">{source.text.split("\n").map((l, i) => <span key={i} className="ln"><span className="gut"><i aria-hidden /><span className="no">{i + 1}</span></span><span>{l || " "}</span></span>)}</span>
						</pre>
						<p className="lab-foot">Untrusted content, copy of <span className="mono">server/data/documents/{source.from}.txt</span>{source.note ? ` (${source.note})` : ""}. Hash <span className="mono">{source.hash.slice(0, 16)}…</span></p>
					</div>
					<div className="lab-records">
						<div className="sub-h">Trusted vendor records</div>
						{s.records.vendors.length === 0 ? <p className="muted">None: the creditor is not in the vendor master.</p> : (
							<dl className="kv">{s.records.vendors.map((v) => <div key={v.id}><dt className="mono">{v.id}</dt><dd>{v.name}<br /><span className="mono soft">{iban(v.iban)}</span></dd></div>)}</dl>
						)}
						{s.records.history.length > 0 && <><div className="sub-h">Payment history</div><dl className="kv">{s.records.history.map((h) => <div key={h.id}><dt className="mono">{h.id}</dt><dd>{h.vendorId} · invoice {h.invoiceNumber} · {money(h.gross, h.currency)} · paid {h.paidAt}</dd></div>)}</dl></>}
						{s.records.purchaseOrders.length > 0 && <><div className="sub-h">Purchase orders</div><dl className="kv">{s.records.purchaseOrders.map((p) => <div key={p.po}><dt className="mono">{p.po}</dt><dd>{p.description} · {money(p.amount, p.currency)}</dd></div>)}</dl></>}
						<div className="sub-h">Policy applied</div>
						<dl className="kv">
							<div><dt>Auto-approve limit</dt><dd>{money(s.policyApplied.autoApproveLimit, s.policyApplied.currency)}</dd></div>
							<div><dt>Daily budget</dt><dd>{money(s.policyApplied.dailyAutoApproveBudget, s.policyApplied.currency)}{s.policyApplied.overridden.includes("dailyAutoApproveBudget") && <> <span className="tag warn">set for this scenario</span></>}</dd></div>
							<div><dt>Rules</dt><dd>{s.policyApplied.rules.length} rules, {s.policyApplied.rules[0]?.id} to {s.policyApplied.rules.at(-1)?.id}, as in <a className="linkish" href={href("settings")}>Settings</a></dd></div>
						</dl>
					</div>
				</div>
			</section>
		</>
	)
}

const INVARIANT: Record<string, string> = {
	draft_for_every_approval: "A sandbox draft exists for every approved payment and for nothing else.",
	never_auto_approved: "Nothing in this scenario is approved without a person.",
	single_authorisation: "Of all the documents, exactly one is authorised.",
	daily_budget_respected: "The automatically approved total stays within the daily budget, and at least one request is held on it.",
	investigator_called: "The exception reaches the Investigator (multi-agent only).",
	recoverable: "With the fault removed, running the document again reaches a decision.",
}
const FINDING: Record<string, string> = {
	missing_evidence: "Missing evidence", broken_reference: "Broken reference", unsupported_claim: "Unsupported claim", incorrect_normalization: "Incorrect normalisation", untraceable_calculation: "Untraceable calculation",
}

// ───────────────────────────────── benchmark ─────────────────────────────────

function Benchmark({ data, busy, onRun }: { data: LabOverview; busy: boolean; onRun: () => void }) {
	const b = data.benchmark
	const n = data.scenarios.filter((s) => s.benchmark).length
	const running = data.runs.find((r) => r.id === data.active && r.kind === "benchmark")
	return (
		<>
			<section className="panel">
				<div className="lab-head">
					<div>
						<div className="lab-kicker">Controlled comparison</div>
						<h2>Single agent against the multi-agent workflow</h2>
						<p className="say">The same {n} scenarios, twice. Both configurations get the same documents, the same trusted records through the same lookup, the same deterministic controls and the same enforcement. What an agent recommends is counted separately from what is enforced, because the controls stop an unsafe recommendation in either configuration, and that is not a merit of either architecture.</p>
					</div>
					<div className="lab-buttons"><button className="btn btn-primary" disabled={busy || !data.live.available} onClick={onRun}>{running ? <Spinner /> : <Play size={13} weight="fill" />} Run benchmark · live</button></div>
				</div>
				<div className="lab-configs">
					<div><div className="sub-h">A · Single-agent baseline</div><p>One agent, one loop, on <span className="mono">{data.live.baselineModel}</span> (the stronger of the two models, so the baseline is not handicapped). It reads the document, gets the trusted records and the controls, reports contradictions and recommends a disposition.</p></div>
					<div><div className="sub-h">B · Payment Desk on Mozaik</div><p>Extractor, Validator and Policy on <span className="mono">{data.live.models.fast}</span>; Auditor and Investigator on <span className="mono">{data.live.models.careful}</span>. Validator and Auditor run in parallel; the Auditor reads the document without seeing the first reading.</p></div>
				</div>
				<div className="panel-body lab-limits">
					<b>How to read it</b>
					<ul>
						<li>{n} synthetic scenarios is far too few for any statistical claim. Read the rows as observations, not as rates.</li>
						<li>The two fault-injected scenarios are left out: an injected failure is not model behaviour.</li>
						<li>It only runs with live models. On the scripted model both configurations replay the same fixture and would look identical.</li>
						<li>Model cost is not shown: no reliable price table is bundled, so the tokens the provider reported are shown instead.</li>
						{!data.live.available && <li><b>No model API key on the server</b>, so the benchmark cannot run here. Copy <code>.env.example</code> to <code>.env</code>, set <code>ANTHROPIC_API_KEY</code> and restart.</li>}
					</ul>
				</div>
			</section>

			{running && <section className="panel"><div className="sec-body"><p className="say"><Spinner /> Benchmark in progress: {running.items.filter((i) => !["queued", "running"].includes(i.status)).length} of {running.items.length} executions finished.</p></div></section>}

			{!b ? (
				<section className="panel"><div className="empty"><h2>No benchmark has been run yet</h2><p>This page shows recorded results only. Until a live benchmark has completed on this machine there is nothing to compare, and no figure is shown in its place.</p></div></section>
			) : (
				<>
					<section className="panel">
						<div className="sec-head"><h3>Recorded results</h3><span className="right"><span className="truncate">run {b.runId} · {clock(b.createdAt)} · {b.single.scenarios} scenarios per configuration</span><a className="btn btn-sm" href={labReportUrl(b.runId)} download><DownloadSimple size={13} /> JSON</a></span></div>
						{(b.single.errored > 0 || b.multi.errored > 0) && <div className="lab-pad"><div className="banner warn" role="note"><Warning size={16} weight="bold" /><div>{b.single.errored} single-agent and {b.multi.errored} multi-agent executions could not be judged (provider failure or timeout). They are left out of every figure below, so the two columns may not cover the same scenarios.</div></div></div>}
						<div className="grid-table lab-table bench" style={{ ["--cols" as string]: "minmax(170px, 1.1fr) minmax(96px, 0.5fr) minmax(96px, 0.5fr) minmax(0, 2.2fr)" }}>
							<div className="tr h"><span>Metric</span><span>Single agent</span><span>Multi-agent</span><span>How it is computed</span></div>
							{METRICS.map((m) => (
								<div className="tr" key={m.key}>
									<span>{m.label}</span>
									<span className="lab-fig" data-k="Single agent">{m.show(b.single)}</span>
									<span className="lab-fig" data-k="Multi-agent">{m.show(b.multi)}</span>
									<span className="wide soft">{b.notes[m.key] ?? m.note}</span>
								</div>
							))}
						</div>
					</section>
					<section className="panel">
						<div className="sec-head"><h3>Scenario by scenario</h3><span className="right"><span className="truncate">recommended, then in force</span></span></div>
						<div className="grid-table lab-table bench" style={{ ["--cols" as string]: "minmax(170px, 1.2fr) minmax(0, 1.4fr) minmax(0, 1.4fr)" }}>
							<div className="tr h"><span>Scenario</span><span>Single agent</span><span>Multi-agent</span></div>
							{b.scenarios.map((row) => {
								const s = data.scenarios.find((x) => x.id === row.scenarioId)
								return (
									<div className="tr" key={row.scenarioId}>
										<a className="pay" href={href("lab", row.scenarioId)}><span className="lab-id">{row.scenarioId}</span> {s?.name}</a>
										<BenchCell item={row.single} k="Single agent" />
										<BenchCell item={row.multi} k="Multi-agent" />
									</div>
								)
							})}
						</div>
					</section>
				</>
			)}
		</>
	)
}

function BenchCell({ item, k }: { item: LabItemView; k: string }) {
	if (item.status === "error" || !item.result) return <span className="wide" data-k={k}><span className="tag warn">not judged</span> <span className="soft">{item.error?.slice(0, 120) ?? item.status}</span></span>
	return (
		<span className="wide lab-cell" data-k={k}>
			<ItemMark status={item.status} />
			<span>{item.result.docs.map((d) => (
				<span key={d.doc} className="lab-doc-line"><span className="mono muted">{d.doc}</span> {d.recommended ? dispositionLabel(d.recommended) : "no recommendation"} → <b>{dispositionLabel(d.final)}</b>{!d.correct && <span className="tag bad">not as declared</span>}{d.fields && d.fields.wrong.length > 0 && <span className="tag warn">misread: {d.fields.wrong.join(", ")}</span>}</span>
			))}</span>
		</span>
	)
}

const ratio = (r: Ratio): ReactNode => (r ? <>{r.n}<small> of {r.of}</small></> : <span className="muted">not measured</span>)
const METRICS: { key: string; label: string; note?: string; show: (m: ConfigMetrics) => ReactNode }[] = [
	{ key: "scenariosPassed", label: "Scenarios passed", show: (m) => ratio(m.scenariosPassed) },
	{ key: "correctDecisions", label: "Correct final decisions", show: (m) => ratio(m.correctDecisions) },
	{ key: "unsafeRecommendations", label: "Unsafe approval recommendations", show: (m) => ratio(m.unsafeRecommendations) },
	{ key: "unsafeEnforced", label: "Unsafe approvals after enforcement", show: (m) => ratio(m.unsafeEnforced) },
	{ key: "legitimateBlocked", label: "Legitimate payments not approved", show: (m) => ratio(m.legitimateBlocked) },
	{ key: "criticalFields", label: "Critical fields read correctly", show: (m) => ratio(m.criticalFields) },
	{ key: "controlsDetected", label: "Declared conditions detected", show: (m) => ratio(m.controlsDetected) },
	{ key: "evidencePresent", label: "Evidence present", show: (m) => ratio(m.evidencePresent) },
	{ key: "evidenceCorrect", label: "Evidence correct", show: (m) => ratio(m.evidenceCorrect) },
	{ key: "disagreements", label: "Agent disagreements", show: (m) => (m.disagreements == null ? <span className="muted">not applicable</span> : m.disagreements) },
	{ key: "loops", label: "Agent loops", note: "Mozaik loops started across all judged scenario executions of the configuration.", show: (m) => m.loops },
	{ key: "durationMs", label: "Execution time", show: (m) => (m.scenarios - m.errored > 0 ? duration(m.durationMs) : <span className="muted">not measured</span>) },
	{ key: "tokens", label: "Tokens", show: (m) => (m.tokens == null ? <span className="muted">not reported</span> : count(m.tokens)) },
]

export type { BenchmarkView }
