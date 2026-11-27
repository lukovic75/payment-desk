import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, ArrowsClockwise, Bank, CaretRight, CheckCircle, ClockCounterClockwise, DownloadSimple, FileText, Function as Fn, Hourglass, PhoneCall, Prohibit, Scales, SealCheck, ShieldWarning, User, Warning, XCircle } from "@phosphor-icons/react"
import { act, draftUrl, fetchDocument, type Action, type Challenge, type Control, type DeskSnapshot, type EvidenceEntry, type PaymentCase, documentFileUrl, fetchSource, type DocSource } from "../lib/api"
import { flagged, isBlocking, isRunning, loopsOf, outcomeOf, titleOf, type AgentName } from "../lib/derive"
import { cap, clock, day, dueLabel, fieldLabel, iban as fmtIban, money, plain, reduceMotion, words } from "../lib/format"
import { href, type View } from "../lib/router"
import { DispositionTag, Prov, Spinner, StageStatus, StatusIcon, dispositionLabel, issueLine } from "./bits"
import { Timeline } from "./Timeline"
import { Clamp, Drawer, Figure, Long, Tabs, Seg } from "./ui"
import { PdfView } from "./PdfView"

type Props = { c: PaymentCase; snapshot: DeskSnapshot; view: View; onDecided?: (c: PaymentCase) => void }
type ChipFn = (id: string | null | undefined) => ReactNode
type Tab = "overview" | "verification" | "evidence" | "activity"

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

// ───────── shared evidence machinery (the payment workspace and the firewall both use it) ─────────

const docCache = new Map<string, Promise<string>>()
/** The original text of a document, fetched once per document and shared by every view that shows it. */
const srcCache = new Map<string, Promise<DocSource>>()
/** How a document's text maps to its original file, fetched once per document. A recorded case is always text. */
export function useSource(id: string, recorded = false): DocSource | null {
	const [src, setSrc] = useState<{ id: string; value: DocSource | null }>({ id, value: null })
	useEffect(() => {
		if (recorded) return setSrc({ id, value: { format: "text", fileName: `${id}.txt` } })
		let gone = false
		let p = srcCache.get(id)
		if (!p) { p = fetchSource(id); srcCache.set(id, p); p.catch(() => srcCache.delete(id)) }
		p.then((value) => !gone && setSrc({ id, value })).catch(() => !gone && setSrc({ id, value: null }))
		return () => { gone = true }
	}, [id, recorded])
	return src.id === id ? src.value : null
}
/** Where one piece of evidence sits in a PDF: its page and, when the parser measured it, the box of its line. */
export function placeOf(src: DocSource | null, e: EvidenceEntry | undefined): { page: number; box: [number, number, number, number] | null } | null {
	if (!src || src.format !== "pdf" || !e?.doc?.located || e.doc.lineStart == null) return null
	const first = src.lines[e.doc.lineStart - 1], last = src.lines[(e.doc.lineEnd ?? e.doc.lineStart) - 1]
	if (!first) return null
	// a quote that runs over several lines of one page is highlighted as one region; across pages, by page only
	const box = first.box && last?.box && last.page === first.page ? [Math.min(first.box[0], last.box[0]), first.box[1], Math.max(first.box[2], last.box[2]), last.box[3]] as [number, number, number, number] : first.box
	return { page: first.page, box: last && last.page !== first.page ? null : box }
}

export function useDocument(id: string, recorded = false): { text: string | null; error: string | null } {
	const key = `${recorded ? "rec:" : ""}${id}`
	const [doc, setDoc] = useState<{ key: string; text: string | null; error: string | null }>({ key, text: null, error: null })
	useEffect(() => {
		let gone = false
		let p = docCache.get(key)
		if (!p) { p = fetchDocument(id, recorded); docCache.set(key, p); p.catch(() => docCache.delete(key)) }
		p.then((text) => !gone && setDoc({ key, text, error: null })).catch((e: Error) => !gone && setDoc({ key, text: null, error: e.message }))
		return () => { gone = true }
	}, [key])
	return doc.key === key ? doc : { text: null, error: null }
}

/** Which ledger entry is being inspected for a payment, and the chips that select one. */
export function useEvidence(c: PaymentCase) {
	const [state, setState] = useState<{ caseId: string; sel: string | null }>({ caseId: c.id, sel: null })
	const sel = state.caseId === c.id ? state.sel : null
	const setSel = (id: string | null) => setState({ caseId: c.id, sel: id })
	const chip: ChipFn = (id) => (id ? <Chip key={id} id={id} c={c} active={sel === id} onPick={setSel} /> : null)
	const chips = (ids: string[]) => ids.filter((r) => !r.startsWith("P:") || r === "P:limit" || r === "P:budget").map(chip)
	return { sel, setSel, chip, chips }
}

export function chipLabel(e: EvidenceEntry): string {
	if (e.doc?.located && e.doc.page != null) return `p. ${e.doc.page}, line ${e.doc.pageLine}`
	if (e.doc) return !e.doc.located ? "no source" : e.doc.lineStart === e.doc.lineEnd ? `line ${e.doc.lineStart}` : `lines ${e.doc.lineStart}-${e.doc.lineEnd}`
	if (e.calc) return "calculation"
	if (e.id === "P:limit") return "limit"
	if (e.id === "P:budget") return "budget"
	return e.record?.recordId ?? e.id
}
export const ICON: Record<EvidenceEntry["category"], ReactNode> = {
	source_document: <FileText size={11} />, vendor_record: <Bank size={11} />, historical_payment: <ClockCounterClockwise size={11} />, policy: <Scales size={11} />, calculation: <Fn size={11} />, human_verification: <User size={11} />, vendor_confirmation: <SealCheck size={11} />,
}
export const CATEGORY: Record<EvidenceEntry["category"], string> = {
	source_document: "Source document", vendor_record: "Trusted record", historical_payment: "Payment history", policy: "Configured policy", calculation: "Deterministic calculation", human_verification: "Human verification", vendor_confirmation: "Vendor confirmation",
}

/** A reference to one ledger entry. Selecting it opens what the entry rests on. */
export function Chip({ id, c, active, onPick }: { id: string; c: PaymentCase; active: boolean; onPick: (id: string) => void }) {
	const e = c.ledger[id]
	if (!e) return <span className="nosrc" title={`Reference ${id} is not in the evidence ledger.`}><Warning size={11} weight="bold" />no evidence</span>
	const bad = e.doc && (!e.doc.located || e.doc.supportsValue === false)
	return <button type="button" className={`evchip${bad ? " bad" : ""}`} data-drawer-keep aria-pressed={active} title={`${CATEGORY[e.category]}: ${e.label}`} onClick={() => onPick(id)}>{ICON[e.category]}{chipLabel(e)}</button>
}

export function Inspector({ e, c, chip }: { e: EvidenceEntry; c: PaymentCase; chip: ChipFn }) {
	return (
		<div className="inspector swap" key={e.id}>
			<p className="fine">Added by {e.by} · <span className="mono">{e.id}</span></p>
			{e.doc && (
				<>
					{e.doc.excerpt ? <blockquote className="quote">{e.doc.excerpt}</blockquote> : <p className="muted">The agent gave no quote for this value.</p>}
					<dl className="kv">
						<div><dt>Location</dt><dd>{e.doc.located ? <>{e.doc.docId === c.id ? "this document" : <span className="mono">{e.doc.docId}</span>}, {e.doc.page != null ? `page ${e.doc.page}, line ${e.doc.pageLine} of the PDF` : e.doc.lineStart === e.doc.lineEnd ? `line ${e.doc.lineStart}` : `lines ${e.doc.lineStart} to ${e.doc.lineEnd}`}</> : <span style={{ color: "var(--bad)" }}>the quote was not found in the document</span>}</dd></div>
						{e.doc.original != null && <div><dt>As written</dt><dd className="mono">{e.doc.original}</dd></div>}
						{e.doc.normalized != null && <div><dt>Normalised</dt><dd className="mono">{e.doc.normalized}</dd></div>}
						{e.doc.retypedFrom && <div><dt>Agent typed</dt><dd><span className="mono">{e.doc.retypedFrom}</span> <span style={{ color: "var(--warn)" }}>which is not what the line says. The desk read the account number from the quoted line itself.</span></dd></div>}
						<div><dt>Verified</dt><dd>{e.doc.supportsValue == null ? <span className="muted">not checked mechanically for this kind of field</span> : e.doc.supportsValue ? <span style={{ color: "var(--good)" }}>the quote contains the value, checked by code</span> : <span style={{ color: "var(--bad)" }}>the quote does not contain the value</span>}</dd></div>
					</dl>
				</>
			)}
			{e.record && (
				<dl className="kv">
					<div><dt>Source</dt><dd className="mono">{e.record.source}</dd></div>
					<div><dt>Record</dt><dd className="mono">{e.record.recordId}</dd></div>
					{Object.entries(e.record.fields).map(([k, v]) => <div key={k}><dt>{fieldLabel(k)}</dt><dd className={/iban|hash|bic/i.test(k) ? "mono" : ""}>{v}</dd></div>)}
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

/** The cited lines with a little of what surrounds them, so a quote is read in its place. */
function Excerpt({ text, from, to }: { text: string; from: number; to: number }) {
	const lines = text.split("\n")
	const a = Math.max(1, from - 3), b = Math.min(lines.length, to + 3)
	return (
		<div className="docbox">
			<pre className="doc excerpt" aria-label="The cited lines in the document">
				<span className="doc-in">{lines.slice(a - 1, b).map((l, i) => { const n = a + i; return <span key={n} className={`ln${n >= from && n <= to ? " hl" : ""}`}><span className="gut"><i aria-hidden /><span className="no">{n}</span></span><span>{l || " "}</span></span> })}</span>
			</pre>
		</div>
	)
}

/** The contextual inspector for one piece of evidence: the value, where it comes from, the source lines, and whether code verified it. */
export function EvidenceDrawer({ c, sel, open, onClose, chip, onFullDocument, recorded }: { c: PaymentCase; sel: string | null; open: boolean; onClose: () => void; chip: ChipFn; onFullDocument?: () => void; recorded?: boolean }) {
	const e = sel ? c.ledger[sel] : undefined
	const doc = useDocument(c.id, recorded)
	const src = useSource(c.id, recorded)
	const here = e?.doc && e.doc.located && e.doc.docId === c.id
	const place = here ? placeOf(src, e) : null
	const pdf = src?.format === "pdf" ? src : null
	return (
		<Drawer open={open && e != null} onClose={onClose} label="Evidence" kicker={e ? CATEGORY[e.category] : ""} title={e?.label ?? ""} wide={pdf != null && place != null}>
			{e && <Inspector e={e} c={c} chip={chip} />}
			{pdf && place && (pdf.available ? (
				<>
					<p className="fine pdf-note">{place.box ? <>Highlighted on page {place.page} of <span className="mono">{pdf.fileName}</span>, where the parser found this line.</> : <>On page {place.page} of <span className="mono">{pdf.fileName}</span>. The exact position on the page could not be established, so nothing is highlighted; the line is quoted below.</>}</p>
					<PdfView url={documentFileUrl(c.id)} pages={pdf.pages} page={place.page} highlight={place.box} label={`Original document ${pdf.fileName}`} />
				</>
			) : <p className="fine pdf-note">The original PDF is no longer available on this desk. The extracted text and this reference are kept; nothing is shown in its place.</p>)}
			{here && doc.text != null && <Excerpt text={doc.text} from={e!.doc!.lineStart!} to={e!.doc!.lineEnd ?? e!.doc!.lineStart!} />}
			{here && doc.error && <p className="fine">The source lines could not be loaded: {doc.error}</p>}
			{here && onFullDocument && <button type="button" className="btn" style={{ justifySelf: "start" }} onClick={onFullDocument}><FileText size={14} /> Show in the full document</button>}
		</Drawer>
	)
}

/** Trusted record against incoming document, with only the differing groups marked. */
export function Compare({ c, chip }: { c: PaymentCase; chip: ChipFn }) {
	const x = c.extraction.result
	const vendor = Object.values(c.ledger).find((e) => e.category === "vendor_record" && e.id.startsWith("V:"))
	if (!x?.iban || !vendor?.record?.fields.iban) return null
	const a = fmtIban(x.iban).split(" "), b = vendor.record.fields.iban.split(" ")
	const diff = (mine: string[], other: string[]) => mine.map((g, i) => <span key={i}>{g !== other[i] ? <mark>{g}</mark> : g}{" "}</span>)
	return (
		<div className="compare">
			<div><span className="k">Trusted vendor record</span><span className="mono v">{diff(b, a)}</span><span className="s">{chip(vendor.id)} vendor master</span></div>
			<div><span className="k">Incoming document</span><span className="mono v">{diff(a, b)}</span><span className="s">{chip(x.refs.iban)} as read by the Extractor</span></div>
		</div>
	)
}

// ───────── the payment workspace ─────────

/** One payment: what it is, whether it is safe, why it stands where it does, and what a person can do. The rest is one tab away. */
export function PaymentDetail({ c, snapshot, view, onDecided }: Props) {
	const x = c.extraction.result
	const [tab, setTab] = useState<Tab>("overview")
	const ev = useEvidence(c)
	const doc = useDocument(c.id)
	const source = useSource(c.id)
	const pdfSrc = source?.format === "pdf" ? source : null
	const [docView, setDocView] = useState<"pdf" | "text">("pdf")
	const docRef = useRef<HTMLPreElement>(null)
	const { sel, chip, chips } = ev

	const entry = sel ? c.ledger[sel] : undefined
	const hl = entry?.doc && entry.doc.docId === c.id && entry.doc.located ? { from: entry.doc.lineStart!, to: entry.doc.lineEnd ?? entry.doc.lineStart! } : null

	// In the evidence tab a selection brings its line into view in the full document.
	useEffect(() => {
		const pre = docRef.current
		if (tab !== "evidence" || !hl || !pre || doc.text == null) return
		const behavior = reduceMotion() ? "auto" : "smooth"
		const el = pre.querySelector<HTMLElement>(`[data-line="${hl.from}"]`)
		// Totals sit far right after padding; bring the text itself into view, not just the line.
		const lead = (doc.text.split("\n")[hl.from - 1] ?? "").match(/^\s*/)![0].length
		if (el) pre.scrollTo({ top: Math.max(0, el.offsetTop - pre.clientHeight / 2), left: Math.max(0, (lead - 6) * parseFloat(getComputedStyle(pre).fontSize) * 0.6), behavior })
	}, [tab, sel, doc.text, c.id])

	const cited = useMemo(() => new Set(Object.values(c.ledger).filter((e) => e.doc?.located && e.doc.docId === c.id).flatMap((e) => { const out = []; for (let n = e.doc!.lineStart!; n <= (e.doc!.lineEnd ?? e.doc!.lineStart!); n++) out.push(n); return out })), [c.ledger, c.id])
	const loops = useMemo(() => loopsOf([c]), [c])
	const live = isRunning(c)
	const due = x?.isPaymentRequest ? dueLabel(x.dueDate) : null
	const unverified = c.controls.some((k) => (k.id === "evidence" || k.id === "agent_agreement" || k.id === "stated_amounts") && k.status !== "pass")
	const flags = flagged(c)
	const open = c.controls.filter((k) => k.status !== "pass" && k.status !== "na").sort((a, b) => order(a) - order(b))
	const passed = c.controls.filter((k) => k.status === "pass")
	const na = c.controls.filter((k) => k.status === "na")
	const control = (k: Control) => (
		<li key={k.id} className={`ctl ${k.status === "pass" ? "ok" : k.status === "unknown" || k.status === "na" ? "na" : isBlocking(k) ? "block" : "flag"}`}>
			<StatusIcon status={k.status} block={isBlocking(k)} />
			<div className="ctl-main">
				<span className="ctl-top"><b>{k.label}</b>{k.rule && <button type="button" className="evchip rule" data-drawer-keep title={snapshot.policy.rules.find((r) => r.id === k.rule)?.text} onClick={() => ev.setSel(`P:${k.rule}`)} aria-pressed={sel === `P:${k.rule}`}><Scales size={11} />{k.rule}</button>}</span>
				<span className="ctl-detail">{k.detail}</span>
				{k.id === "beneficiary" && k.status !== "pass" && x?.iban && <Compare c={c} chip={chip} />}
				{chips(k.refs).length > 0 && <span className="ctl-refs">{chips(k.refs)}</span>}
			</div>
		</li>
	)
	const groups = (Object.keys(CATEGORY) as EvidenceEntry["category"][]).map((cat) => ({ cat, entries: Object.values(c.ledger).filter((e) => e.category === cat) })).filter((g) => g.entries.length > 0)

	return (
		<>
			<article className="detail" aria-label={`Payment ${titleOf(c)}`}>
				<div className="d-top">
					<header className="d-head">
						<div className="d-title">
							<a className="btn btn-ghost btn-sm back" href={href(view)} style={{ justifySelf: "start", marginLeft: -9 }}><ArrowLeft size={13} /> Back</a>
							<h2>{titleOf(c)}</h2>
							<div className="d-ids">
								{x?.invoiceNumber && <span>Invoice <span className="mono">{x.invoiceNumber}</span></span>}
								<span>Received {clock(c.receivedAt)}</span>
								{c.attempt > 1 && <span>Attempt {c.attempt}</span>}
								{c.verificationRequested && <span>Verification requested</span>}
							</div>
						</div>
						<div className="d-money">
							{c.exposure && <span className="d-amount"><Figure minor={c.exposure.minor} ccy={c.exposure.currency} /></span>}
							<span className="d-sub">
								{unverified && <span className="nosrc" title="A control on this amount or its source has not passed."><Warning size={11} weight="bold" />unverified</span>}
								<StageStatus stage={c.stage} lg />
								{due && <span className={due.overdue ? "due over" : ""}>{due.text}</span>}
							</span>
						</div>
					</header>
					<Tabs value={tab} onChange={setTab} label="Payment sections" tabs={[
						{ value: "overview", label: "Overview" },
						{ value: "verification", label: "Verification", count: flags.length, attn: true },
						{ value: "evidence", label: "Evidence" },
						{ value: "activity", label: "Activity" },
					]} />
				</div>

				<div className="d-body swap" key={`${c.id}:${c.attempt}:${tab}`} role="tabpanel">
					{tab === "overview" && (
						<>
							<Verdict c={c} snapshot={snapshot} onDecided={onDecided} chip={chip} />
							<div className="d-grid">
								{x?.isPaymentRequest && (
									<section className="block">
										<div className="block-h"><h3>Payment</h3></div>
										<dl className="kv">
											<div><dt>Creditor</dt><dd>{x.creditorName ?? <span className="muted">not on the document</span>} {chip(x.refs.creditorName)}</dd></div>
											<div><dt>Amount</dt><dd>{c.exposure ? money(c.exposure.minor, c.exposure.currency) : <span className="muted">not on the document</span>} {chip(c.exposure?.ref)}</dd></div>
											<div><dt>IBAN</dt><dd className="mono">{x.iban ? fmtIban(x.iban) : <span className="muted">not on the document</span>} {chip(x.refs.iban)}</dd></div>
											{x.dueDate && <div><dt>Due</dt><dd>{day(x.dueDate)} {chip(x.refs.dueDate)}</dd></div>}
											{x.reference && <div><dt>Reference</dt><dd className="mono">{x.reference} {chip(x.refs.reference)}</dd></div>}
										</dl>
									</section>
								)}
								{c.decision.result && (
									<section className="block" aria-label="How the decision was made">
										<div className="block-h"><h3>Decision</h3></div>
										<p className="say">{c.controls.length} checks completed{flags.length ? `, ${flags.length} need${flags.length === 1 ? "s" : ""} review` : ", all passed or not applicable"}. In force: <b style={{ color: "var(--ink)" }}>{dispositionLabel(outcomeOf(c)).toLowerCase()}</b>, the stricter of what the Policy agent recommended and what the controls allow.</p>
										<details className="fold">
											<summary><CaretRight size={12} weight="bold" className="caret" /> How it was decided</summary>
											<div className="chain" style={{ paddingTop: "var(--sp-2)" }}>
												<div className="chain-step">
													<span className="k">Policy agent recommended <Prov kind="agent" label="" /></span>
													{c.decision.result.recommended ? <DispositionTag value={c.decision.result.recommended.disposition} /> : <span className="tag">not consulted</span>}
													<Clamp className="" text={c.decision.result.recommended ? plain(c.decision.result.recommended.explanation) : "Stopped at intake by a deterministic check; no agent was needed."} />
												</div>
												<div className="chain-step">
													<span className="k">Controls allow at most <Prov kind="computed" label="" /></span>
													<DispositionTag value={c.decision.result.floor} />
													<p>{c.controls.filter(isBlocking).length} blocking, {flags.length - c.controls.filter(isBlocking).length} for review, {passed.length} passed.</p>
												</div>
												<div className="chain-step">
													<span className="k">In force now</span>
													<DispositionTag value={outcomeOf(c)} />
													<p>{c.decision.result.overridden ? "The recommendation was looser than the controls allow, so the controls decided." : c.review.some((r) => r.outcome === "applied" && r.reviewer !== "Firewall") ? "Changed since by a person; see the review history under Activity." : "The stricter of the two. An agent can tighten this, never loosen it."}</p>
												</div>
											</div>
										</details>
										<button type="button" className="btn btn-link" style={{ justifySelf: "start", marginLeft: -6 }} onClick={() => setTab("verification")}>See all {c.controls.length} checks <ArrowRight size={12} className="nudge" /></button>
									</section>
								)}
							</div>
							{c.draft && (
								<section className="block rise">
									<div className="block-h"><h3>Payment draft</h3><span className="right">sandbox · {c.draft.approvalRef}</span></div>
									<dl className="kv">
										<div><dt>Creditor</dt><dd>{c.draft.creditor.name} {chip(c.draft.evidence.creditor)}</dd></div>
										<div><dt>IBAN</dt><dd className="mono">{fmtIban(c.draft.creditor.iban)} {chip(c.draft.evidence.iban)}</dd></div>
										<div><dt>Amount</dt><dd>{c.draft.amount.formatted} {chip(c.draft.evidence.amount)}</dd></div>
										<div><dt>Reference</dt><dd className="mono">{c.draft.reference} {chip(c.draft.evidence.reference)}</dd></div>
										<div><dt>Requested date</dt><dd>{c.draft.requestedExecutionDate ? day(c.draft.requestedExecutionDate) : <span className="muted">not on the document</span>}</dd></div>
									</dl>
									<div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
										<a className="btn" href={draftUrl(c.id)} download={`${c.draft.draftId}.json`}><DownloadSimple size={14} /> Download draft (JSON)</a>
										<span className="fine">{c.draft.note}</span>
									</div>
								</section>
							)}
						</>
					)}

					{tab === "verification" && (
						<>
							{c.controls.length > 0 ? (
								<section className="block">
									<div className="block-h"><ShieldWarning size={15} /><h3>Firewall controls</h3><span className="right"><Prov kind="computed" label="deterministic, no model" /></span></div>
									{open.length > 0 ? <ul className="controls">{open.map(control)}</ul> : <p className="say">Every control that applies to this payment passed.</p>}
									{(passed.length > 0 || na.length > 0) && (
										<details className="fold passed">
											<summary><CaretRight size={12} weight="bold" className="caret" /> {passed.length} control{passed.length === 1 ? "" : "s"} passed <span className="right">{na.length > 0 ? `${na.length} not applicable` : ""}</span></summary>
											<ul className="controls">{[...passed, ...na].map(control)}</ul>
										</details>
									)}
								</section>
							) : <p className="say">{isRunning(c) ? "The controls run as soon as the agents have read the document." : "No control was evaluated for this document."}</p>}

							{(c.challenges?.length ?? 0) > 0 && (
								<section className="block">
									<div className="block-h"><h3>Agent cross-checks</h3><span className="right"><Prov kind="computed" label="two sides of each disagreement, set against each other by code" /></span></div>
									<CrossChecks c={c} chip={chip} />
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
						</>
					)}

					{tab === "evidence" && (
						<div className="ev">
							<section className="block">
								<div className="block-h"><h3>Evidence ledger</h3><span className="right">{Object.keys(c.ledger).length} entries</span></div>
								{groups.length === 0 ? <p className="say">Nothing has been recorded for this document yet. Entries appear as the agents cite the document and the desk looks up trusted records.</p> : (
									<div className="ledger">
										{groups.map(({ cat, entries }) => (
											<div key={cat}>
												<div className="ledger-h">{ICON[cat]}{CATEGORY[cat]} <small>{entries.length}</small></div>
												{entries.map((e) => {
													const bad = e.doc && (!e.doc.located || e.doc.supportsValue === false)
													return (
														<Fragment key={e.id}>
															<button type="button" className="ledger-row" aria-pressed={sel === e.id} aria-expanded={sel === e.id} onClick={() => ev.setSel(sel === e.id ? null : e.id)}><span>{e.label}</span><span className={`loc${bad ? " bad" : ""}`}>{chipLabel(e)}</span></button>
															{sel === e.id && <Inspector e={e} c={c} chip={chip} />}
														</Fragment>
													)
												})}
											</div>
										))}
									</div>
								)}
								<div className="legend" aria-label="How to read provenance labels">
									<Prov kind="source" label="Source: quoted from the document" />
									<Prov kind="computed" label="Computed: by code" />
									<Prov kind="agent" label="Agent: advisory" />
									<Prov kind="human" label="Human: a person" />
								</div>
							</section>
							<section className="block ev-doc">
								<div className="block-h"><FileText size={15} /><h3>Source document</h3><span className="right">{hl && entry?.doc?.page != null ? `page ${entry.doc.page}, line ${entry.doc.pageLine}` : hl ? (hl.from === hl.to ? `line ${hl.from}` : `lines ${hl.from} to ${hl.to}`) : cited.size ? `${cited.size} lines cited` : c.fileName}</span></div>
								{pdfSrc && (
									<div className="doc-switch">
										<Seg value={docView} onChange={setDocView} label="How to show the document" options={[{ value: "pdf", label: "Original PDF" }, { value: "text", label: "Extracted text" }]} />
										<span className="fine">{pdfSrc.pages.length} {pdfSrc.pages.length === 1 ? "page" : "pages"} · {Math.max(1, Math.round(pdfSrc.size / 1000))} kB · read by {pdfSrc.parser}</span>
									</div>
								)}
								{pdfSrc && docView === "pdf" && (pdfSrc.available
									? <PdfView url={documentFileUrl(c.id)} pages={pdfSrc.pages} page={placeOf(pdfSrc, entry)?.page ?? 1} highlight={placeOf(pdfSrc, entry)?.box ?? null} label={`Original document ${pdfSrc.fileName}`} />
									: <p className="fine">The original PDF is no longer available on this desk. The extracted text is kept.</p>)}
								<div className="docbox" hidden={pdfSrc != null && docView === "pdf"}>
									{doc.error && <div className="errbox" style={{ margin: 12 }}>{doc.error}</div>}
									{doc.text == null && !doc.error && <div style={{ display: "grid", gap: 8, padding: 14 }}><div className="skel" style={{ height: 13, width: "70%" }} /><div className="skel" style={{ height: 13, width: "92%" }} /><div className="skel" style={{ height: 13, width: "54%" }} /></div>}
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
									<div className="doc-foot">Untrusted content. {pdfSrc ? "Text hash" : "Hash"} <span className="mono">{c.hash.slice(0, 16)}…</span>{pdfSrc && <> · file hash <span className="mono">{pdfSrc.fileHash.slice(0, 16)}…</span></>}</div>
								</div>
							</section>
						</div>
					)}

					{tab === "activity" && (
						<>
							<section className="block">
								<div className="block-h"><h3>How the agents processed this</h3><span className="right">{loops.length} loop{loops.length === 1 ? "" : "s"} · <a className="linkish" style={{ fontSize: "inherit" }} href={href("activity", c.id)}>Open in Agent Activity <ArrowRight size={11} /></a></span></div>
								<div className="docbox"><Timeline loops={loops.filter((l) => l.run.attempt === c.attempt)} scope="case" live={live} empty="The agents have not started on this document yet." /></div>
							</section>
							{c.review.length > 0 && (
								<section className="block">
									<div className="block-h"><ClockCounterClockwise size={15} /><h3>Review history</h3><span className="right">{c.review.length} entr{c.review.length === 1 ? "y" : "ies"}</span></div>
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
							<section className="block">
								<div className="block-h"><h3>Agent log</h3><span className="right">{c.timeline.filter((t) => t.kind !== "inference").length} events</span></div>
								{c.timeline.some((t) => t.kind !== "inference") ? (
									<ul className="log">
										{c.timeline.filter((t) => t.kind !== "inference").map((t, n) => (
											<li key={n} className={t.kind === "error" ? "err" : ""}><span className="t">{clock(t.at)}</span><span className={`a agent-${t.agent}`}><span className="swatch" />{t.agent}</span><span><Long text={plain(t.detail)} /></span></li>
										))}
									</ul>
								) : <p className="say">Nothing has been logged for this document yet.</p>}
							</section>
						</>
					)}
				</div>
			</article>
			<EvidenceDrawer c={c} sel={sel} open={tab !== "evidence"} onClose={() => ev.setSel(null)} chip={chip} onFullDocument={() => setTab("evidence")} />
		</>
	)
}

const order = (k: Control) => (isBlocking(k) ? 0 : k.status === "fail" || k.status === "review" ? 1 : k.status === "unknown" ? 2 : k.status === "pass" ? 3 : 4)

function Facts({ title, items, chips }: { title: string; items: { text: string; refs: string[] }[]; chips: (ids: string[]) => ReactNode[] }) {
	if (items.length === 0) return null
	return (
		<div className="facts">
			<div className="sub-h">{title}</div>
			<ul className="bullets">{items.map((f, n) => <li key={n}>{plain(f.text)} {chips(f.refs)}{f.refs.length === 0 && <span className="nosrc" title="The Investigator cited no evidence for this statement.">uncited</span>}</li>)}</ul>
		</div>
	)
}

// ───────── cross-checks: a disagreement with both of its sides ─────────

const CHECK_STATUS: Record<Challenge["status"], { label: string; tone: string }> = {
	open: { label: "Open", tone: "run" },
	confirmed_discrepancy: { label: "Confirmed discrepancy", tone: "bad" },
	requires_human_verification: { label: "Needs a person", tone: "warn" },
	matched_to_record: { label: "Matched to a trusted record", tone: "good" },
	accepted_by_reviewer: { label: "Accepted by a reviewer, not verified", tone: "warn" },
	unresolved: { label: "Unresolved", tone: "warn" },
}
const short = (v: string) => (v.length > 64 ? `${v.slice(0, 62)}…` : v)

/** Every disagreement between agents, or between an agent and the records, with the evidence for each side. Nothing is merged or overwritten. */
export function CrossChecks({ c, chip }: { c: PaymentCase; chip: ChipFn }) {
	return (
		<ul className="xchecks">
			{(c.challenges ?? []).map((ch) => {
				const st = CHECK_STATUS[ch.status]
				const how = c.resolutions?.[ch.id]
				const side = (s: Challenge["challenged"]) => <span className="xc-side"><i>{s.by}</i><b className={s.ref ? "mono" : ""} title={s.value}>{short(s.value) || "nothing stated"}</b>{chip(s.ref)}</span>
				return (
					<li key={ch.id} className="xcheck">
						<div className="xc-sides">{side(ch.challenged)}<span className="xc-vs" aria-hidden>against</span>{side(ch.observed)}</div>
						<div className="xc-meta">
							<span className={`status ${st.tone}`}><i aria-hidden />{st.label}</span>
							<span className="fine">{cap(ch.field)} · raised by {ch.raisedBy === "Firewall" ? "the comparison in code" : `the ${ch.raisedBy}`}</span>
						</div>
						{ch.status === "accepted_by_reviewer" ? (
							<p className="fine">{how?.basis === "source_cited" ? <>The reviewer approved on a written statement and cited {chip(how.chosenRef)}, which states <span className="mono">{how.chosenValue}</span>. Code re-read that line: the value is in the document. That does not show which of the two values is owed.</> : "The reviewer approved on a written statement and cited no evidence."} No independent record confirms it.</p>
						) : ch.status === "matched_to_record" ? (
							ch.category === "document_contradiction"
								? <p className="fine">A vendor confirmation on record {chip(c.controls.find((k) => k.settledBy)?.settledBy ?? null)} states which amount is payable for this vendor and this invoice, and it is the amount this payment would pay. The record is independent of the document. The desk matches the record; it does not contact the vendor. In this sandbox the record is a synthetic fixture.</p>
								: <p className="fine">A callback record held by the desk matches this vendor and this exact account. The desk matches the record; it does not place or verify the call. In this sandbox the record is a synthetic fixture.</p>
						) : <p className="fine">Next: {ch.required}</p>}
					</li>
				)
			})}
		</ul>
	)
}

// ───────── verdict: what was decided, why, and what a person can do ─────────

type VerdictProps = { c: PaymentCase; snapshot: DeskSnapshot; onDecided?: (c: PaymentCase) => void; chip?: ChipFn }

/** Review flags that mean something does not agree, as opposed to an amount that is simply above a limit. Mirrors the server. */
export const openDiscrepancies = (c: PaymentCase) => c.controls.filter((k) => (k.status === "review" || k.status === "fail") && k.severity !== "block" && k.id !== "per_payment_limit" && k.id !== "daily_limit" && !k.settledBy)

export function Verdict({ c, snapshot, onDecided, chip }: VerdictProps) {
	const x = c.extraction.result
	const flags = flagged(c)
	const shell = (tone: string, icon: ReactNode, what: string, why: ReactNode, rest?: ReactNode) => (
		<section className={`verdict ${tone}`} aria-label="Decision">
			<div className="verdict-top"><span className="ico">{icon}</span><span className="what">{what}</span><span className="why">{why}</span></div>
			{rest}
		</section>
	)
	// Each reason in one sentence, then the values it rests on, each one a reference to its source.
	const reasons = flags.length > 0 && (
		<ul className="reasons">
			{flags.map((k) => {
				const facts = k.refs.map((r) => c.ledger[r]).filter((e) => e?.doc?.normalized != null).slice(0, 3)
				return (
					<li key={k.id} className={`reason${isBlocking(k) ? " block-it" : ""}`} title={k.detail}>
						{isBlocking(k) ? <XCircle size={14} weight="fill" /> : <Warning size={14} weight="fill" />}
						<span>
							<b>{issueLine(k)}</b>
							{facts.length > 0 && <span className="facts-inline">{facts.map((e) => <span key={e!.id}>{e!.label.replace(/ as read by the (Extractor|Auditor)/, "")}: <b className="mono">{e!.doc!.normalized}</b> {chip?.(e!.id)}</span>)}</span>}
						</span>
					</li>
				)
			})}
		</ul>
	)
	const last = [...c.review].reverse().find((r) => r.outcome === "applied" && (r.action === "approve" || r.action === "reject"))

	if (c.stage === "error") {
		const err = c.extraction.error ?? c.validation.error ?? c.audit.error ?? c.investigation.error ?? c.decision.error ?? "unknown error"
		const failed = (["extraction", "validation", "audit", "investigation", "decision"] as const).filter((s) => c[s].status === "error").map((s) => ({ extraction: "Extractor", validation: "Validator", audit: "Auditor", investigation: "Investigator", decision: "Policy agent" })[s])
		return shell("bad", <Warning size={20} weight="fill" />, `Could not be processed: the ${failed.join(" and ") || "workflow"} did not finish`, "Nothing was approved and no draft exists. Run the document again.",
			<div className="verdict-act"><details className="fold"><summary><CaretRight size={12} weight="bold" className="caret" /> Error from the model provider</summary><div className="errbox">{err}</div></details><Actions c={c} snapshot={snapshot} onDecided={onDecided} /></div>)
	}
	if (c.stage === "not_a_payment") return shell("", <Prohibit size={20} weight="fill" />, "Not a payment request", <>{x?.note || `The Extractor read this as a ${x?.documentKind ?? "document"}; nothing is due.`} <Prov kind="agent" label="Extractor" /></>)
	if (isRunning(c)) {
		const step = c.stage === "checking" ? "Two independent checks are running." : c.stage === "investigating" ? "An exception was found and is being investigated." : c.stage === "deciding" ? "The payment policy is being applied." : "The document is being read."
		return shell("run", <Hourglass size={20} weight="fill" />, "The agents are working on this", step)
	}
	if (c.stage === "blocked") {
		return shell("bad", <ShieldWarning size={20} weight="fill" />, "Blocked",
			"It cannot be approved or exported as it stands.",
			<>{reasons}<div className="verdict-act"><Actions c={c} snapshot={snapshot} onDecided={onDecided} /></div></>)
	}
	if (c.stage === "awaiting_approval") {
		const open = openDiscrepancies(c).length > 0
		const settled = c.controls.find((k) => k.settledBy)?.settledBy
		return shell("warn", <Hourglass size={20} weight="fill" />, open ? "This payment needs verification" : "Needs your approval", open ? "Something on it does not agree. Resolve it before it is paid." : settled ? <>The document states two amounts. A vendor confirmation on record {chip?.(settled)} states which one is payable, and it is the amount this payment would pay. A person still approves.</> : "Nothing is wrong with it. The policy asks for a person at this amount.",
			<>{reasons}<div className="verdict-act"><Actions c={c} snapshot={snapshot} onDecided={onDecided} /></div></>)
	}
	if (c.stage === "approved") {
		return last
			? shell("good", <CheckCircle size={20} weight="fill" />, "Approved by a person", <>{last.reviewer} at {clock(last.at)}{last.reason ? <>: “{last.reason}”</> : ""}. A sandbox draft is ready; nothing has been sent.</>, reasons)
			: shell("good", <CheckCircle size={20} weight="fill" />, "Verified and approved", "Every check passed. A sandbox draft is ready; nothing has been sent.")
	}
	return shell("", <XCircle size={20} weight="fill" />, "Rejected by a person", <>{last?.reviewer ?? "Reviewer"} at {last ? clock(last.at) : ""}{last?.reason ? <>: “{last.reason}”</> : ""}. No draft exists.</>, reasons)
}

/** Human actions. The server decides what is allowed; the buttons shown here only mirror that. */
export function Actions({ c, snapshot, onDecided }: VerdictProps) {
	const [reason, setReason] = useState("")
	const [callback, setCallback] = useState("")
	const [confirmation, setConfirmation] = useState("")
	const [busy, setBusy] = useState<Action | null>(null)
	const [err, setErr] = useState<string | null>(null)
	const beneficiary = c.controls.find((k) => k.id === "beneficiary")?.status === "fail"
	// A discrepancy is resolved, not just approved: the server refuses the approval without a written resolution.
	const open = c.stage === "awaiting_approval" && openDiscrepancies(c).length > 0
	// R14: a discrepancy is approved only on a written statement. The reviewer may also cite the line that states the amount
	// to pay; code re-reads it. A cited line shows the value is in the document, not which of two stated values is owed.
	const [picks, setPicks] = useState<Record<string, string>>({})
	const waiting = (c.challenges ?? []).filter((ch) => ch.status === "requires_human_verification" || ch.status === "unresolved" || ch.status === "open")
	const pickable = open ? waiting.filter((ch) => ch.sourceSelectable) : []
	const amountDisputed = open && waiting.some((ch) => ch.category === "document_contradiction" && /gross|amount|total/i.test(ch.field))
	const resolved = reason.trim().length >= 10
	const run = async (action: Action) => {
		if (busy) return
		setBusy(action); setErr(null)
		try {
			const resolutions = action === "approve" ? Object.entries(picks).filter(([id]) => pickable.some((ch) => ch.id === id)).map(([challengeId, chosenRef]) => ({ challengeId, chosenRef })) : undefined
			const next = await act(c.id, action, { reason: reason.trim() || undefined, callbackRef: callback.trim() || undefined, confirmationRef: action === "verify_amount" ? confirmation.trim() : undefined, resolutions: resolutions?.length ? resolutions : undefined })
			setReason(""); setCallback(""); setConfirmation(""); setPicks({})
			if (action === "approve" || action === "reject") onDecided?.(next)
		} catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
	}
	const btn = (action: Action, label: string, cls: string, icon: ReactNode, disabled = false, title?: string) => (
		<button type="button" className={`btn ${cls}`} disabled={busy !== null || disabled} aria-busy={busy === action} title={title} onClick={() => run(action)}>{busy === action ? <Spinner /> : icon} {label}</button>
	)
	return (
		<>
			{amountDisputed && (
				<div className="verify">
					<label className="label">
						Vendor confirmation reference for the amount payable
						<input className="input mono" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="VC-…" autoComplete="off" spellCheck={false} maxLength={80} />
					</label>
					{btn("verify_amount", "Verify payable amount", "", <SealCheck size={14} />, confirmation.trim() === "")}
					<p className="fine">Settles the two amounts with evidence that does not come from this document: a verified confirmation on record for this vendor, this invoice and this currency. If it states another amount than this payment would pay, the payment is blocked. The desk matches the record; it does not contact the vendor.</p>
				</div>
			)}
			{pickable.map((ch) => (
				<fieldset className="pick" key={ch.id}>
					<legend>Cite the line that states the {/gross|amount|total/i.test(ch.field) ? "amount to pay" : ch.field} (optional)</legend>
					{[ch.challenged, ch.observed].map((s) => (
						<label key={s.ref} className="pick-opt">
							<input type="radio" name={`pick-${c.id}-${ch.id}`} checked={picks[ch.id] === s.ref} onChange={() => setPicks({ ...picks, [ch.id]: s.ref! })} />
							<b className="mono">{s.value}</b><span className="fine">{s.by}</span>
						</label>
					))}
					<p className="fine">Code re-reads the line you cite. If it is not the amount this payment would pay, the approval is refused. Citing a line shows that the value is in the document; it does not settle which value is owed, so your written statement is still required.</p>
				</fieldset>
			))}
			{c.stage !== "error" && (
				<label className="label">
					{open ? "How was it resolved? Required to approve. Recorded as your statement, not as evidence" : "Note for the audit trail (optional)"}
					<textarea className="textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={c.stage === "blocked" ? "e.g. sent back to the vendor for a corrected invoice" : open ? "e.g. vendor confirmed by phone that the invoice total is the amount due" : "e.g. within the Q4 budget, confirmed with the cost-centre owner"} />
				</label>
			)}
			{beneficiary && (
				<div className="verify">
					<label className="label">
						Callback reference for the new bank account
						<input className="input mono" value={callback} onChange={(e) => setCallback(e.target.value)} placeholder="CB-…" autoComplete="off" spellCheck={false} />
					</label>
					{btn("verify_beneficiary", "Verify beneficiary change", "", <PhoneCall size={14} />, callback.trim() === "")}
					<p className="fine">The only way past this block: a callback record against this vendor and this exact IBAN. The desk matches the reference to the record; it does not place the call. The vendor master is never changed from here.</p>
				</div>
			)}
			{err && <div className="errbox" role="alert">{err}</div>}
			<div className="buttons">
				{open && !c.verificationRequested && btn("request_verification", "Request verification", "btn-primary", <PhoneCall size={14} />)}
				{c.stage === "awaiting_approval" && (open
					? btn("approve", "Resolve and approve", resolved && c.verificationRequested ? "btn-good" : "", <CheckCircle size={14} weight="bold" />, !resolved, resolved ? undefined : "State in writing how the discrepancy was resolved.")
					: btn("approve", "Approve payment", "btn-good", <CheckCircle size={14} weight="bold" />))}
				{!open && (c.stage === "awaiting_approval" || c.stage === "blocked") && btn("request_verification", c.verificationRequested ? "Verification requested" : "Request verification", "", <PhoneCall size={14} />, c.verificationRequested)}
				{(c.stage === "blocked" || c.stage === "error") && c.extraction.status !== "skipped" && btn("reprocess", "Run again", c.stage === "error" ? "btn-primary" : "", <ArrowsClockwise size={14} />)}
				{(c.stage === "awaiting_approval" || c.stage === "blocked") && btn("reject", "Reject", "btn-danger", <XCircle size={14} weight="bold" />)}
				<span className="hint">{open && c.verificationRequested ? "Verification requested. " : ""}{c.stage === "blocked" ? "A blocked payment cannot be approved. " : c.stage === "awaiting_approval" ? "Approving creates a sandbox draft. Nothing is sent. " : ""}Acting as {snapshot.reviewer}.</span>
			</div>
		</>
	)
}

// ───────── one agent's step ─────────

type Step = { status: string; startedAt: string | null; finishedAt: string | null; error: string | null }

function Section({ title, agent, step, right, children }: { title: string; agent: AgentName; step: Step; right?: string; children: ReactNode }) {
	const ran = step.startedAt && step.finishedAt ? `${((Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000).toFixed(1)} s` : null
	return (
		<section className="block">
			<div className={`block-h agent-${agent}`}>
				<span className="swatch" /><h3>{title}</h3>
				<span className="right">{step.status === "running" ? <><Spinner /> {agent} running</> : step.status === "pending" ? "waiting" : step.status === "error" ? `${agent} failed` : <span className="truncate" style={{ maxWidth: 280 }}>{right ?? agent}{ran ? ` · ${ran}` : ""}</span>}</span>
			</div>
			{step.status === "running" && <div style={{ display: "grid", gap: 8 }} aria-label={`${agent} is working`}><div className="skel" style={{ height: 12, width: "72%" }} /><div className="skel" style={{ height: 12, width: "46%" }} /></div>}
			{step.status === "pending" && <p className="muted">Starts when the previous step has finished.</p>}
			{step.status === "error" && <div className="errbox">{step.error}</div>}
			{step.status === "done" && children}
		</section>
	)
}
