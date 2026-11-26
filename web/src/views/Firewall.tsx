import { useEffect, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, CaretRight, ShieldCheck } from "@phosphor-icons/react"
import type { DeskSnapshot, EvidenceEntry, PaymentCase } from "../lib/api"
import { flagged, isBlocking, isRunning, needsPerson, riskRank, titleOf, type AgentName } from "../lib/derive"
import { cap, clock, fieldLabel, plain, totals, money, words } from "../lib/format"
import { go, href } from "../lib/router"
import { DispositionTag, Prov, StageStatus, StatusIcon, controlShort } from "../components/bits"
import { Actions, CATEGORY, Compare, EvidenceDrawer, ICON, Verdict, chipLabel, useEvidence } from "../components/PaymentDetail"
import { PaymentRow } from "../components/PaymentList"
import { Empty, Figure, Seg } from "../components/ui"

type Filter = "open" | "resolved" | "all"
const decidedByPerson = (c: PaymentCase) => c.review.some((r) => r.outcome === "applied" && r.reviewer !== "Firewall" && (r.action === "approve" || r.action === "reject"))

/** The firewall's own view of the desk: every payment a control stopped or flagged, and the evidence the control rests on. */
export function Firewall({ snapshot, id }: { snapshot: DeskSnapshot; id: string | null }) {
	const { cases, policy } = snapshot
	const [filter, setFilter] = useState<Filter>("open")
	const pool = cases.filter((c) => flagged(c).length > 0)
	const open = pool.filter(needsPerson)
	const resolved = pool.filter((c) => !needsPerson(c) && decidedByPerson(c))
	const blocked = cases.filter((c) => c.stage === "blocked")
	const blocking = pool.reduce((n, c) => n + c.controls.filter(isBlocking).length, 0)
	const held = totals(blocked.map((c) => c.exposure))
	const main = held.find((t) => t.currency === policy.currency) ?? held[0] ?? null
	const rest = held.filter((t) => t !== main).map((t) => money(t.minor, t.currency)).join(" · ")
	const list = (filter === "open" ? open : filter === "resolved" ? resolved : pool).sort((a, b) => riskRank(b) - riskRank(a))
	const current = id ? cases.find((c) => c.id === id) ?? null : null

	// On a wide screen the most serious open investigation is selected, so the workspace is never empty when there is work.
	useEffect(() => {
		if (id || window.innerWidth < 900) return
		const first = open.sort((a, b) => riskRank(b) - riskRank(a))[0]
		if (first) go("firewall", first.id, true)
	}, [id, cases])

	return (
		<main className="view split stack">
			<section className="statbar glass" aria-label="Firewall summary">
				<div className="stat"><span className="k">To investigate</span><span className="v">{open.length}<small>of {pool.length} flagged</small></span></div>
				<div className="stat" title="The sum of the amounts requested by blocked payments, each counted once. Not money saved: a block does not prove a loss would have happened."><span className="k">Blocked exposure</span>{blocked.length > 0 && !main ? <span className="v none">Unavailable</span> : <span className="v"><Figure minor={main?.minor ?? 0} ccy={main?.currency ?? policy.currency} />{rest && <small>plus {rest}</small>}</span>}</div>
				<div className="stat"><span className="k">Blocking controls failed <Prov kind="computed" label="" /></span><span className="v">{blocking}<small>checked in code</small></span></div>
				<div className="stat"><span className="k">Resolved</span><span className="v">{resolved.length}<small>decided by a person</small></span></div>
			</section>

			<div className="split-wrap" data-show={current ? "detail" : "list"}>
				<div className="list-pane glass">
					<div className="list-tools">
						<Seg value={filter} onChange={setFilter} label="Filter investigations" fill options={[{ value: "open", label: "Open", count: open.length }, { value: "resolved", label: "Resolved", count: resolved.length }, { value: "all", label: "All", count: pool.length }]} />
					</div>
					<div className="list-scroll">
						{list.length > 0 ? (
							<div className="rows" role="list" aria-label="Investigations">{list.map((c) => <div role="listitem" key={c.id}><PaymentRow c={c} view="firewall" current={c.id === id} /></div>)}</div>
						) : (
							<Empty icon={<ShieldCheck size={18} />} title={filter === "resolved" ? "Nothing resolved yet" : cases.length ? "No exceptions" : "Nothing to investigate"}>
								{filter === "resolved" ? "Investigations a person has approved or rejected are listed here." : cases.some(isRunning) ? "The agents are still working. A payment appears here the moment a control flags it." : cases.length ? "No control has flagged a payment that still needs a person." : "Run the demo and every payment a control stops or flags is listed here, the most serious first."}
							</Empty>
						)}
					</div>
				</div>
				<div className="detail-pane">
					{current ? <Investigation key={current.id} c={current} snapshot={snapshot} /> : (
						<Empty icon={<ShieldCheck size={18} />} title={id ? "That payment is not on the desk" : "Select an investigation"} center>
							{id ? `“${id}” is not a document in this run.` : "Each one shows the exception, the trusted record beside the incoming document, and what the agents found."}
						</Empty>
					)}
				</div>
			</div>
		</main>
	)
}

function nextAction(c: PaymentCase): string {
	if (c.stage === "blocked") return c.controls.find((k) => k.id === "beneficiary")?.status === "fail"
		? "Call the vendor on a number you already trust and record the callback reference, or reject the payment. It cannot be approved as it stands."
		: "Reject it, ask the vendor to verify, or run it again once the document is corrected. It cannot be approved as it stands."
	if (c.stage === "awaiting_approval") return "Look at the evidence, then approve or reject."
	if (c.stage === "error") return "An agent failed on this document. Run it again."
	if (isRunning(c)) return "The agents are still working on this document."
	return "Decided. No action is needed."
}

function Investigation({ c, snapshot }: { c: PaymentCase; snapshot: DeskSnapshot }) {
	const ev = useEvidence(c)
	const x = c.extraction.result
	const flags = flagged(c)
	const top = flags[0]
	const refs = [...new Set(flags.flatMap((k) => k.refs))].map((r) => c.ledger[r]).filter((e): e is EvidenceEntry => e != null)
	const incoming = refs.filter((e) => e.category === "source_document")
	const trusted = refs.filter((e) => e.category !== "source_document")
	const card = (e: EvidenceEntry) => (
		<button type="button" key={e.id} className="evcard" data-drawer-keep aria-pressed={ev.sel === e.id} onClick={() => ev.setSel(e.id)}>
			<span className="cat">{ICON[e.category]}{CATEGORY[e.category]}<span className="loc">{chipLabel(e)}</span></span>
			<span className="lbl">{e.label}</span>
			{e.doc?.excerpt && <span className="quote">{e.doc.excerpt.length > 180 ? `${e.doc.excerpt.slice(0, 180)}…` : e.doc.excerpt}</span>}
			{e.record && <span className="evkv">{Object.entries(e.record.fields).slice(0, 4).map(([k, v]) => <span key={k}><i>{fieldLabel(k)}</i><span className={/iban|hash|bic/i.test(k) ? "mono" : ""}>{v}</span></span>)}</span>}
			{e.calc && <span className="evkv"><span><i>Result</i><span>{e.calc.result}{e.calc.currency ? ` ${e.calc.currency}` : ""}</span></span></span>}
		</button>
	)
	const inv = c.investigation.result
	const rec = c.decision.result?.recommended
	const findings: { agent: AgentName; gist: string; body: ReactNode }[] = []
	if (x) findings.push({ agent: "Extractor", gist: x.note ? plain(x.note) : `Read the document as ${x.isPaymentRequest ? "a payment request" : `a ${x.documentKind}`}.`, body: <p className="say">{x.note ? plain(x.note) : `Read the document as ${x.isPaymentRequest ? "a payment request" : `a ${x.documentKind}`}, with a citation for every value.`}</p> })
	if (c.audit.result) findings.push({ agent: "Auditor", gist: plain(c.audit.result.summary), body: <><p className="say">{plain(c.audit.result.summary)}</p>{c.audit.result.conflicts.map((k, n) => <div key={n} className="issue"><span className="top"><span className="tag warn">document contradicts itself: {k.field}</span></span><span>{k.values.join(" vs ")} {k.refs.map(ev.chip)}</span></div>)}</> })
	if (c.validation.result) findings.push({ agent: "Validator", gist: plain(c.validation.result.summary), body: <><p className="say">{plain(c.validation.result.summary)}</p>{c.validation.result.issues.length > 0 && <ul className="issues">{c.validation.result.issues.map((i, n) => <li key={n} className="issue"><span className="top"><span className={`tag ${i.severity === "block" ? "bad" : i.severity === "review" ? "warn" : ""}`}>{words(i.code)}</span></span><span>{plain(i.message)}</span>{ev.chips(i.refs).length > 0 && <span className="ctl-refs">{ev.chips(i.refs)}</span>}</li>)}</ul>}</> })
	if (inv) findings.push({ agent: "Investigator", gist: plain(inv.explanation), body: <><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><span className={`tag ${inv.assessment === "confirmed_discrepancy" ? "bad" : inv.assessment === "suspected" ? "warn" : ""}`}>{inv.assessment === "confirmed_discrepancy" ? "Confirmed discrepancy" : inv.assessment === "suspected" ? "Suspected, not proven" : "No issue found"}</span><span className="tag line fit">{cap(inv.category)}</span></div><p className="say">{plain(inv.explanation)}</p>{inv.unknowns.length > 0 && <div className="facts"><div className="sub-h">Still unknown</div><ul className="bullets">{inv.unknowns.map((u, n) => <li key={n}>{plain(u)}</li>)}</ul></div>}<div className="facts"><div className="sub-h">Recommended verification steps</div><ol className="bullets" style={{ listStyle: "decimal" }}>{inv.recommendedSteps.map((u, n) => <li key={n}>{plain(u)}</li>)}</ol></div></> })
	if (rec) findings.push({ agent: "Policy", gist: plain(rec.explanation), body: <><div><DispositionTag value={rec.disposition} /></div><p className="say">{plain(rec.explanation)}</p></> })
	const failed = (["extraction", "validation", "audit", "investigation", "decision"] as const).filter((s) => c[s].status === "error")

	return (
		<>
			<article className="detail" aria-label={`Investigation: ${titleOf(c)}`}>
				<div className="d-top" style={{ paddingBottom: "var(--sp-4)" }}>
					<header className="d-head" style={{ paddingBottom: 0 }}>
						<div className="d-title">
							<a className="btn btn-ghost btn-sm back" href={href("firewall")} style={{ justifySelf: "start", marginLeft: -9 }}><ArrowLeft size={13} /> Back</a>
							<h2>{titleOf(c)}</h2>
							<div className="d-ids">
								{x?.invoiceNumber && <span>Invoice <span className="mono">{x.invoiceNumber}</span></span>}
								<span>Received {clock(c.receivedAt)}</span>
								<a className="linkish" style={{ fontSize: "inherit" }} href={href("queue", c.id)}>Open the payment <ArrowRight size={11} /></a>
							</div>
						</div>
						<div className="d-money">
							{c.exposure && <span className="d-amount"><Figure minor={c.exposure.minor} ccy={c.exposure.currency} /></span>}
							<span className="d-sub"><StageStatus stage={c.stage} lg /></span>
						</div>
					</header>
				</div>

				<div className="d-body">
					<section className="block">
						<p className="fw-ex">{top ? `${controlShort(top)}. ${top.detail}` : "No control is flagging this payment."}</p>
						<p>{nextAction(c)}</p>
					</section>

					{flags.length > 0 && (
						<section className="block">
							<div className="block-h"><h3>Evidence compared</h3><span className="right"><Prov kind="computed" label="what the failing controls rest on" /></span></div>
							{flags.some((k) => k.id === "beneficiary") && <Compare c={c} chip={ev.chip} />}
							<div className="evpair">
								<div className="evcol"><div className="evcol-h">Incoming document</div>{incoming.length ? incoming.map(card) : <div className="evcard none">No line of the document is cited by a failing control.</div>}</div>
								<div className="evcol"><div className="evcol-h">Trusted records and calculations</div>{trusted.length ? trusted.map(card) : <div className="evcard none">No trusted record applies: nothing on file matches this document.</div>}</div>
							</div>
						</section>
					)}

					{flags.length > 1 && (
						<section className="block">
							<div className="block-h"><h3>Every exception on this payment</h3><span className="right">{flags.filter(isBlocking).length} blocking · {flags.length - flags.filter(isBlocking).length} for review</span></div>
							<ul className="controls">
								{flags.map((k) => <li key={k.id} className={`ctl ${isBlocking(k) ? "block" : "flag"}`}><StatusIcon status={k.status} block={isBlocking(k)} /><div className="ctl-main"><span className="ctl-top"><b>{k.label}</b></span><span className="ctl-detail">{k.detail}</span>{ev.chips(k.refs).length > 0 && <span className="ctl-refs">{ev.chips(k.refs)}</span>}</div></li>)}
							</ul>
						</section>
					)}

					{(findings.length > 0 || failed.length > 0) && (
						<section className="block">
							<div className="block-h"><h3>What the agents found</h3><span className="right"><Prov kind="agent" label="advisory, never the decision" /></span></div>
							<div className="findings">
								{findings.map((f) => (
									<details className="finding" key={f.agent}>
										<summary><CaretRight size={12} weight="bold" className="caret" /><span className={`who agent-${f.agent}`}><span className="swatch" />{f.agent}</span><span className="gist">{f.gist}</span></summary>
										<div className="finding-body">{f.body}</div>
									</details>
								))}
							</div>
							{failed.length > 0 && <div className="errbox">{failed.map((s) => `${s}: ${c[s].error ?? "failed"}`).join("\n")}</div>}
						</section>
					)}

					<section className="block">
						<div className="block-h"><h3>Decision</h3></div>
						{needsPerson(c) || c.stage === "error" ? (
							<div className={`verdict ${c.stage === "awaiting_approval" ? "warn" : "bad"}`}><div className="verdict-act" style={{ borderTop: 0 }}><Actions c={c} snapshot={snapshot} /></div></div>
						) : <Verdict c={c} snapshot={snapshot} chip={ev.chip} />}
					</section>
				</div>
			</article>
			<EvidenceDrawer c={c} sel={ev.sel} open onClose={() => ev.setSel(null)} chip={ev.chip} />
		</>
	)
}
