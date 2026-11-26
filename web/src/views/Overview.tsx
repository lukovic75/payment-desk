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

	const sub = !started
		? "Five specialised agents read each invoice, check it against trusted records and flag what is risky. Controls in code decide what may be paid."
		: running
			? `The agents are working: ${cases.filter((c) => !isRunning(c)).length} of ${cases.length} documents are settled.`
			: attention.length
				? `${n(attention.length, "payment")} ${attention.length === 1 ? "needs" : "need"} a decision from you.${failed.length ? ` ${n(failed.length, "document")} could not be processed.` : ""}`
				: failed.length ? `${n(failed.length, "document")} could not be processed. Nothing else is waiting for you.` : "Every payment is verified and settled. Nothing is waiting for you."

	const pending = sumOf(waiting, policy.currency)
	const ok = sumOf(approved, policy.currency)
	const held = sumOf(blocked, policy.currency)

	return (
		<main className="view">
			<PageHead title="Your payments. Verified before approval." sub={sub}>
				{started && attention.length > 0 && <a className="btn btn-primary" href={href("queue")}>Review payments <ArrowRight size={13} className="nudge" /></a>}
				{started && <a className="btn" href={href("activity")}>See how the agents work</a>}
			</PageHead>

			{!started ? (
				<section className="onboard glass">
					<div className="onboard-copy">
						<h2>AI investigates. Code decides.</h2>
						<p>Payment Desk does not trust what one AI reads from an invoice. A second agent reads the document on its own, code compares the two, exceptions are investigated, and controls in code decide what may be paid. See it on four synthetic scenarios.</p>
						<div className="actions">
							<a className="btn btn-primary" href={href("showcase")}><Play size={12} weight="fill" /> Start demo</a>
							<button className="btn" disabled={!canAct} onClick={onAdd}><Plus size={14} weight="bold" /> Add a document</button>
						</div>
						<p className="fine">Or <button type="button" className="linkish" disabled={!canAct || starting} onClick={onRun}>{starting && <Spinner />}load all sixteen synthetic documents at once</button>. Sandbox: synthetic data, nothing reaches a bank.</p>
					</div>
					<ul className="onboard-agents">
						{snapshot.agents.map((a) => <li key={a.id} className={`agent-${a.name}`}><span className="swatch" /><b>{a.name}</b><span>{a.role}.</span></li>)}
					</ul>
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
								<p className="fine">{investigated > 0 ? `${n(investigated, "exception")} went to the Investigator. ` : ""}An agent can explain and can ask for something stricter. It cannot approve what the controls stop.</p>
							</div>
						</section>
					</div>
				</>
			)}

			<Guide snapshot={snapshot} />
		</main>
	)
}

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
				<li><b>Start the guided demo</b><span>Four synthetic scenarios, one at a time, through the real workflow.</span>{cases.length ? <span className="status good"><i aria-hidden />{cases.length} {cases.length === 1 ? "document" : "documents"} on the desk</span> : <a className="linkish" href={href("showcase")}>Interactive Showcase <ArrowRight size={12} /></a>}</li>
				<li><b>Inspect a blocked payment</b><span>No approve button exists for it, and the reason is a control in code.</span>{blocked ? <a className="linkish" href={href("firewall", blocked.id)}>{titleOf(blocked)} <ArrowRight size={12} /></a> : <span className="muted">{wait}</span>}</li>
				<li><b>Verify a figure at its source</b><span>In a payment, select any reference{line ? <> such as <span className="mono">line {line}</span></> : ""}: the line lights up in the document.</span>{sourced ? <a className="linkish" href={href("inbox", sourced.id)}>Open {titleOf(sourced)} <ArrowRight size={12} /></a> : <span className="muted">{wait}</span>}</li>
				<li><b>Watch the agents collaborate</b><span>One lane per agent; overlap is real concurrency from recorded timestamps.</span><a className="linkish" href={href("activity")}>Agent Activity <ArrowRight size={12} /></a></li>
				<li><b>Check outcomes against the scenario file</b><span>Expected and actual, side by side, for every synthetic document.</span><a className="linkish" href={href("audit", "scenarios")}>Scenario check <ArrowRight size={12} /></a></li>
				<li><b>Open the Financial Stress Lab</b><span>Twelve reproducible scenarios. The deterministic path needs no API key and takes seconds.</span><a className="linkish" href={href("lab")}>Stress Lab <ArrowRight size={12} /></a></li>
			</ol>
		</details>
	)
}
