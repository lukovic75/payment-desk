import { useState } from "react"
import { ArrowRight, CaretRight, CheckCircle, FileText, Play, Plus } from "@phosphor-icons/react"
import type { DeskSnapshot, PaymentCase } from "../lib/api"
import { flagged, isRunning, loopsOf, needsPerson, outcomeOf, riskRank, titleOf } from "../lib/derive"
import { amount, money, totals } from "../lib/format"
import { href } from "../lib/router"
import { Money, Spinner, StageStatus, Tick, issueLine } from "../components/bits"
import { MiniAgents, inboxScene } from "../components/LivingWorkspace"
import { useNow } from "../components/Timeline"
import { Figure, PageHead } from "../components/ui"

type Props = { snapshot: DeskSnapshot; canAct: boolean; starting: boolean; onRun: () => void; onAdd: () => void }

/** The total in the policy currency, with any other currency listed beside it and never added to it. */
function sumOf(list: PaymentCase[], ccy: string) {
	const t = totals(list.map((c) => c.exposure))
	const main = t.find((x) => x.currency === ccy) ?? t[0] ?? null
	const rest = t.filter((x) => x !== main).map((x) => money(x.minor, x.currency)).join(" · ")
	const unread = list.filter((c) => !c.exposure).length
	return { main, rest, unread }
}

export function Overview({ snapshot, canAct, starting, onRun, onAdd }: Props) {
	const { cases, policy } = snapshot
	const running = cases.some(isRunning)
	const waiting = cases.filter((c) => c.stage === "awaiting_approval")
	const blocked = cases.filter((c) => c.stage === "blocked")
	const approved = cases.filter((c) => c.stage === "approved")
	const failed = cases.filter((c) => c.stage === "error")
	const auto = approved.filter((c) => outcomeOf(c) === "AUTO_APPROVED").length
	const used = policy.dailyAutoApproveBudget > 0 ? snapshot.dailyAutoApproved / policy.dailyAutoApproveBudget : 0
	const loops = loopsOf(cases)
	useNow(running)
	const scene = inboxScene(cases, loops)
	const investigated = cases.filter((c) => c.runs.some((r) => r.agent === "Investigator")).length
	const attention = cases.filter(needsPerson).sort((a, b) => riskRank(b) - riskRank(a))
	const started = cases.length > 0
	const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

	// One headline, taken from the state of the desk: what the product is on an empty desk, and otherwise what there is to do.
	const settledCount = cases.filter((c) => !isRunning(c)).length
	const head: { title: string; sub: string } = !started
		? { title: "AI investigates. Code decides.", sub: "Review supplier invoices, check what they claim against your records, and resolve payment risks before anything is approved." }
		: snapshot.provider
			? { title: "Processing is paused", sub: `The model provider is refusing calls (${snapshot.provider.kind.replace(/_/g, " ")}). ${snapshot.provider.advice} Everything already decided is kept.` }
			: running
				? { title: "The agents are working", sub: `${settledCount} of ${n(cases.length, "document")} settled. Decisions appear below as each one is made.` }
				: attention.length
					? { title: `${n(attention.length, "payment")} ${attention.length === 1 ? "needs" : "need"} your decision`, sub: `${blocked.length ? `${blocked.length} blocked` : ""}${blocked.length && waiting.length ? ", " : ""}${waiting.length ? `${waiting.length} waiting for approval` : ""}.${failed.length ? ` ${n(failed.length, "document")} could not be processed.` : ""}` }
					: failed.length
						? { title: "Nothing is waiting for you", sub: `${n(failed.length, "document")} could not be processed and can be run again from Payments.` }
						: { title: "Nothing is waiting for you", sub: "Every payment has been checked and settled." }

	const pending = sumOf(waiting, policy.currency)
	const ok = sumOf(approved, policy.currency)
	const held = sumOf(blocked, policy.currency)

	return (
		<main className="view">
			<PageHead kicker="Accounts payable workspace" title={head.title} sub={head.sub}>
				{started && attention.length > 0 && <a className="btn btn-primary" href={href("queue")}>Review payments <ArrowRight size={13} className="nudge" /></a>}
			</PageHead>

			{!started ? (
				<section className="onboard glass" aria-label="Getting started">
					<div className="onboard-copy">
						<p className="onboard-lead">Five AI agents read each invoice and check it against your vendor records. Rules in code decide what may be paid, and every figure opens its source.</p>
						<div className="actions">
							<a className="btn btn-primary btn-lg" href={href("showcase")}><Play size={12} weight="fill" /> Start demo</a>
							<button className="btn btn-lg" disabled={!canAct} onClick={onAdd}><Plus size={14} weight="bold" /> Add document</button>
						</div>
						<p className="fine">The demo runs four synthetic invoices, about a minute each to read. Or <button type="button" className="linkish" disabled={!canAct || starting} onClick={onRun}>{starting && <Spinner />}load all sixteen</button>.</p>
					</div>
					<figure className="onboard-preview" aria-label="Illustrative examples of the three outcomes. Not real payments.">
						<figcaption><span>What you will see</span><span className="tag line">Illustrative examples</span></figcaption>
						<ul>
							{EXAMPLES.map((x) => (
								<li key={x.name}>
									<span className={`attn-mark ${x.tone === "good" ? "tone-good" : x.tone === "bad" ? "tone-bad" : "tone-warn"}`} aria-hidden />
									<span className="eg-main"><b>{x.name}</b><span>{x.why}</span></span>
									<span className={`status ${x.tone}`}><i aria-hidden />{x.status}</span>
								</li>
							))}
						</ul>
						<p className="fine">These three rows are examples, not payments. Nothing here is counted anywhere.</p>
					</figure>
				</section>
			) : (
				<>
					<section className="metrics" aria-label="Financial summary">
						<a className="metric hero glass" data-glow href={href("queue")}>
							<span className="k">Pending review <ArrowRight size={13} className="go" /></span>
							<span className="v"><Tick value={pending.main?.minor ?? 0}><Figure minor={pending.main?.minor ?? 0} ccy={pending.main?.currency ?? policy.currency} /></Tick></span>
							<span className="s">{waiting.length ? `${n(waiting.length, "payment")} awaiting approval${pending.rest ? ` · plus ${pending.rest}` : ""}` : "Nothing is awaiting approval"}</span>
						</a>
						<a className="metric glass" data-glow href={href("inbox")}>
							<span className="k">Approved <ArrowRight size={13} className="go" /></span>
							<span className="v"><Tick value={ok.main?.minor ?? 0}><Figure minor={ok.main?.minor ?? 0} ccy={ok.main?.currency ?? policy.currency} /></Tick></span>
							<span className="s">{approved.length ? `${n(approved.length, "payment")} · ${auto} automatic${ok.rest ? ` · plus ${ok.rest}` : ""}` : "None yet"}</span>
						</a>
						<a className="metric glass" data-glow href={href("firewall")} title="The sum of the amounts requested by blocked payments, each counted once. Not money saved: a block does not prove a loss would have happened.">
							<span className="k">Blocked exposure <ArrowRight size={13} className="go" /></span>
							<span className="v"><Tick value={held.main?.minor ?? 0}>{blocked.length > 0 && !held.main ? <span className="fig none">Unavailable</span> : <Figure minor={held.main?.minor ?? 0} ccy={held.main?.currency ?? policy.currency} />}</Tick></span>
							<span className="s">{blocked.length ? `${n(blocked.length, "payment")} held by the firewall${held.unread ? ` · ${held.unread} with no readable amount` : ""}` : "Nothing is blocked"}</span>
						</a>
						<div className="metric glass">
							<span className="k">Auto-approval limit used</span>
							<span className="v"><Tick value={Math.round(used * 100)}><span className="fig">{Math.round(used * 100)}<span className="dec">%</span></span></Tick></span>
							<span className={`meter${used > 0.8 ? " warn" : ""}`} role="img" aria-label={`${Math.round(used * 100)} percent of the daily auto-approve budget used`}><span style={{ transform: `scaleX(${Math.min(1, used)})` }} /></span>
							<span className="s">{amount(snapshot.dailyAutoApproved)} of {money(policy.dailyAutoApproveBudget, policy.currency)} today</span>
						</div>
					</section>

					<div className="ov">
						<section className="sec">
							<div className="sec-title"><h2>Needs your attention</h2><span className="right">{attention.length > 3 && <a className="linkish" href={href("queue")}>View all {attention.length} <ArrowRight size={12} /></a>}</span></div>
							<div className="panel">
								{attention.length > 0 ? (
									<div className="attn">
										{attention.slice(0, 3).map((c) => <AttentionRow key={c.id} c={c} />)}
									</div>
								) : (
									<div className="empty"><span className="ico" aria-hidden><CheckCircle size={18} /></span><h2>{running ? "The agents are still working" : "Nothing is waiting for you"}</h2><p>{running ? "Blocked payments and payments that need approval appear here as each one is decided." : "Every payment has been approved, rejected or set aside."}</p></div>
								)}
							</div>
						</section>

						<section className="sec">
							<div className="sec-title"><h2>The agents</h2><span className="right"><a className="linkish" href={href("activity")}>Watch them work <ArrowRight size={12} /></a></span></div>
							<div className="panel module">
								<MiniAgents scene={scene} />
								<p className="law-story">{scene.story}</p>
								{investigated > 0 && <p className="fine">{n(investigated, "exception")} went to the Investigator.</p>}
							</div>
						</section>
					</div>
				</>
			)}

			<Guide snapshot={snapshot} />
		</main>
	)
}

/** What an empty desk shows instead of four zeros: the three kinds of outcome, as labelled examples. They are text, not cases, and are counted nowhere. */
const EXAMPLES: { name: string; why: string; status: string; tone: "good" | "bad" | "warn" }[] = [
	{ name: "Supplier invoice", why: "Matches the vendor record and is under the limit.", status: "Verified", tone: "good" },
	{ name: "Changed bank account", why: "The account is not the one on file.", status: "Blocked", tone: "bad" },
	{ name: "Two amounts in one document", why: "Held until a vendor confirmation settles it.", status: "Needs review", tone: "warn" },
]

/** One exception a person has to look at: who, how much, the single reason that matters most, and where to act. */
function AttentionRow({ c }: { c: PaymentCase }) {
	const top = flagged(c)[0]
	return (
		<a className="attn-row" href={href("queue", c.id)}>
			<span className={`attn-mark ${c.stage === "blocked" ? "tone-bad" : "tone-warn"}`} aria-hidden />
			<span className="attn-main">
				<span className="name">{titleOf(c)}</span>
				<span className="why" title={top?.detail}>{top ? issueLine(top) : "The policy asks for a person before this is paid."}</span>
			</span>
			<span className="attn-side">
				<span className="amt">{c.exposure ? <Money value={c.exposure.minor} ccy={c.exposure.currency} /> : <span className="muted">no amount</span>}</span>
				<StageStatus stage={c.stage} />
			</span>
			<ArrowRight size={14} className="go" aria-hidden />
		</a>
	)
}

/**
 * An optional path for someone opening the app for the first time. Every step is a real link or action, and a step that
 * needs state that does not exist yet says what it is waiting for instead of pretending.
 */
function Guide({ snapshot }: Pick<Props, "snapshot">) {
	const [open, setOpen] = useState(() => { try { return localStorage.getItem("pd-guide") === "open" } catch { return false } })
	const { cases } = snapshot
	const running = cases.some(isRunning)
	const blocked = cases.find((c) => c.stage === "blocked" && c.extraction.result)
	const approved = cases.find((c) => outcomeOf(c) === "AUTO_APPROVED")
	const sourced = approved ?? blocked
	const line = sourced ? Object.values(sourced.ledger).find((e) => e.id === "X:gross")?.doc?.lineStart : null
	const wait = cases.length ? (running ? "still processing" : "none in this run") : "after step 1"
	return (
		<details className="guide" open={open} onToggle={(e) => { const o = (e.currentTarget as HTMLDetailsElement).open; setOpen(o); try { localStorage.setItem("pd-guide", o ? "open" : "closed") } catch { /* private mode */ } }}>
			<summary><CaretRight size={12} weight="bold" className="caret" /><FileText size={15} /> New here? A three-minute path through the product</summary>
			<ol className="guide-steps">
				<li><b>Start the guided demo</b><span>Four synthetic scenarios, one at a time, through the real workflow.</span>{cases.length ? <span className="status good"><i aria-hidden />{cases.length} {cases.length === 1 ? "document" : "documents"} on the desk</span> : <span className="muted">the button above</span>}</li>
				<li><b>Inspect a blocked payment</b><span>No approve button exists for it, and the reason is a control in code.</span>{blocked ? <a className="linkish" href={href("firewall", blocked.id)}>{titleOf(blocked)} <ArrowRight size={12} /></a> : <span className="muted">{wait}</span>}</li>
				<li><b>Verify a figure at its source</b><span>In a payment, select any reference{line ? <> such as <span className="mono">line {line}</span></> : ""}: the line lights up in the document.</span>{sourced ? <a className="linkish" href={href("inbox", sourced.id)}>Open {titleOf(sourced)} <ArrowRight size={12} /></a> : <span className="muted">{wait}</span>}</li>
				<li><b>Watch the agents collaborate</b><span>One lane per agent; overlap is real concurrency from recorded timestamps.</span><a className="linkish" href={href("activity")}>Agent Activity <ArrowRight size={12} /></a></li>
				<li><b>Check outcomes against the scenario file</b><span>Expected and actual, side by side, for every synthetic document.</span><a className="linkish" href={href("audit", "scenarios")}>Scenario check <ArrowRight size={12} /></a></li>
				<li><b>Open the Stress lab</b><span>Twelve reproducible scenarios, and a test of what catches a wrong agent. No API key; a few seconds.</span><span><a className="linkish" href={href("lab")}>Stress lab <ArrowRight size={12} /></a> · <a className="linkish" href={href("lab", "experiment")}>Fault-injection test <ArrowRight size={12} /></a></span></li>
			</ol>
		</details>
	)
}
