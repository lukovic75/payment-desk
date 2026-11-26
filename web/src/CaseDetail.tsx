import { useEffect, useRef, useState } from "react"
import { CheckCircle, DownloadSimple, FileText, Hourglass, Prohibit, Scales, ShieldCheck, Warning, WarningCircle, XCircle, ListChecks } from "@phosphor-icons/react"
import { decide, fetchDocument, money, reduceMotion, type PaymentCase } from "./api"
import { StageChip } from "./StageChip"

export function CaseDetail({ c }: { c: PaymentCase }) {
	const x = c.extraction.result
	const [hl, setHl] = useState<number | null>(null)
	const [docText, setDocText] = useState<string | null>(null)
	const [docErr, setDocErr] = useState<string | null>(null)
	const docRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		setDocText(null); setDocErr(null); setHl(null)
		fetchDocument(c.id).then(setDocText).catch((e) => setDocErr(String(e.message ?? e)))
	}, [c.id])

	const jump = (line: number | null) => {
		if (line == null) return
		setHl(line)
		docRef.current?.querySelector<HTMLElement>(`[data-line="${line}"]`)?.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" })
	}
	const ev = (field: string) => x?.evidence.find((e) => e.field === field) ?? null
	const cited = new Set((x?.evidence ?? []).map((e) => e.line).filter((l): l is number => l != null))
	const title = c.validation.result?.vendorName ?? x?.creditorName ?? (x ? capitalize(x.documentKind) : c.id)

	return (
		<div className="detail swap" key={c.id}>
			<div className="detail-head">
				<h1>{title}</h1>
				<div className="meta">
					<StageChip stage={c.stage} />
					<span className="mono">{c.fileName}</span>
					{x?.invoiceNumber && <span>invoice {x.invoiceNumber}</span>}
					{x?.dueDate && <span>due {x.dueDate}</span>}
				</div>
				{x?.amount != null && <span className="amount">{money(x.amount, x.currency)}</span>}
			</div>

			<Verdict c={c} />

			<div className="detail-body">
				<Section title="Extraction" icon={<FileText size={14} />} agent="Extractor" step={c.extraction}>
					{x && (
						<>
							<dl className="fields">
								<Field label="Document" value={x.documentKind} />
								{x.isPaymentRequest && (
									<>
										<Field label="Creditor" value={x.creditorName} ev={ev("creditorName")} jump={jump} />
										<Field label="Invoice no." value={x.invoiceNumber} ev={ev("invoiceNumber")} jump={jump} mono />
										<Field label="Amount" value={x.amount != null ? money(x.amount, x.currency) : null} ev={ev("amount")} jump={jump} />
										<Field label="IBAN" value={x.iban?.replace(/(.{4})/g, "$1 ").trim() ?? null} ev={ev("iban")} jump={jump} mono bad={c.validation.result?.ibanValid === false} />
										<Field label="BIC" value={x.bic} ev={ev("bic")} jump={jump} mono />
										<Field label="Due" value={x.dueDate} ev={ev("dueDate")} jump={jump} mono />
										<Field label="Reference" value={x.reference} ev={ev("reference")} jump={jump} mono />
									</>
								)}
							</dl>
							{x.note && <p className="summary">{x.note}</p>}
						</>
					)}
				</Section>

				{x?.isPaymentRequest && (
					<Section title="Validation" icon={<ShieldCheck size={14} />} agent="Validator" step={c.validation}>
						{c.validation.result && (
							<>
								<dl className="fields">
									<Field label="Vendor master" value={c.validation.result.vendorId ? `${c.validation.result.vendorName} · ${c.validation.result.vendorId}` : "not found"} bad={!c.validation.result.vendorId} />
									<Field label="IBAN checksum" value={c.validation.result.ibanValid == null ? null : c.validation.result.ibanValid ? "valid" : "invalid"} bad={c.validation.result.ibanValid === false} />
									<Field label="Matches master" value={c.validation.result.ibanMatchesMaster == null ? "n/a" : c.validation.result.ibanMatchesMaster ? "yes" : "no"} bad={c.validation.result.ibanMatchesMaster === false} />
									{c.validation.result.duplicateOf && <Field label="Duplicate of" value={c.validation.result.duplicateOf} mono bad />}
								</dl>
								{c.validation.result.issues.length > 0 && (
									<ul className="issues">
										{c.validation.result.issues.map((i, k) => (
											<li key={k} className={`issue ${i.severity}`}>
												<span className="chip">{i.code.replace(/_/g, " ")}</span>
												<span>{i.message}</span>
												<span className="from">source: {i.source}</span>
											</li>
										))}
									</ul>
								)}
								<p className="summary">{c.validation.result.summary}</p>
							</>
						)}
					</Section>
				)}

				{x?.isPaymentRequest && (
					<Section title="Audit" icon={<ListChecks size={14} />} agent="Auditor" step={c.audit}>
						{c.audit.result && (
							<>
								<p className="summary">
									{c.audit.result.ok ? <CheckCircle size={14} weight="bold" style={{ color: "var(--good)", verticalAlign: "-2px" }} /> : <WarningCircle size={14} weight="bold" style={{ color: "var(--warn)", verticalAlign: "-2px" }} />}{" "}
									{c.audit.result.ok ? "Every extracted value matches the document." : `${c.audit.result.discrepancies.length} discrepanc${c.audit.result.discrepancies.length === 1 ? "y" : "ies"} between the extraction and the document.`}
								</p>
								{c.audit.result.discrepancies.length > 0 && (
									<ul className="issues">
										{c.audit.result.discrepancies.map((d, k) => (
											<li key={k} className="issue review">
												<span className="chip">{d.field}</span>
												<span>extracted <code>{d.extracted}</code>, document says <code>{d.inDocument}</code></span>
											</li>
										))}
									</ul>
								)}
								<p className="summary">{c.audit.result.summary}</p>
							</>
						)}
					</Section>
				)}

				{x?.isPaymentRequest && (
					<Section title="Routing" icon={<Scales size={14} />} agent="Policy" step={c.decision}>
						{c.decision.result && (
							<>
								<ul className="reasons">{c.decision.result.reasons.map((r, k) => <li key={k}>{r}</li>)}</ul>
								<p className="summary">{c.decision.result.summary}</p>
								<p className="fine guard"><ShieldCheck size={12} weight="bold" style={{ verticalAlign: "-2px", flex: "none" }} /><span>Policy guard: {c.decision.result.guardReasons.length ? c.decision.result.guardReasons.join("; ") : "no rule requires a human; within limits"}{c.decision.result.overriddenFrom ? ` (raised the agent's "${c.decision.result.overriddenFrom}")` : ""}</span></p>
							</>
						)}
					</Section>
				)}

				{c.sepa && (
					<div className="section span sepa appear">
						<div className="section-title">
							<CheckCircle size={14} weight="bold" style={{ color: "var(--good)" }} /> SEPA credit transfer draft · pain.001.001.09
							<span className="state">
								<button className="btn" onClick={() => download(`${c.sepa!.messageId}.xml`, c.sepa!.xml)}><DownloadSimple size={14} /> Download XML</button>
							</span>
						</div>
						<pre><code>{c.sepa.xml}</code></pre>
						<p className="fine">Synthetic data. This draft is not sent anywhere and is not financial advice.</p>
					</div>
				)}

				<div className="section span doc" ref={docRef}>
					<div className="section-title"><FileText size={14} /> Source document <span className="state">{hl ? `line ${hl}` : cited.size ? `${cited.size} lines cited as evidence` : ""}</span></div>
					{docErr && <div className="step-error">{docErr}</div>}
					{docText == null && !docErr && <div className="skeleton" style={{ height: 120 }} />}
					{docText != null && (
						<pre>
							{docText.split("\n").map((l, i) => (
								<span key={i} data-line={i + 1} className={`line${hl === i + 1 ? " hl" : ""}${cited.has(i + 1) ? " cited" : ""}`}>
									<span className="g" aria-hidden /><span className="ln">{i + 1}</span><span>{l || " "}</span>
								</span>
							))}
						</pre>
					)}
				</div>

				<div className="section span">
					<div className="section-title">Agent log <span className="state">{c.timeline.length} events</span></div>
					<ul className="log">
						{c.timeline.filter((t) => t.kind !== "inference").map((t, k) => (
							<li key={k} className={t.kind === "error" ? "error" : ""}>
								<span className="t">{new Date(t.at).toLocaleTimeString([], { hour12: false, minute: "2-digit", second: "2-digit" })}</span>
								<span className={`a agent-${t.agent}`}><span className="swatch" />{t.agent}</span>
								<span>{t.detail}</span>
							</li>
						))}
					</ul>
				</div>
			</div>
		</div>
	)
}

/** The one thing an approver needs first: what the desk decided, why, and the action if it is theirs. */
function Verdict({ c }: { c: PaymentCase }) {
	const d = c.decision.result
	const x = c.extraction.result
	if (c.stage === "error") {
		const err = c.extraction.error ?? c.validation.error ?? c.audit.error ?? c.decision.error
		return <div className="verdict bad"><span className="ico"><Warning size={18} weight="bold" /></span><span className="what">An agent failed on this case</span><span className="why">{err}</span></div>
	}
	if (c.stage === "not_a_payment") {
		return <div className="verdict"><span className="ico"><Prohibit size={18} weight="bold" /></span><span className="what">Not a payment request</span><span className="why">{x?.note || `The Extractor read this as a ${x?.documentKind ?? "document"} and nothing needs to be paid.`}</span></div>
	}
	if (!d) {
		const step = c.stage === "extracting" || c.stage === "received" ? "Extractor is reading the document" : c.stage === "checking" ? "Validator and Auditor are checking it in parallel" : "Policy is routing it"
		return <div className="verdict run"><span className="ico"><Hourglass size={18} weight="bold" /></span><span className="what">In progress</span><span className="why">{step}.</span></div>
	}
	if (c.stage === "awaiting_approval") {
		return (
			<div className="verdict warn">
				<span className="ico"><Hourglass size={18} weight="bold" /></span>
				<span className="what">Needs your approval</span>
				<span className="why">{d.summary}</span>
				<ApprovalBox c={c} />
			</div>
		)
	}
	if (c.stage === "approved") {
		return (
			<div className="verdict good">
				<span className="ico"><CheckCircle size={18} weight="bold" /></span>
				<span className="what">{c.approval?.by === "human" ? "Approved by a human" : "Within policy, approved automatically"}</span>
				<span className="why">{c.approval?.by === "human" ? `${new Date(c.approval.at).toLocaleTimeString()}${c.approval.note ? ` · ${c.approval.note}` : ""}. SEPA draft is ready below.` : `${d.summary} SEPA draft is ready below.`}</span>
			</div>
		)
	}
	return (
		<div className="verdict bad">
			<span className="ico"><XCircle size={18} weight="bold" /></span>
			<span className="what">{c.approval?.by === "human" ? "Rejected by a human" : "Rejected by policy"}</span>
			<span className="why">{c.approval?.note ?? d.summary}</span>
		</div>
	)
}

function ApprovalBox({ c }: { c: PaymentCase }) {
	const [note, setNote] = useState("")
	const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
	const [err, setErr] = useState<string | null>(null)
	const act = async (d: "approve" | "reject") => {
		setBusy(d); setErr(null)
		try { await decide(c.id, d, note) } catch (e) { setErr(String((e as Error).message)); setBusy(null) }
	}
	return (
		<div className="act">
			<label>
				Note for the audit trail (optional)
				<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. called the vendor on the number from the master record, confirmed the new IBAN" />
			</label>
			{err && <div className="step-error">{err}</div>}
			<div className="buttons">
				<button className="btn btn-good" disabled={busy !== null} onClick={() => act("approve")}><CheckCircle size={14} weight="bold" /> {busy === "approve" ? "Approving" : "Approve payment"}</button>
				<button className="btn btn-danger" disabled={busy !== null} onClick={() => act("reject")}><XCircle size={14} weight="bold" /> {busy === "reject" ? "Rejecting" : "Reject"}</button>
			</div>
		</div>
	)
}

function Section({ title, icon, agent, step, children }: { title: string; icon: React.ReactNode; agent: string; step: PaymentCase["extraction"] | PaymentCase["validation"] | PaymentCase["audit"] | PaymentCase["decision"]; children: React.ReactNode }) {
	const dur = step.startedAt && step.finishedAt ? `${((Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000).toFixed(1)} s` : null
	return (
		<section className="section">
			<div className={`section-title agent-${agent}`}>
				<span className="swatch" />{icon} {title}
				<span className="state">{step.status === "running" ? `${agent} · running` : step.status === "pending" ? "waiting" : step.status === "error" ? `${agent} · failed` : dur ? `${agent} · ${dur}` : agent}</span>
			</div>
			{step.status === "running" && <><div className="skeleton" style={{ width: "72%" }} /><div className="skeleton" style={{ width: "48%" }} /></>}
			{step.status === "pending" && <p className="fine">Starts when the previous step is done.</p>}
			{step.status === "error" && <div className="step-error">{step.error}</div>}
			{step.status === "done" && children}
		</section>
	)
}

function Field({ label, value, ev, jump, mono = false, bad = false }: { label: string; value: string | null; ev?: { quote: string; line: number | null } | null; jump?: (line: number | null) => void; mono?: boolean; bad?: boolean }) {
	const extracted = ev !== undefined
	return (
		<>
			<dt>{label}</dt>
			<dd>
				{value ? <span className={`val${mono ? " mono" : ""}${bad ? " bad" : ""}`}>{value}</span> : <span className="missing">not in document</span>}
				{extracted && value && (ev && ev.line != null
					? <button className="src" title={`"${ev.quote}"`} onClick={() => jump?.(ev.line)}>line {ev.line}</button>
					: ev
						? <span className="src unlocated" title={`Quote not found verbatim: "${ev.quote}"`}>quote not located</span>
						: <span className="src unlocated" title="The extractor gave no evidence for this field">no source</span>)}
			</dd>
		</>
	)
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function download(name: string, text: string) {
	const a = document.createElement("a")
	a.href = URL.createObjectURL(new Blob([text], { type: "application/xml" }))
	a.download = name
	a.click()
	URL.revokeObjectURL(a.href)
}
