import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, ArrowsClockwise, Bank, CaretRight, CheckCircle, ClockCounterClockwise, DownloadSimple, FileText, Function as Fn, Hourglass, PhoneCall, Prohibit, Scales, ShieldWarning, User, Warning, XCircle } from "@phosphor-icons/react"
import { act, draftUrl, fetchDocument, type Action, type Control, type DeskSnapshot, type EvidenceEntry, type PaymentCase } from "../lib/api"
import { flagged, isBlocking, isRunning, loopsOf, outcomeOf, titleOf, type AgentName } from "../lib/derive"
import { cap, clock, day, dueLabel, iban as fmtIban, money, plain, reduceMotion, words } from "../lib/format"
import { href, type View } from "../lib/router"
import { ControlTag, DispositionTag, Money, Prov, Spinner, StageTag, StatusIcon } from "./bits"
import { Timeline } from "./Timeline"

type Props = { c: PaymentCase; snapshot: DeskSnapshot; view: View; onDecided?: (c: PaymentCase) => void }
type PickFn = (id: string) => void

const FIELDS: { key: string; label: string; kind?: "money" | "iban" | "date" | "mono" }[] = [
	{ key: "creditorName", label: "Creditor" },
	{ key: "beneficiaryName", label: "Beneficiary" },
	{ key: "vendorTaxId", label: "Tax id", kind: "mono" },
	{ key: "invoiceNumber", label: "Invoice no.", kind: "mono" },
	{ key: "invoiceDate", label: "Invoice date", kind: "date" },
	{ key: "dueDate", label: "Due date", kind: "date" },
	{ key: "net", label: "Net", kind: "money" },
	{ key: "tax", label: "Tax", kind: "money" },
	{ key: "gross", label: "Gross", kind: "money" },
	{ key: "currency", label: "Currency", kind: "mono" },
	{ key: "iban", label: "IBAN", kind: "iban" },
	{ key: "bic", label: "BIC", kind: "mono" },
	{ key: "reference", label: "Reference", kind: "mono" },
	{ key: "poReference", label: "Purchase order", kind: "mono" },
]
const ALWAYS = new Set(["creditorName", "gross", "currency", "iban"])

/** The investigation workspace: the decision and what to do, how it was reached, every control with its evidence, then the agents' work. */
export function PaymentDetail({ c, snapshot, view, onDecided }: Props) {
	const x = c.extraction.result
	const [sel, setSel] = useState<string | null>(null)
	const [doc, setDoc] = useState<{ text: string | null; error: string | null }>({ text: null, error: null })
	const docRef = useRef<HTMLPreElement>(null)
	const railRef = useRef<HTMLElement>(null)

	useEffect(() => {
		let gone = false
		setDoc({ text: null, error: null }); setSel(null)
		fetchDocument(c.id).then((text) => !gone && setDoc({ text, error: null })).catch((e: Error) => !gone && setDoc({ text: null, error: e.message }))
		return () => { gone = true }
	}, [c.id])

	const entry = sel ? c.ledger[sel] : undefined
	const hl = entry?.doc && entry.doc.docId === c.id && entry.doc.located ? { from: entry.doc.lineStart!, to: entry.doc.lineEnd ?? entry.doc.lineStart! } : null

	const pick: PickFn = (id) => {
		setSel(id)
		const e = c.ledger[id]
		const behavior = reduceMotion() ? "auto" : "smooth"
		const pre = docRef.current
		if (e?.doc && e.doc.docId === c.id && e.doc.located && pre) {
			const el = pre.querySelector<HTMLElement>(`[data-line="${e.doc.lineStart}"]`)
			// Totals sit far right after padding; bring the text itself into view, not just the line.
			const lead = (doc.text?.split("\n")[e.doc.lineStart! - 1] ?? "").match(/^\s*/)![0].length
			el?.scrollIntoView({ block: "center", inline: "nearest", behavior })
			pre.scrollTo({ left: Math.max(0, (lead - 6) * parseFloat(getComputedStyle(pre).fontSize) * 0.6), behavior })
		} else railRef.current?.scrollIntoView({ block: "nearest", behavior })
	}

	const cited = useMemo(() => new Set(Object.values(c.ledger).filter((e) => e.doc?.located && e.doc.docId === c.id).flatMap((e) => { const out = []; for (let n = e.doc!.lineStart!; n <= (e.doc!.lineEnd ?? e.doc!.lineStart!); n++) out.push(n); return out })), [c.ledger, c.id])
	const loops = useMemo(() => loopsOf([c]), [c])
	const live = isRunning(c)
	const due = x?.isPaymentRequest ? dueLabel(x.dueDate) : null
	const chip = (id: string | null | undefined) => (id ? <Chip key={id} id={id} c={c} active={sel === id} onPick={pick} /> : null)
	const chips = (ids: string[]) => ids.filter((r) => !r.startsWith("P:") || r === "P:limit" || r === "P:budget").map(chip)
	const unverified = c.controls.some((k) => (k.id === "evidence" || k.id === "agent_agreement" || k.id === "stated_amounts") && k.status !== "pass")

	return (
		<article className="detail swap" key={`${c.id}:${c.attempt}`} aria-label={`Payment ${titleOf(c)}`}>
			<header className="d-head">
				<div style={{ display: "grid", gap: 6, minWidth: 0 }}>
					<a className="btn btn-ghost btn-sm back" href={href(view)} style={{ justifySelf: "start" }}><ArrowLeft size={13} /> Back to list</a>
					<h2>{titleOf(c)}</h2>
					<div className="d-ids">
						<StageTag stage={c.stage} />
						{c.verificationRequested && <span className="tag line"><PhoneCall size={11} /> verification requested</span>}
						{x?.invoiceNumber && <span>Invoice <span className="mono">{x.invoiceNumber}</span></span>}
						<span className="mono">{c.id}</span>
						<span>received {clock(c.receivedAt)}</span>
						{c.attempt > 1 && <span>attempt {c.attempt}</span>}
					</div>
				</div>
				{c.exposure && (
					<div className="d-money">
						<span className="d-amount"><Money value={c.exposure.minor} ccy={c.exposure.currency} /></span>
						<span className="d-sub">
							{unverified && <span className="nosrc" title="A control on this amount or its source has not passed."><Warning size={11} weight="bold" />unverified</span>}
							{chip(c.exposure.ref)}
							{due && <span className={due.overdue ? "due over" : ""}>{/^\d{4}-\d{2}-\d{2}$/.test(x!.dueDate ?? "") ? `${day(x!.dueDate)} · ` : ""}{due.text}</span>}
						</span>
					</div>
				)}
			</header>

			<Verdict c={c} snapshot={snapshot} onDecided={onDecided} />

			<div className="d-body">
				<div className="d-main">
					{c.decision.result && (
						<section className="panel" aria-label="How the decision was made">
							<div className="chain">
								<div>
									<span className="k">Policy agent recommended <Prov kind="agent" label="" /></span>
									{c.decision.result.recommended ? <DispositionTag value={c.decision.result.recommended.disposition} /> : <span className="tag">not consulted</span>}
									<p>{c.decision.result.recommended ? plain(c.decision.result.recommended.explanation) : "Stopped at intake by a deterministic check; no agent was needed."}</p>
								</div>
								<ArrowRight size={14} className="chain-arrow" aria-hidden />
								<div>
									<span className="k">Controls allow at most <Prov kind="computed" label="" /></span>
									<DispositionTag value={c.decision.result.floor} />
									<p>{c.controls.filter(isBlocking).length} blocking, {flagged(c).length - c.controls.filter(isBlocking).length} for review, {c.controls.filter((k) => k.status === "pass").length} passed.</p>
								</div>
								<ArrowRight size={14} className="chain-arrow" aria-hidden />
								<div>
									<span className="k">In force now</span>
									<DispositionTag value={outcomeOf(c)} />
									<p>{c.decision.result.overridden ? "The recommendation was looser than the controls allow, so the controls decided." : c.review.some((r) => r.outcome === "applied" && r.reviewer !== "Firewall") ? "Changed since by a person; see the review history." : "The stricter of the two. An agent can tighten this, never loosen it."}</p>
								</div>
							</div>
						</section>
					)}

					{c.controls.length > 0 && (
						<section className="panel">
							<div className="sec-head"><ShieldWarning size={14} /><h3>Firewall controls</h3><span className="right"><Prov kind="computed" label="deterministic, no model" /></span></div>
							<ul className="controls">
								{[...c.controls].sort((a, b) => order(a) - order(b)).map((k) => (
									<li key={k.id} className={`ctl ${k.status === "pass" ? "ok" : k.status === "unknown" || k.status === "na" ? "na" : isBlocking(k) ? "block" : "flag"}`}>
										<StatusIcon status={k.status} block={isBlocking(k)} />
										<div className="ctl-main">
											<span className="ctl-top"><b>{k.label}</b>{k.rule && <button className="evchip rule" title={snapshot.policy.rules.find((r) => r.id === k.rule)?.text} onClick={() => pick(`P:${k.rule}`)} aria-pressed={sel === `P:${k.rule}`}><Scales size={11} />{k.rule}</button>}</span>
											<span className="ctl-detail">{k.detail}</span>
											{k.id === "beneficiary" && k.status !== "pass" && x?.iban && <Compare c={c} chip={chip} />}
											{chips(k.refs).length > 0 && <span className="ctl-refs">{chips(k.refs)}</span>}
										</div>
									</li>
								))}
							</ul>
						</section>
					)}

					{c.investigation.status !== "pending" && c.investigation.status !== "skipped" && (
						<Section title="Investigation" agent="Investigator" step={c.investigation} right={c.runs.filter((r) => r.agent === "Investigator").pop()?.trigger}>
							{c.investigation.result && (() => { const inv = c.investigation.result!; return (
								<>
									<div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
										<span className="tag line fit" title={cap(inv.category)}>{cap(inv.category)}</span>
										<span className={`tag ${inv.assessment === "confirmed_discrepancy" ? "bad" : inv.assessment === "suspected" ? "warn" : ""}`}>{inv.assessment === "confirmed_discrepancy" ? "Confirmed discrepancy" : inv.assessment === "suspected" ? "Suspected, not proven" : "No issue found"}</span>
										<Prov kind="agent" />
									</div>
									<p className="say">{plain(inv.explanation)}</p>
									<Facts title="Verified" items={inv.verifiedFacts} chips={chips} />
									{inv.conflictingEvidence.length > 0 && <Facts title="Conflicting evidence" items={inv.conflictingEvidence} chips={chips} />}
									{inv.unknowns.length > 0 && <div className="facts"><div className="sub-h">Still unknown</div><ul className="bullets">{inv.unknowns.map((u, n) => <li key={n}>{plain(u)}</li>)}</ul></div>}
									<div className="facts"><div className="sub-h">Recommended verification steps</div><ol className="bullets" style={{ listStyle: "decimal" }}>{inv.recommendedSteps.map((u, n) => <li key={n}>{plain(u)}</li>)}</ol></div>
									<dl className="kv">
										<div><dt>Payment exposure</dt><dd>{c.exposure ? <>{money(c.exposure.minor, c.exposure.currency)} {chip(c.exposure.ref)} <Prov kind="computed" label="the requested amount" /></> : <span className="muted">not calculable: no amount on the document</span>}</dd></div>
										<div><dt>Investigator suggests</dt><dd><DispositionTag value={inv.recommendedDisposition} /> <Prov kind="agent" label="advisory" /></dd></div>
									</dl>
								</>
							) })()}
						</Section>
					)}

					{c.extraction.status !== "skipped" && (
						<Section title="What the agents read" agent="Extractor" step={c.extraction} right="Extractor and Auditor, independently">
							{x && (x.isPaymentRequest ? (
								<>
									<div className="rtable" role="table" aria-label="Values read from the document by the Extractor and, independently, by the Auditor">
										<div className="rrow h" role="row"><span>Field</span><span>Extractor</span><span>Auditor</span></div>
										{FIELDS.filter((f) => ALWAYS.has(f.key) || (x as any)[f.key] != null || (c.audit.result?.reading as any)?.[f.key] != null).map((f) => {
											const v = (x as any)[f.key]
											const av = (c.audit.result?.reading as any)?.[f.key]
											const show = (val: unknown) => (val == null ? null : f.kind === "money" ? money(val as number) : f.kind === "iban" ? fmtIban(String(val)) : f.kind === "date" ? day(String(val)) : String(val))
											const same = v != null && av != null && (typeof v === "number" ? v === av : String(v).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === String(av).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
											const differs = v != null && av != null && !same && !(f.key === "creditorName" && !c.ledger["C:compare:creditorName"])
											return (
												<div className="rrow" role="row" key={f.key}>
													<span className="lbl">{f.label}</span>
													<span className={`val${f.kind === "iban" || f.kind === "mono" ? " mono" : ""}${v == null ? " none" : ""}`}>{show(v) ?? "not on the document"} {chip(x.refs[f.key as keyof typeof x.refs])}</span>
													<span className={`aud${differs ? " differ" : ""}`}>
														{c.audit.status === "running" ? <span className="muted">reading…</span>
															: c.audit.status !== "done" ? <span className="muted">n/a</span>
																: av == null ? <span className="muted">{v == null ? "not found either" : "not read"}</span>
																	: differs ? <><Warning size={12} weight="bold" /> <span className={f.kind === "iban" || f.kind === "mono" ? "mono" : ""}>{show(av)}</span> {chip(c.audit.result!.reading.refs[f.key as keyof typeof x.refs])}</>
																		: <><CheckCircle size={12} weight="bold" /> same {chip(c.audit.result!.reading.refs[f.key as keyof typeof x.refs])}</>}
													</span>
												</div>
											)
										})}
									</div>
									{x.lines.length > 0 && <p className="fine">Line items: {x.lines.map((l, n) => <span key={n}>{n > 0 && " · "}{l.label} {money(l.amount)} {chip(l.ref)}</span>)}</p>}
									{x.note && <p className="say"><Prov kind="agent" label="Extractor's note" /> {plain(x.note)}</p>}
									{c.audit.result && (
										<div style={{ display: "grid", gap: 8 }}>
											<div className="sub-h agent-Auditor"><span className="swatch" />Auditor's summary <Prov kind="agent" /></div>
											<p className="say">{plain(c.audit.result.summary)}</p>
											{c.audit.result.conflicts.map((k, n) => (
												<div key={n} className="issue"><span className="top"><span className="tag warn">document contradicts itself: {k.field}</span></span><span>{k.values.join(" vs ")} {k.refs.map(chip)}</span></div>
											))}
										</div>
									)}
									{c.audit.status === "error" && <div className="errbox">{c.audit.error}</div>}
								</>
							) : <p className="say">{cap(x.documentKind)}. {plain(x.note)}</p>)}
						</Section>
					)}

					{x?.isPaymentRequest && c.validation.status !== "skipped" && (
						<Section title="Validator's findings" agent="Validator" step={c.validation} right="against trusted records">
							{c.validation.result && (
								<>
									{c.validation.result.issues.length > 0 && (
										<ul className="issues">
											{c.validation.result.issues.map((i, n) => (
												<li key={n} className="issue"><span className="top"><span className={`tag ${i.severity === "block" ? "bad" : i.severity === "review" ? "warn" : ""}`}>{words(i.code)}</span><Prov kind="agent" /></span><span>{plain(i.message)}</span>{chips(i.refs).length > 0 && <span className="ctl-refs">{chips(i.refs)}</span>}</li>
											))}
										</ul>
									)}
									<p className="say">{plain(c.validation.result.summary)}</p>
									{c.validation.result.disagreements.length > 0 && (
										<div className="banner warn"><Warning size={16} weight="bold" /><div><b>The Validator's report differs from what the desk computed.</b> The controls above use the computed values.<ul className="bullets" style={{ marginTop: 4 }}>{c.validation.result.disagreements.map((d, n) => <li key={n}>{d}</li>)}</ul></div></div>
									)}
								</>
							)}
						</Section>
					)}

					{c.review.length > 0 && (
						<section className="panel">
							<div className="sec-head"><ClockCounterClockwise size={14} /><h3>Review history</h3><span className="right">{c.review.length} entr{c.review.length === 1 ? "y" : "ies"}</span></div>
							<ul className="reviews">
								{c.review.map((r, n) => (
									<li key={n} className={r.outcome === "refused" ? "refused" : ""}>
										<span className="t">{clock(r.at)}</span>
										<span className="who">{r.reviewer === "Firewall" ? <Prov kind="computed" label="Firewall" /> : <Prov kind="human" label={r.reviewer} />}</span>
										<span><b>{cap(words(r.action))}</b>{r.outcome === "refused" ? " (refused by the server)" : ""}, {words(r.from)} → {words(r.to)}{r.reason ? <>: {r.reason}</> : ""} {r.refs.map(chip)}</span>
									</li>
								))}
							</ul>
						</section>
					)}

					{c.draft && (
						<details className="panel fold rise">
							<summary><CaretRight size={12} weight="bold" className="caret" /> Payment draft <span className="right">sandbox · {c.draft.approvalRef}</span></summary>
							<div className="sec-body">
								<dl className="kv">
									<div><dt>Creditor</dt><dd>{c.draft.creditor.name} {chip(c.draft.evidence.creditor)}</dd></div>
									<div><dt>IBAN</dt><dd className="mono">{fmtIban(c.draft.creditor.iban)} {chip(c.draft.evidence.iban)}</dd></div>
									<div><dt>Amount</dt><dd>{c.draft.amount.formatted} {chip(c.draft.evidence.amount)}</dd></div>
									<div><dt>Reference</dt><dd className="mono">{c.draft.reference} {chip(c.draft.evidence.reference)}</dd></div>
									<div><dt>Requested date</dt><dd>{c.draft.requestedExecutionDate ? day(c.draft.requestedExecutionDate) : <span className="muted">not on the document</span>}</dd></div>
								</dl>
								<div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
									<a className="btn" href={draftUrl(c.id)} download={`${c.draft.draftId}.json`}><DownloadSimple size={14} /> Download draft (JSON)</a>
									<span className="muted" style={{ fontSize: "var(--fs-12)" }}>{c.draft.note}</span>
								</div>
							</div>
						</details>
					)}

					{c.runs.length > 0 && (
						<section className="panel">
							<div className="sec-head"><h3>How the agents processed this</h3><span className="right">{loops.length} loop{loops.length === 1 ? "" : "s"}</span></div>
							<div className={`live-surface${live ? " is-live" : ""}`}><Timeline loops={loops.filter((l) => l.run.attempt === c.attempt)} scope="case" live={live} empty="The agents have not started on this document yet." /></div>
							<details className="fold" style={{ borderTop: "1px solid var(--line)" }}>
								<summary><CaretRight size={12} weight="bold" className="caret" /> Agent log <span className="right">{c.timeline.filter((t) => t.kind !== "inference").length} events</span></summary>
								<ul className="log">
									{c.timeline.filter((t) => t.kind !== "inference").map((t, n) => (
										<li key={n} className={t.kind === "error" ? "err" : ""}><span className="t">{clock(t.at)}</span><span className={`a agent-${t.agent}`}><span className="swatch" />{t.agent}</span><span>{plain(t.detail)}</span></li>
									))}
								</ul>
							</details>
						</section>
					)}
				</div>

				<aside className="d-rail" aria-label="Evidence" ref={railRef}>
					<section className="panel">
						<div className="sec-head"><h3>Evidence</h3><span className="right">{Object.keys(c.ledger).length} entries in the ledger</span></div>
						{entry ? <Inspector e={entry} c={c} chip={chip} /> : <div className="sec-body"><p className="muted">Select any reference (<span className="evchip" style={{ pointerEvents: "none" }}><FileText size={11} />line 18</span>) to see exactly what it rests on: the line in the document, the trusted record, the policy rule or the calculation.</p></div>}
					</section>
					<section className="panel">
						<div className="sec-head"><FileText size={14} /><h3>Source document</h3><span className="right">{hl ? (hl.from === hl.to ? `line ${hl.from}` : `lines ${hl.from} to ${hl.to}`) : cited.size ? `${cited.size} lines cited` : c.fileName}</span></div>
						{doc.error && <div className="sec-body"><div className="errbox">{doc.error}</div></div>}
						{doc.text == null && !doc.error && <div className="sec-body"><div className="skel" style={{ height: 14, width: "70%" }} /><div className="skel" style={{ height: 14, width: "92%" }} /><div className="skel" style={{ height: 14, width: "54%" }} /></div>}
						{doc.text != null && (
							<pre className="doc" ref={docRef} tabIndex={0} aria-label="Original document text">
								<span className="doc-in">
									{doc.text.split("\n").map((l, i) => (
										<span key={i} data-line={i + 1} className={`ln${hl && i + 1 >= hl.from && i + 1 <= hl.to ? " hl" : ""}${cited.has(i + 1) ? " cited" : ""}`}>
											<span className="gut"><i aria-hidden /><span className="no">{i + 1}</span></span><span>{l || " "}</span>
										</span>
									))}
								</span>
							</pre>
						)}
						<div className="panel-body muted" style={{ borderTop: "1px solid var(--line)", fontSize: "var(--fs-11)" }}>Untrusted content. Hash <span className="mono">{c.hash.slice(0, 16)}…</span></div>
					</section>
					<div className="legend" aria-label="How to read provenance labels">
						<Prov kind="source" label="Source: quoted from the document" />
						<Prov kind="computed" label="Computed: by code" />
						<Prov kind="agent" label="Agent: advisory" />
						<Prov kind="human" label="Human: a person" />
					</div>
				</aside>
			</div>
		</article>
	)
}

const order = (k: Control) => (isBlocking(k) ? 0 : k.status === "fail" || k.status === "review" ? 1 : k.status === "unknown" ? 2 : k.status === "pass" ? 3 : 4)

// ───────── evidence ─────────

function chipLabel(e: EvidenceEntry): string {
	if (e.doc) return !e.doc.located ? "no source" : e.doc.lineStart === e.doc.lineEnd ? `line ${e.doc.lineStart}` : `lines ${e.doc.lineStart}-${e.doc.lineEnd}`
	if (e.calc) return "calculation"
	if (e.id === "P:limit") return "limit"
	if (e.id === "P:budget") return "budget"
	return e.record?.recordId ?? e.id
}
const ICON: Record<EvidenceEntry["category"], ReactNode> = {
	source_document: <FileText size={11} />, vendor_record: <Bank size={11} />, historical_payment: <ClockCounterClockwise size={11} />, policy: <Scales size={11} />, calculation: <Fn size={11} />, human_verification: <User size={11} />,
}
const CATEGORY: Record<EvidenceEntry["category"], string> = {
	source_document: "Source document", vendor_record: "Trusted record", historical_payment: "Payment history", policy: "Configured policy", calculation: "Deterministic calculation", human_verification: "Human verification",
}

/** A reference to one ledger entry. Selecting it shows what the entry rests on, and highlights the line when it is in this document. */
function Chip({ id, c, active, onPick }: { id: string; c: PaymentCase; active: boolean; onPick: PickFn }) {
	const e = c.ledger[id]
	if (!e) return <span className="nosrc" title={`Reference ${id} is not in the evidence ledger.`}><Warning size={11} weight="bold" />no evidence</span>
	const bad = e.doc && (!e.doc.located || e.doc.supportsValue === false)
	return <button className={`evchip${bad ? " bad" : ""}`} aria-pressed={active} title={`${CATEGORY[e.category]}: ${e.label}`} onClick={() => onPick(id)}>{ICON[e.category]}{chipLabel(e)}</button>
}

function Inspector({ e, c, chip }: { e: EvidenceEntry; c: PaymentCase; chip: (id: string | null | undefined) => ReactNode }) {
	return (
		<div className="sec-body inspector swap" key={e.id}>
			<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
				<span className="tag line">{ICON[e.category]}{CATEGORY[e.category]}</span>
				<span className="muted" style={{ fontSize: "var(--fs-11)" }}>added by {e.by} · <span className="mono">{e.id}</span></span>
			</div>
			<p style={{ fontWeight: 500 }}>{e.label}</p>
			{e.doc && (
				<>
					{e.doc.excerpt ? <blockquote className="quote">{e.doc.excerpt}</blockquote> : <p className="muted">The agent gave no quote for this value.</p>}
					<dl className="kv">
						<div><dt>Location</dt><dd>{e.doc.located ? <>{e.doc.docId === c.id ? "this document" : <span className="mono">{e.doc.docId}</span>}, {e.doc.lineStart === e.doc.lineEnd ? `line ${e.doc.lineStart}` : `lines ${e.doc.lineStart} to ${e.doc.lineEnd}`}</> : <span style={{ color: "var(--bad)" }}>the quote was not found in the document</span>}</dd></div>
						{e.doc.original != null && <div><dt>As written</dt><dd className="mono">{e.doc.original}</dd></div>}
						{e.doc.normalized != null && <div><dt>Normalised</dt><dd className="mono">{e.doc.normalized}</dd></div>}
						{e.doc.retypedFrom && <div><dt>Agent typed</dt><dd><span className="mono">{e.doc.retypedFrom}</span> <span style={{ color: "var(--warn)" }}>which is not what the line says. The desk read the account number from the quoted line itself.</span></dd></div>}
						<div><dt>Quote contains the value</dt><dd>{e.doc.supportsValue == null ? <span className="muted">not checked mechanically for this kind of field</span> : e.doc.supportsValue ? "yes, checked by code" : <span style={{ color: "var(--bad)" }}>no</span>}</dd></div>
					</dl>
				</>
			)}
			{e.record && (
				<dl className="kv">
					<div><dt>Source</dt><dd className="mono">{e.record.source}</dd></div>
					<div><dt>Record</dt><dd className="mono">{e.record.recordId}</dd></div>
					{Object.entries(e.record.fields).map(([k, v]) => <div key={k}><dt>{cap(k.replace(/([A-Z])/g, " $1").toLowerCase())}</dt><dd className={/iban|hash|bic/i.test(k) ? "mono" : ""}>{v}</dd></div>)}
				</dl>
			)}
			{e.calc && (
				<>
					<p className="say">{cap(e.calc.method)}.</p>
					<dl className="kv">
						{e.calc.inputs.map((i, n) => <div key={n}><dt>{i.label}</dt><dd>{i.value} {chip(i.ref)}</dd></div>)}
						<div><dt>Result</dt><dd><b>{e.calc.result}</b>{e.calc.currency ? ` ${e.calc.currency}` : ""}</dd></div>
						<div><dt>Rounding</dt><dd>{e.calc.rounding}</dd></div>
					</dl>
				</>
			)}
		</div>
	)
}

/** Trusted record against incoming document, with the differing groups marked. */
function Compare({ c, chip }: { c: PaymentCase; chip: (id: string | null | undefined) => ReactNode }) {
	const x = c.extraction.result!
	const vendor = Object.values(c.ledger).find((e) => e.category === "vendor_record" && e.id.startsWith("V:"))
	if (!vendor?.record?.fields.iban || !x.iban) return null
	const a = fmtIban(x.iban).split(" "), b = vendor.record.fields.iban.split(" ")
	const diff = (mine: string[], other: string[]) => mine.map((g, i) => <span key={i}>{g !== other[i] ? <mark>{g}</mark> : g}{" "}</span>)
	return (
		<div className="compare">
			<div><span className="k">Trusted vendor record</span><span className="mono v">{diff(b, a)}</span><span className="s">{chip(vendor.id)} vendor master</span></div>
			<div><span className="k">Incoming document</span><span className="mono v">{diff(a, b)}</span><span className="s">{chip(x.refs.iban)} as read by the Extractor</span></div>
		</div>
	)
}

function Facts({ title, items, chips }: { title: string; items: { text: string; refs: string[] }[]; chips: (ids: string[]) => ReactNode[] }) {
	if (items.length === 0) return null
	return (
		<div className="facts">
			<div className="sub-h">{title}</div>
			<ul className="bullets">{items.map((f, n) => <li key={n}>{plain(f.text)} {chips(f.refs)}{f.refs.length === 0 && <span className="nosrc" title="The Investigator cited no evidence for this statement.">uncited</span>}</li>)}</ul>
		</div>
	)
}

// ───────── verdict: what was decided, why, and what a person can do ─────────

function Verdict({ c, snapshot, onDecided }: VerdictProps) {
	const x = c.extraction.result
	const flags = flagged(c)
	const shell = (tone: string, icon: ReactNode, what: string, why: ReactNode, rest?: ReactNode) => (
		<section className={`verdict ${tone}`} aria-label="Decision">
			<div className="verdict-top"><span className="ico">{icon}</span><span className="what">{what}</span><span className="why">{why}</span></div>
			{rest}
		</section>
	)
	const reasons = flags.length > 0 && (
		<ul className="reasons">
			{flags.map((k) => <li key={k.id} className="reason flag">{isBlocking(k) ? <XCircle size={14} weight="bold" /> : <Warning size={14} weight="bold" />}<span><ControlTag k={k} /> {k.detail}</span><Prov kind="computed" /></li>)}
		</ul>
	)
	const last = [...c.review].reverse().find((r) => r.outcome === "applied" && (r.action === "approve" || r.action === "reject"))

	if (c.stage === "error") {
		const err = c.extraction.error ?? c.validation.error ?? c.audit.error ?? c.investigation.error ?? c.decision.error ?? "unknown error"
		const failed = (["extraction", "validation", "audit", "investigation", "decision"] as const).filter((s) => c[s].status === "error").map((s) => ({ extraction: "Extractor", validation: "Validator", audit: "Auditor", investigation: "Investigator", decision: "Policy agent" })[s])
		return shell("bad", <Warning size={18} weight="bold" />, `Processing error: the ${failed.join(" and ") || "workflow"} did not finish`, "Nothing was approved and no draft exists. What the other agents found is kept below. Fix the cause and run the document again.",
			<div className="verdict-act"><div className="errbox">{err}</div><Actions c={c} snapshot={snapshot} onDecided={onDecided} /></div>)
	}
	if (c.stage === "not_a_payment") return shell("", <Prohibit size={18} weight="bold" />, "Not a payment request", <>{x?.note || `The Extractor read this as a ${x?.documentKind ?? "document"}; nothing is due.`} <Prov kind="agent" label="Extractor" /></>)
	if (isRunning(c)) {
		const step = c.stage === "checking" ? "The Validator and the Auditor are checking it in parallel." : c.stage === "investigating" ? "An exception was found. The Investigator is going through the evidence." : c.stage === "deciding" ? "The Policy agent is writing its recommendation." : "The Extractor is reading the document."
		return shell("run", <Hourglass size={18} weight="bold" />, "The agents are working on this", step)
	}
	if (c.stage === "blocked") {
		return shell("bad", <ShieldWarning size={18} weight="bold" />, "Blocked by the payment firewall",
			"A blocking control failed, so this payment cannot be approved or exported. It can be rejected, sent for verification, or run again once the document is corrected.",
			<>{reasons}<div className="verdict-act"><Actions c={c} snapshot={snapshot} onDecided={onDecided} /></div></>)
	}
	if (c.stage === "awaiting_approval") {
		return shell("warn", <Hourglass size={18} weight="bold" />, "Needs your approval", "No blocking control failed, and the policy asks for a person before this is paid.",
			<>{reasons}<div className="verdict-act"><Actions c={c} snapshot={snapshot} onDecided={onDecided} /></div></>)
	}
	if (c.stage === "approved") {
		return last
			? shell("good", <CheckCircle size={18} weight="bold" />, "Approved by a person", <>{last.reviewer} at {clock(last.at)}{last.reason ? <>: “{last.reason}”</> : ""}. A sandbox payment draft is ready below; nothing has been sent. <Prov kind="human" /></>, reasons)
			: shell("good", <CheckCircle size={18} weight="bold" />, "Approved automatically", <>Every control passed, so the policy needs no person for this payment. A sandbox payment draft is ready below; nothing has been sent. <Prov kind="computed" label="Firewall" /></>)
	}
	return shell("", <XCircle size={18} weight="bold" />, "Rejected by a person", <>{last?.reviewer ?? "Reviewer"} at {last ? clock(last.at) : ""}{last?.reason ? <>: “{last.reason}”</> : ""}. No draft exists. <Prov kind="human" /></>, reasons)
}
type VerdictProps = { c: PaymentCase; snapshot: DeskSnapshot; onDecided?: (c: PaymentCase) => void }

/** Human actions. The server decides what is allowed; the buttons shown here only mirror that. */
function Actions({ c, snapshot, onDecided }: VerdictProps) {
	const [reason, setReason] = useState("")
	const [callback, setCallback] = useState("")
	const [busy, setBusy] = useState<Action | null>(null)
	const [err, setErr] = useState<string | null>(null)
	const beneficiary = c.controls.find((k) => k.id === "beneficiary")?.status === "fail"
	const run = async (action: Action) => {
		if (busy) return
		setBusy(action); setErr(null)
		try {
			const next = await act(c.id, action, { reason: reason.trim() || undefined, callbackRef: callback.trim() || undefined })
			setReason(""); setCallback("")
			if (action === "approve" || action === "reject") onDecided?.(next)
		} catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
	}
	const btn = (action: Action, label: string, cls: string, icon: ReactNode, disabled = false) => (
		<button className={`btn ${cls}`} disabled={busy !== null || disabled} onClick={() => run(action)}>{busy === action ? <Spinner /> : icon} {label}</button>
	)
	return (
		<>
			{c.stage !== "error" && (
				<label className="label">
					Reason for the audit trail
					<textarea className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={c.stage === "blocked" ? "e.g. sent back to the vendor for a corrected invoice" : "e.g. within the Q4 budget, confirmed with the cost-centre owner"} />
				</label>
			)}
			{beneficiary && (
				<div className="verify">
					<label className="label">
						Callback reference for the new bank account
						<input className="input mono" value={callback} onChange={(e) => setCallback(e.target.value)} placeholder="CB-…" autoComplete="off" spellCheck={false} />
					</label>
					{btn("verify_beneficiary", "Verify beneficiary change", "", <PhoneCall size={14} />, callback.trim() === "")}
					<p className="fine">The only way past this block: a callback recorded against this vendor and this exact IBAN (<span className="mono">server/data/callbacks.json</span>). The vendor master is never changed from here.</p>
				</div>
			)}
			{err && <div className="errbox" role="alert">{err}</div>}
			<div className="buttons">
				{c.stage === "awaiting_approval" && btn("approve", "Approve payment", "btn-good", <CheckCircle size={14} weight="bold" />)}
				{(c.stage === "awaiting_approval" || c.stage === "blocked") && btn("reject", "Reject", "btn-danger", <XCircle size={14} weight="bold" />)}
				{(c.stage === "awaiting_approval" || c.stage === "blocked") && btn("request_verification", c.verificationRequested ? "Verification requested" : "Request verification", "", <PhoneCall size={14} />, c.verificationRequested)}
				{(c.stage === "blocked" || c.stage === "error") && c.extraction.status !== "skipped" && btn("reprocess", "Run the document again", "", <ArrowsClockwise size={14} />)}
				<span className="hint">{c.stage === "blocked" ? "There is no approve button on a blocked payment." : c.stage === "awaiting_approval" ? "Approving creates a sandbox draft. Nothing is sent." : ""} Acting as {snapshot.reviewer}; this build has no sign-in.</span>
			</div>
		</>
	)
}

// ───────── section shell ─────────

type Step = { status: string; startedAt: string | null; finishedAt: string | null; error: string | null }

function Section({ title, agent, step, right, children }: { title: string; agent: AgentName; step: Step; right?: string; children: ReactNode }) {
	const ran = step.startedAt && step.finishedAt ? `${((Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000).toFixed(1)} s` : null
	return (
		<section className="panel">
			<div className={`sec-head agent-${agent}`}>
				<span className="swatch" /><h3>{title}</h3>
				<span className="right">{step.status === "running" ? <><Spinner /> {agent} running</> : step.status === "pending" ? "waiting" : step.status === "error" ? `${agent} failed` : <span className="truncate" style={{ maxWidth: 260 }}>{right ?? agent}{ran ? ` · ${ran}` : ""}</span>}</span>
			</div>
			<div className="sec-body">
				{step.status === "running" && <div style={{ display: "grid", gap: 8 }} aria-label={`${agent} is working`}><div className="skel" style={{ height: 12, width: "72%" }} /><div className="skel" style={{ height: 12, width: "46%" }} /></div>}
				{step.status === "pending" && <p className="muted">Starts when the previous step has finished.</p>}
				{step.status === "error" && <div className="errbox">{step.error}</div>}
				{step.status === "done" && children}
			</div>
		</section>
	)
}
