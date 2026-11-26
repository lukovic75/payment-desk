import { ArrowRight, Play, Plus } from "@phosphor-icons/react"
import type { DeskSnapshot, Tokens } from "../lib/api"
import { auditOf, concurrencyOf, isRunning, loopsOf, riskRank, type AuditEvent } from "../lib/derive"
import { amount, clock, count, duration, money } from "../lib/format"
import { go, href } from "../lib/router"
import { Prov, Spinner, Tick } from "../components/bits"
import { PaymentRow } from "../components/PaymentList"
import { Timeline, useNow } from "../components/Timeline"

type Props = { snapshot: DeskSnapshot; tokens: Tokens; canAct: boolean; starting: boolean; onRun: () => void; onAdd: () => void }

export function Overview({ snapshot, tokens, canAct, starting, onRun, onAdd }: Props) {
	const { cases, policy } = snapshot
	const running = cases.some(isRunning)
	const awaiting = cases.filter((c) => c.stage === "awaiting_approval")
	const approved = cases.filter((c) => c.stage === "approved")
	const sum = (list: typeof cases) => list.reduce((s, c) => s + (c.extraction.result?.amount ?? 0), 0)
	const used = policy.dailyAutoApproveBudget > 0 ? snapshot.dailyAutoApproved / policy.dailyAutoApproveBudget : 0
	const tokenTotal = Object.values(tokens).reduce((s, t) => s + t.input + t.output, 0)
	const calls = Object.values(tokens).reduce((s, t) => s + t.calls, 0)
	const loops = loopsOf(cases)
	const now = useNow(running)
	const conc = concurrencyOf(loops, now)
	const queue = [...awaiting].sort((a, b) => riskRank(b) - riskRank(a)).slice(0, 6)
	const decisions = auditOf(cases).filter((e) => e.actorKind === "guard" || e.actorKind === "human").slice(0, 7)
	const started = snapshot.startedAt != null

	return (
		<main className="view">
			<section className="kpis" aria-label="Financial summary">
				<a className="kpi" href={href("inbox")}>
					<span className="k">Documents received <ArrowRight size={12} className="kpi-go" /></span>
					<span className="v"><Tick value={cases.length} /></span>
					<span className="s">{started ? `${cases.filter((c) => c.extraction.result?.isPaymentRequest).length} payment requests` : `${snapshot.inboxWaiting} waiting to be processed`}</span>
				</a>
				<a className="kpi" href={href("queue")}>
					<span className="k">Awaiting approval <ArrowRight size={12} className="kpi-go" /></span>
					<span className="v"><Tick value={awaiting.length} /></span>
					<span className="s">{awaiting.length ? money(sum(awaiting), policy.currency) : "nothing is waiting"}</span>
				</a>
				<a className="kpi" href={href("inbox")}>
					<span className="k">Approved payments <ArrowRight size={12} className="kpi-go" /></span>
					<span className="v"><Tick value={approved.length} /></span>
					<span className="s">{approved.length ? `${approved.filter((c) => c.approval?.by === "policy").length} by policy, ${approved.filter((c) => c.approval?.by === "human").length} by a person` : "none yet"}</span>
				</a>
				<div className="kpi">
					<span className="k">Approved amount</span>
					<span className="v"><Tick value={sum(approved).toFixed(2)}>{amount(sum(approved))}</Tick><small>{policy.currency}</small></span>
					<span className="s">drafts only, nothing sent</span>
				</div>
				<div className="kpi">
					<span className="k">Daily auto-approve limit</span>
					<span className="v"><Tick value={Math.round(used * 100)}>{Math.round(used * 100)}%</Tick><small>used</small></span>
					<span className="s">{amount(snapshot.dailyAutoApproved)} of {money(policy.dailyAutoApproveBudget, policy.currency)}</span>
					<span className={`meter${used > 0.8 ? " warn" : ""}`} role="img" aria-label={`${Math.round(used * 100)} percent of the daily auto-approve budget used`}><span style={{ transform: `scaleX(${Math.min(1, used)})` }} /></span>
				</div>
				<a className="kpi" href={href("activity")}>
					<span className="k">Model usage <ArrowRight size={12} className="kpi-go" /></span>
					{tokenTotal > 0
						? <><span className="v"><Tick value={Math.round(tokenTotal / 1000)}>{count(Math.round(tokenTotal / 1000))}k</Tick><small>tokens</small></span><span className="s">{count(calls)} model calls this run</span></>
						: <><span className="v none">No usage yet</span><span className="s">reported per model call</span></>}
				</a>
			</section>

			{!started ? (
				<section className="panel">
					<div className="empty" style={{ maxWidth: "70ch" }}>
						<h2>{snapshot.inboxWaiting} documents are waiting in the inbox</h2>
						<p>Supplier invoices in five languages, a reminder that repeats one of them, an invoice with “new bank details”, one from a vendor nobody has approved, and a newsletter. Process them and the payments that need a person land in the review queue, exceptions first.</p>
						<div className="actions">
							<button className="btn btn-primary" disabled={!canAct || starting} onClick={onRun}>{starting ? <Spinner /> : <Play size={13} weight="fill" />} Process inbox</button>
							<button className="btn" disabled={!canAct} onClick={onAdd}><Plus size={14} weight="bold" /> Add a document</button>
						</div>
					</div>
					<div className="steps">
						<div className="step agent-Extractor"><b><span className="swatch" />Extractor</b><p>Reads every document at once and quotes the line each value came from.</p></div>
						<div className="step agent-Validator"><b><span className="swatch" />Validator</b><p>Checks vendor, IBAN and duplicates against the vendor master, in parallel with the Auditor.</p></div>
						<div className="step agent-Auditor"><b><span className="swatch" />Auditor</b><p>Re-reads the original and verifies each extracted number independently.</p></div>
						<div className="step agent-Policy"><b><span className="swatch" />Policy</b><p>Routes the payment. A deterministic guard holds the floor; a person approves the rest.</p></div>
					</div>
				</section>
			) : (
				<div className="ov">
					<section className="panel">
						<div className="panel-head"><h2>Needs your review</h2><span className="right">{awaiting.length > 0 && <a className="linkish" href={href("queue")}>Open the queue <ArrowRight size={12} /></a>}</span></div>
						{queue.length > 0 ? (
							<div className="rows">{queue.map((c) => <PaymentRow key={c.id} c={c} view="queue" />)}</div>
						) : (
							<div className="empty"><h2>{running ? "The agents are still working" : "Nothing is waiting for you"}</h2><p>{running ? "Payments that need a person appear here as each one is routed." : "Every payment has been approved, rejected or set aside."}</p></div>
						)}
						{awaiting.length > queue.length && <div className="panel-body muted" style={{ borderTop: "1px solid var(--line)", fontSize: "var(--fs-12)" }}>and {awaiting.length - queue.length} more in the queue</div>}
					</section>

					<section className="panel">
						<div className="panel-head"><h2>Agent activity</h2><span className="right"><a className="linkish" href={href("activity")}>Details <ArrowRight size={12} /></a></span></div>
						<div className="stats three">
							<div className="stat"><span className="k">Peak in parallel</span><span className="v"><Tick value={conc.peak} /><small>loops at once</small></span></div>
							<div className="stat"><span className="k">Agent time</span><span className="v">{duration(conc.agentMs)}<small>in {duration(conc.wallMs)}</small></span></div>
							<div className="stat"><span className="k">Concurrency gain <Prov kind="computed" label="" /></span>{conc.speedup ? <span className="v">{conc.speedup.toFixed(1)}×<small>vs one at a time</small></span> : <span className="v none">n/a</span>}</div>
						</div>
						<div className={`live-surface${running ? " is-live" : ""}`}><Timeline loops={loops} scope="inbox" live={running} onSelect={(id) => go("inbox", id)} /></div>
					</section>

					<section className="panel full">
						<div className="panel-head"><h2>Latest decisions</h2><span className="right"><a className="linkish" href={href("audit")}>Audit trail <ArrowRight size={12} /></a></span></div>
						{decisions.length > 0 ? <DecisionFeed events={decisions} /> : <div className="empty"><p>Decisions by the policy guard and by people appear here as they are made.</p></div>}
					</section>
				</div>
			)}
		</main>
	)
}

function DecisionFeed({ events }: { events: AuditEvent[] }) {
	return (
		<div className="grid-table" style={{ ["--cols" as string]: "76px 130px minmax(140px, 240px) minmax(0, 1fr)" }}>
			{events.map((e, i) => (
				<div className="tr" key={i}>
					<span className="t">{clock(e.at)}</span>
					<span className="who"><Prov kind={e.actorKind === "human" ? "human" : "computed"} label={e.actorKind === "human" ? "Human" : "Policy guard"} /></span>
					<a className="pay truncate" href={href("inbox", e.caseId)}>{e.title}</a>
					<span className="wide soft">{e.detail}</span>
				</div>
			))}
		</div>
	)
}
