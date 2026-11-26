import { ArrowRight, CheckCircle, Hourglass, Play, Plus, XCircle } from "@phosphor-icons/react"
import type { DeskSnapshot } from "../lib/api"
import { auditOf, concurrencyOf, isRunning, loopsOf, needsPerson, outcomeOf, riskRank, usageOf, type AuditEvent } from "../lib/derive"
import { amount, clock, count, duration, money, totalsText } from "../lib/format"
import { go, href } from "../lib/router"
import { DispositionTag, Prov, Spinner, Tick, dispositionLabel } from "../components/bits"
import { PaymentRow } from "../components/PaymentList"
import { Timeline, useNow } from "../components/Timeline"

type Props = { snapshot: DeskSnapshot; canAct: boolean; starting: boolean; onRun: () => void; onAdd: () => void }

export function Overview({ snapshot, canAct, starting, onRun, onAdd }: Props) {
	const { cases, policy } = snapshot
	const running = cases.some(isRunning)
	const requests = cases.filter((c) => c.stage !== "not_a_payment")
	const auto = cases.filter((c) => outcomeOf(c) === "AUTO_APPROVED")
	const waiting = cases.filter((c) => c.stage === "awaiting_approval")
	const blocked = cases.filter((c) => c.stage === "blocked")
	const has = (id: string) => (c: (typeof cases)[number]) => c.controls.some((k) => k.id === id && (k.status === "fail" || k.status === "review"))
	const duplicates = cases.filter(has("duplicate"))
	const conflicts = cases.filter(has("beneficiary"))
	const used = policy.dailyAutoApproveBudget > 0 ? snapshot.dailyAutoApproved / policy.dailyAutoApproveBudget : 0
	const loops = loopsOf(cases)
	const usage = usageOf(loops)
	const now = useNow(running)
	const conc = concurrencyOf(loops, now)
	const queue = cases.filter(needsPerson).sort((a, b) => riskRank(b) - riskRank(a)).slice(0, 6)
	const decisions = auditOf(cases).filter((e) => e.actorKind === "firewall" || e.actorKind === "human").slice(0, 7)
	const started = cases.length > 0
	const sum = (list: typeof cases) => totalsText(list.map((c) => c.exposure))

	return (
		<main className="view">
			<section className="kpis eight" aria-label="Financial defence summary">
				<a className="kpi" href={href("inbox")}>
					<span className="k">Payment requests <ArrowRight size={12} className="kpi-go" /></span>
					<span className="v"><Tick value={requests.length} /></span>
					<span className="s">{started ? `${cases.length} documents received` : `${snapshot.inboxWaiting} scenario documents ready`}</span>
				</a>
				<div className="kpi">
					<span className="k">Approved automatically</span>
					<span className="v"><Tick value={auto.length} /></span>
					<span className="s">{auto.length ? sum(auto) : "none yet"}</span>
				</div>
				<a className="kpi" href={href("queue")}>
					<span className="k">Awaiting review <ArrowRight size={12} className="kpi-go" /></span>
					<span className="v"><Tick value={waiting.length} /></span>
					<span className="s">{waiting.length ? sum(waiting) : "nothing is waiting"}</span>
				</a>
				<a className="kpi" href={href("queue")}>
					<span className="k">Blocked requests <ArrowRight size={12} className="kpi-go" /></span>
					<span className="v"><Tick value={blocked.length} /></span>
					<span className="s" title="The sum of the amounts requested by blocked payments, each counted once. Not money saved: a block does not prove a loss would have happened.">{blocked.length ? `${sum(blocked) || "no amount readable"} blocked exposure` : "none"}</span>
				</a>
				<div className="kpi">
					<span className="k">Duplicates detected</span>
					<span className="v"><Tick value={duplicates.length} /></span>
					<span className="s">{duplicates.length ? "by invoice number, history or content hash" : "none"}</span>
				</div>
				<div className="kpi">
					<span className="k">Beneficiary conflicts</span>
					<span className="v"><Tick value={conflicts.length} /></span>
					<span className="s">{conflicts.length ? "IBAN differs from the vendor master" : "none"}</span>
				</div>
				<div className="kpi">
					<span className="k">Daily auto-approve budget</span>
					<span className="v"><Tick value={Math.round(used * 100)}>{Math.round(used * 100)}%</Tick><small>used</small></span>
					<span className="s">{amount(snapshot.dailyAutoApproved)} of {money(policy.dailyAutoApproveBudget, policy.currency)}</span>
					<span className={`meter${used > 0.8 ? " warn" : ""}`} role="img" aria-label={`${Math.round(used * 100)} percent of the daily auto-approve budget used`}><span style={{ transform: `scaleX(${Math.min(1, used)})` }} /></span>
				</div>
				<a className="kpi" href={href("activity")}>
					<span className="k">Model usage <ArrowRight size={12} className="kpi-go" /></span>
					{usage.tokens > 0
						? <><span className="v"><Tick value={Math.round(usage.tokens / 1000)}>{count(Math.round(usage.tokens / 1000))}k</Tick><small>tokens</small></span><span className="s">reported by the provider for {usage.reported} loops{usage.unreported ? `; ${usage.unreported} without a report` : ""}</span></>
						: <><span className="v none">Unavailable</span><span className="s">{loops.length ? "the provider reported no usage for this run" : "no model call yet"}</span></>}
				</a>
			</section>

			{!started ? (
				<section className="panel">
					<div className="empty" style={{ maxWidth: "74ch" }}>
						<h2>A payment firewall with five agents and one set of rules they cannot bend</h2>
						<p>{snapshot.inboxWaiting} synthetic documents are ready: clean invoices, a changed bank account, three kinds of duplicate, a total that does not add up, an unknown vendor, a missing IBAN, a prompt injection, conflicting amounts and a possible split payment. Run them through the real workflow and compare each outcome with what the scenario file says should happen.</p>
						<div className="actions">
							<button className="btn btn-primary" disabled={!canAct || starting} onClick={onRun}>{starting ? <Spinner /> : <Play size={13} weight="fill" />} Run demo scenarios</button>
							<button className="btn" disabled={!canAct} onClick={onAdd}><Plus size={14} weight="bold" /> Add a document</button>
						</div>
					</div>
					<div className="steps five">
						{snapshot.agents.map((a) => <div key={a.id} className={`step agent-${a.name}`}><b><span className="swatch" />{a.name}</b><p>{a.role}.</p></div>)}
					</div>
				</section>
			) : (
				<div className="ov">
					<section className="panel">
						<div className="panel-head"><h2>Needs a person</h2><span className="right">{queue.length > 0 && <a className="linkish" href={href("queue")}>Open the queue <ArrowRight size={12} /></a>}</span></div>
						{queue.length > 0 ? (
							<div className="rows">{queue.map((c) => <PaymentRow key={c.id} c={c} view="queue" />)}</div>
						) : (
							<div className="empty"><h2>{running ? "The agents are still working" : "Nothing is waiting for you"}</h2><p>{running ? "Blocked payments and payments that need approval appear here as each one is decided." : "Every payment has been approved, rejected or set aside."}</p></div>
						)}
						{cases.filter(needsPerson).length > queue.length && <div className="panel-body muted" style={{ borderTop: "1px solid var(--line)", fontSize: "var(--fs-12)" }}>and {cases.filter(needsPerson).length - queue.length} more in the queue</div>}
					</section>

					<section className="panel">
						<div className="panel-head"><h2>Agent activity</h2><span className="right"><a className="linkish" href={href("activity")}>Details <ArrowRight size={12} /></a></span></div>
						<div className="stats three">
							<div className="stat"><span className="k">Peak in parallel</span><span className="v"><Tick value={conc.peak} /><small>loops at once</small></span></div>
							<div className="stat"><span className="k">Agent time</span><span className="v">{duration(conc.agentMs)}<small>in {duration(conc.wallMs)}</small></span></div>
							<div className="stat"><span className="k">Concurrency gain <Prov kind="computed" label="" /></span>{conc.speedup ? <span className="v">{conc.speedup.toFixed(1)}×<small>vs one at a time</small></span> : <span className="v none">n/a</span>}</div>
						</div>
						<div className={`live-surface${running ? " is-live" : ""}`}><Timeline loops={loops} scope="inbox" live={running} compact onSelect={(id) => go("inbox", id)} /></div>
					</section>

					<ScenarioCheck snapshot={snapshot} />

					<section className="panel full">
						<div className="panel-head"><h2>Latest decisions</h2><span className="right"><a className="linkish" href={href("audit")}>Audit trail <ArrowRight size={12} /></a></span></div>
						{decisions.length > 0 ? <DecisionFeed events={decisions} /> : <div className="empty"><p>Decisions by the firewall and by people appear here as they are made.</p></div>}
					</section>
				</div>
			)}
		</main>
	)
}

/** Expected against actual for every synthetic scenario: the fastest way to see that the workflow did what it claims. */
function ScenarioCheck({ snapshot }: { snapshot: DeskSnapshot }) {
	const rows = snapshot.scenarios.map((s) => {
		const c = snapshot.cases.find((k) => k.id === s.docId && k.origin === "demo")
		const got = c ? outcomeOf(c) : null
		const settled = c != null && !isRunning(c)
		const humanMoved = c?.review.some((r) => r.outcome === "applied" && r.reviewer !== "Firewall") ?? false
		return { s, c, got, state: !c ? "absent" : !settled ? "running" : humanMoved ? "moved" : s.expect.includes(got!) ? "ok" : "off" }
	})
	if (rows.every((r) => r.state === "absent")) return null
	const ok = rows.filter((r) => r.state === "ok").length
	const judged = rows.filter((r) => r.state === "ok" || r.state === "off").length
	return (
		<section className="panel full">
			<div className="panel-head"><h2>Scenario check</h2><span className="right">{judged ? `${ok} of ${judged} decided as the scenario file expects` : "running"} · <span className="mono">server/data/scenarios.json</span></span></div>
			<div className="grid-table" style={{ ["--cols" as string]: "20px minmax(180px, 1.2fr) minmax(120px, 0.7fr) minmax(120px, 0.7fr) minmax(0, 2fr)" }}>
				<div className="tr h"><span /><span>Scenario</span><span>Expected</span><span>Actual</span><span>Why</span></div>
				{rows.map(({ s, c, got, state }) => (
					<div className="tr" key={s.docId}>
						<span className={`mark ${state}`} title={state === "ok" ? "as expected" : state === "off" ? "not as expected" : state === "moved" ? "changed by a person after the firewall decided" : state}>
							{state === "ok" ? <CheckCircle size={14} weight="bold" /> : state === "off" ? <XCircle size={14} weight="bold" /> : state === "running" ? <Spinner /> : <Hourglass size={14} />}
						</span>
						{c ? <a className="pay" href={href("inbox", s.docId)}>{s.title} <span className="mono muted" style={{ fontWeight: 400 }}>{s.docId}</span></a> : <span>{s.title}</span>}
						<span className="soft">{s.expect.map(dispositionLabel).join(" or ")}</span>
						<span>{got && state !== "running" ? <DispositionTag value={got} /> : <span className="muted">{state === "running" ? "processing" : "not run"}</span>}</span>
						<span className="wide soft">{s.why}</span>
					</div>
				))}
			</div>
		</section>
	)
}

function DecisionFeed({ events }: { events: AuditEvent[] }) {
	return (
		<div className="grid-table" style={{ ["--cols" as string]: "76px 130px minmax(140px, 240px) minmax(0, 1fr)" }}>
			{events.map((e, i) => (
				<div className="tr" key={i}>
					<span className="t">{clock(e.at)}</span>
					<span className="who"><Prov kind={e.actorKind === "human" ? "human" : "computed"} label={e.actorKind === "human" ? e.actor : "Firewall"} /></span>
					<a className="pay truncate" href={href("inbox", e.caseId)}>{e.title}</a>
					<span className="wide soft">{e.detail}</span>
				</div>
			))}
		</div>
	)
}
