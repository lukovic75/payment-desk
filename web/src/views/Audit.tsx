import { useMemo, useState } from "react"
import { CaretRight, CheckCircle, DownloadSimple, Hourglass, MagnifyingGlass, XCircle } from "@phosphor-icons/react"
import { useSummary, type DeskSnapshot } from "../lib/api"
import { auditOf, isRunning, outcomeOf, titleOf, type ActorKind, type AuditEvent } from "../lib/derive"
import { clock } from "../lib/format"
import { go, href } from "../lib/router"
import { DispositionTag, Prov, Spinner, StageStatus, dispositionLabel } from "../components/bits"
import { Empty, Long, PageHead, Seg, Tabs } from "../components/ui"

const ACTORS: { value: "all" | ActorKind; label: string }[] = [
	{ value: "all", label: "Everyone" },
	{ value: "agent", label: "Agents" },
	{ value: "firewall", label: "Firewall" },
	{ value: "human", label: "People" },
	{ value: "desk", label: "Desk" },
]


/** What the desk has done so far. Every number is counted by the server from the cases; nothing is shown for an empty desk. */
function Operations({ stamp, empty }: { stamp: string; empty: boolean }) {
	const s = useSummary(stamp)
	if (empty || !s || s.documents === 0) return null
	const o = s.outcomes
	const money = (list: { formatted: string; payments: number }[]) => list.length ? list.map((m) => `${m.formatted} in ${m.payments} payment${m.payments === 1 ? "" : "s"}`).join(" · ") : "none"
	return (
		<details className="guide ops" data-ops>
			<summary><CaretRight size={12} weight="bold" className="caret" /> What the desk has done: {s.documents} document{s.documents === 1 ? "" : "s"}, {o.autoApproved + o.approvedByPerson} approved, {o.waitingForPerson} waiting for a person, {o.blocked} blocked{o.processingErrors ? `, ${o.processingErrors} failed` : ""}</summary>
			<dl className="kv ops-kv">
				<div title={s.definitions.documents}><dt>Documents received</dt><dd>{s.documents} · {s.obligations} distinct invoice{s.obligations === 1 ? "" : "s"} · {s.processingAttempts} processing attempt{s.processingAttempts === 1 ? "" : "s"} · {s.agentLoops} agent loops</dd></div>
				<div><dt>Decisions in force</dt><dd>{o.autoApproved} approved automatically · {o.approvedByPerson} approved by a person · {o.waitingForPerson} waiting for a person · {o.blocked} blocked · {o.rejected} rejected{o.notPaymentRequests ? ` · ${o.notPaymentRequests} not a payment request` : ""}{o.processingErrors ? ` · ${o.processingErrors} processing error${o.processingErrors === 1 ? "" : "s"}` : ""}{o.inProgress ? ` · ${o.inProgress} in progress` : ""}</dd></div>
				<div title={s.definitions.restricted}><dt>Blocked right now</dt><dd>{money(s.restricted.blocked)}</dd></div>
				<div title={s.definitions.restricted}><dt>Waiting for a person</dt><dd>{money(s.restricted.waitingForPerson)}</dd></div>
				<div><dt>Controls evaluated</dt><dd>{s.controls.evaluated} · {s.controls.passed} passed · {s.controls.notPassed} did not pass</dd></div>
				<div title={s.definitions.evidence}><dt>Values re-read against their source</dt><dd>{s.evidence.valuesChecked} · {s.evidence.verified} verified · {s.evidence.notMechanicallyCheckable} not checkable mechanically · {s.evidence.failed} failed</dd></div>
				<div><dt>Challenges</dt><dd>{s.challenges.raised} raised ({s.challenges.byAuditor} by the Auditor, {s.challenges.byValidator} by the Validator, {s.challenges.byCode} by code) · {s.challenges.settled} settled · {s.challenges.open} open</dd></div>
				<div><dt>Sandbox drafts</dt><dd>{s.sandboxDrafts}</dd></div>
			</dl>
			<p className="fine">Counted from the cases on this desk. Amounts are per currency and never added across currencies. A blocked or held amount is not a prevented loss, and nothing here measures time or money saved. <a className="linkish" href="/api/summary" target="_blank" rel="noreferrer">Open as JSON</a></p>
		</details>
	)
}

/** Assurance in one place: whether every figure still rests on its source, every recorded step, and expected against actual. */
export function Audit({ snapshot, id }: { snapshot: DeskSnapshot; id: string | null }) {
	const { cases } = snapshot
	const all = useMemo(() => auditOf(cases), [cases])
	const tab = id === "scenarios" ? "scenarios" : "trail"
	const [q, setQ] = useState("")
	const [actor, setActor] = useState<"all" | ActorKind>("all")
	const [pay, setPay] = useState("all")
	const [group, setGroup] = useState<"time" | "payment">("time")
	const needle = q.trim().toLowerCase()
	const shown = all.filter((e) => (actor === "all" || e.actorKind === actor) && (pay === "all" || e.caseId === pay) && (!needle || `${e.actor} ${e.title} ${e.caseId} ${e.detail}`.toLowerCase().includes(needle)))

	// Evidence integrity, from the verifier's own report on each case. A case without a report is left out, not counted as clean.
	const reports = cases.flatMap((c) => (c.integrity ? [c.integrity] : []))
	const values = reports.flatMap((r) => r.values)
	const checkable = values.filter((v) => v.correct !== null)
	const critical = reports.reduce((n, r) => n + r.findings.filter((f) => f.critical).length, 0)
	const entries = cases.reduce((n, c) => n + Object.keys(c.ledger).length, 0)

	const exportJson = () => {
		const body = { exportedAt: new Date().toISOString(), note: "Synthetic data. Sandbox demonstration.", events: shown, reviews: cases.flatMap((c) => c.review.map((r) => ({ caseId: c.id, ...r }))) }
		const a = document.createElement("a")
		a.href = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }))
		a.download = `payment-desk-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`
		a.click()
		URL.revokeObjectURL(a.href)
	}

	const row = (e: AuditEvent, i: number, withPayment: boolean) => (
		<li className={`trail-row ${e.actorKind}${e.kind === "error" ? " err" : ""} agent-${e.actor}`} key={i}>
			<span className="t">{clock(e.at)}</span>
			<span className="who">{e.actor}</span>
			<span className="what">{withPayment && <><a href={href("inbox", e.caseId)}>{e.title}</a> · </>}<Long text={e.detail} /></span>
		</li>
	)
	const groups = group === "payment" ? cases.map((c) => ({ c, events: shown.filter((e) => e.caseId === c.id).reverse() })).filter((g) => g.events.length > 0) : []

	return (
		<main className="view">
			<PageHead title="Evidence & Audit" sub="Every figure rests on a source that code has read again, and every step has an author and a time.">
				<button className="btn" onClick={exportJson} disabled={shown.length === 0}><DownloadSimple size={14} /> Export JSON</button>
			</PageHead>

			<section className="statbar glass" aria-label="Evidence integrity across the desk">
				<div className="stat"><span className="k">Evidence entries</span><span className="v">{entries}<small>in {cases.length} ledgers</small></span></div>
				<div className="stat" title="Values whose reference exists and resolves, out of all values the integrity verifier checked."><span className="k">References resolve <Prov kind="computed" label="" /></span>{values.length ? <span className="v">{values.filter((v) => v.present).length}<small>of {values.length}</small></span> : <span className="v none">Not measured</span>}</div>
				<div className="stat" title="Of the references that can be checked mechanically, those whose source really contains the value."><span className="k">Source supports value <Prov kind="computed" label="" /></span>{checkable.length ? <span className="v">{checkable.filter((v) => v.correct).length}<small>of {checkable.length} checkable</small></span> : <span className="v none">Not measured</span>}</div>
				<div className="stat"><span className="k">Critical findings</span>{reports.length ? <span className="v">{critical}<small>{critical ? "each blocks its payment" : "none"}</small></span> : <span className="v none">Not measured</span>}</div>
			</section>

			<Operations stamp={cases.map((c) => `${c.id}:${c.version}`).join("|")} empty={cases.length === 0} />

			<section className="sec">
				<Tabs value={tab} onChange={(t) => go("audit", t === "scenarios" ? "scenarios" : null, true)} label="Assurance views" tabs={[{ value: "trail", label: "Audit trail", count: all.length }, { value: "scenarios", label: "Scenario check" }]} />

				{tab === "trail" ? (
					<>
						<div className="tools">
							<label className="search"><span className="sr-only">Search the audit trail</span><MagnifyingGlass size={15} /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events" spellCheck={false} /></label>
							<Seg value={actor} onChange={setActor} options={ACTORS} label="Filter by actor" />
							<select className="select" aria-label="Filter by payment" value={pay} onChange={(e) => setPay(e.target.value)} style={{ maxWidth: 220 }}>
								<option value="all">All payments</option>
								{cases.map((c) => <option key={c.id} value={c.id}>{titleOf(c)} · {c.id}</option>)}
							</select>
							<Seg value={group} onChange={setGroup} options={[{ value: "time", label: "By time" }, { value: "payment", label: "By payment" }]} label="Group events" />
							<span className="n" aria-live="polite">{shown.length} of {all.length}</span>
						</div>
						<div className="panel">
							{all.length === 0 ? (
								<Empty title="No events yet">Once documents are processed, every agent step, firewall decision and human action is recorded here with its time and actor.</Empty>
							) : shown.length === 0 ? (
								<Empty icon={<MagnifyingGlass size={18} />} title="No events match" actions={<button className="btn" onClick={() => { setQ(""); setActor("all"); setPay("all") }}>Clear search and filters</button>}>Nothing in the trail matches this search and these filters.</Empty>
							) : group === "payment" ? (
								groups.map(({ c, events }) => (
									<div className="trail-group" key={c.id}>
										<div className="trail-gh"><a href={href("inbox", c.id)}>{titleOf(c)}</a><span className="mono muted">{c.id}</span><span className="right"><StageStatus stage={c.stage} /></span></div>
										<ol className="trail">{events.map((e, i) => row(e, i, false))}</ol>
									</div>
								))
							) : <ol className="trail">{shown.map((e, i) => row(e, i, true))}</ol>}
						</div>
						<p className="fine" style={{ maxWidth: "84ch" }}>{snapshot.persisted ? "The trail is saved with the case state on this machine and survives a server restart." : "The trail lives in memory for this run."} Running the demo again replaces the demo cases, so export what you need to keep. Human actions are recorded as “{snapshot.reviewer}”: this build has no sign-in.</p>
					</>
				) : <ScenarioCheck snapshot={snapshot} />}
			</section>
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
	const ok = rows.filter((r) => r.state === "ok").length
	const judged = rows.filter((r) => r.state === "ok" || r.state === "off").length
	if (rows.every((r) => r.state === "absent")) return <div className="panel"><Empty title="The demo inbox has not been run">Each synthetic document declares the outcome it should reach. Run the demo and this table sets that declaration beside what actually happened.</Empty></div>
	return (
		<>
			<p className="say">{judged ? <><b style={{ color: "var(--ink)" }}>{ok} of {judged}</b> documents were decided as the scenario file expects.</> : "The documents are still being processed."} The expectation is written in <span className="mono">server/data/scenarios.json</span> and is never shown to an agent.</p>
			<div className="panel">
				<div className="grid-table" style={{ ["--cols" as string]: "20px minmax(180px, 1.2fr) minmax(120px, 0.7fr) minmax(120px, 0.7fr) minmax(0, 2fr)" }}>
					<div className="tr h"><span /><span>Scenario</span><span>Expected</span><span>Actual</span><span>Why</span></div>
					{rows.map(({ s, c, got, state }) => (
						<div className="tr" key={s.docId}>
							<span className={`mark ${state}`} title={state === "ok" ? "as expected" : state === "off" ? "not as expected" : state === "moved" ? "changed by a person after the firewall decided" : state}>
								{state === "ok" ? <CheckCircle size={15} weight="fill" /> : state === "off" ? <XCircle size={15} weight="fill" /> : state === "running" ? <Spinner /> : <Hourglass size={15} />}
							</span>
							{c ? <a className="pay" href={href("inbox", s.docId)}>{s.title} <span className="mono muted" style={{ fontWeight: 400 }}>{s.docId}</span></a> : <span>{s.title}</span>}
							<span className="soft">{s.expect.map(dispositionLabel).join(" or ")}</span>
							<span>{got && state !== "running" ? <DispositionTag value={got} /> : <span className="muted">{state === "running" ? "processing" : "not run"}</span>}</span>
							<span className="wide soft">{s.why}</span>
						</div>
					))}
				</div>
			</div>
		</>
	)
}
