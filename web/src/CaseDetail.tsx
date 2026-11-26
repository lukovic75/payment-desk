import { useEffect, useRef, useState } from "react"
import { ArrowSquareOut, CheckCircle, DownloadSimple, FileText, ShieldCheck, Scales, WarningCircle, XCircle } from "@phosphor-icons/react"
import { decide, fetchDocument, money, type PaymentCase } from "./api"
import { StageChip } from "./StageChip"

type Props = { c: PaymentCase; onChanged: (c: PaymentCase) => void }

export function CaseDetail({ c, onChanged }: Props) {
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
		docRef.current?.querySelector<HTMLElement>(`[data-line="${line}"]`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })
	}

	const ev = (field: string) => x?.evidence.find((e) => e.field === field) ?? null

	return (
		<div className="detail fade-in" key={c.id}>
			<div className="detail-head">
				<h1>{x?.creditorName ?? (x ? capitalize(x.documentKind) : c.fileName)}</h1>
				<StageChip stage={c.stage} />
				<span className="fine mono">{c.fileName}</span>
				{x?.amount != null && <span className="amount num">{money(x.amount, x.currency)}</span>}
			</div>

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
										<Field label="Amount" value={x.amount != null ? money(x.amount, x.currency) : null} ev={ev("amount")} jump={jump} mono />
										<Field label="IBAN" value={x.iban?.replace(/(.{4})/g, "$1 ").trim() ?? null} ev={ev("iban")} jump={jump} mono />
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
									<Field label="Vendor master" value={c.validation.result.vendorId ? `${c.validation.result.vendorName} (${c.validation.result.vendorId})` : "not found"} mono={false} />
									<Field label="IBAN checksum" value={c.validation.result.ibanValid == null ? null : c.validation.result.ibanValid ? "valid" : "INVALID"} />
									<Field label="Matches master" value={c.validation.result.ibanMatchesMaster == null ? "n/a" : c.validation.result.ibanMatchesMaster ? "yes" : "NO"} />
									{c.validation.result.duplicateOf && <Field label="Duplicate of" value={c.validation.result.duplicateOf} mono />}
								</dl>
								{c.validation.result.issues.length > 0 && (
									<ul className="issues">
										{c.validation.result.issues.map((i, k) => (
											<li key={k} className={`issue ${i.severity}`}>
												<span className="chip">{i.code.replace(/_/g, " ")}</span>
												<span className="msg">{i.message}</span>
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
					<Section title="Audit" icon={<Scales size={14} />} agent="Auditor" step={c.audit}>
						{c.audit.result && (
							<>
								<p className="summary">
									{c.audit.result.ok ? <CheckCircle size={14} weight="bold" style={{ color: "var(--good)", verticalAlign: "-2px" }} /> : <WarningCircle size={14} weight="bold" style={{ color: "var(--warn)", verticalAlign: "-2px" }} />}{" "}
									{c.audit.result.ok ? "Every extracted value matches the document." : `${c.audit.result.discrepancies.length} discrepanc${c.audit.result.discrepancies.length === 1 ? "y" : "ies"} found.`}
								</p>
								{c.audit.result.discrepancies.length > 0 && (
									<ul className="issues">
										{c.audit.result.discrepancies.map((d, k) => (
											<li key={k} className="issue review">
												<span className="chip">{d.field}</span>
												<span className="msg">extracted <code>{d.extracted}</code>, document says <code>{d.inDocument}</code></span>
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
					<Section title="Decision" icon={<Scales size={14} />} agent="Policy" step={c.decision}>
						{c.decision.result && (
							<>
								<p className="summary">
									<strong>{routeLabel(c.decision.result.route)}</strong>
									{c.decision.result.overriddenFrom && <> (the policy guard raised this from "{c.decision.result.overriddenFrom}")</>}
								</p>
								<ul className="reasons">{c.decision.result.reasons.map((r, k) => <li key={k}>{r}</li>)}</ul>
								<p className="summary">{c.decision.result.summary}</p>
							</>
						)}
						{c.stage === "awaiting_approval" && <ApprovalBox c={c} onChanged={onChanged} />}
						{c.approval && (
							<p className="summary">
								{c.approval.decision === "approved" ? <CheckCircle size={14} weight="bold" style={{ color: "var(--good)", verticalAlign: "-2px" }} /> : <XCircle size={14} weight="bold" style={{ color: "var(--bad)", verticalAlign: "-2px" }} />}{" "}
								{c.approval.decision === "approved" ? "Approved" : "Rejected"} by {c.approval.by === "human" ? "a human approver" : "policy"} at {new Date(c.approval.at).toLocaleTimeString()}{c.approval.note ? `: ${c.approval.note}` : ""}
							</p>
						)}
					</Section>
				)}

				{c.sepa && (
					<div className="section span sepa">
						<div className="section-title">
							<ArrowSquareOut size={14} /> SEPA credit transfer draft (pain.001.001.09)
							<span className="state">
								<button className="btn" onClick={() => download(`${c.sepa!.messageId}.xml`, c.sepa!.xml)}><DownloadSimple size={14} /> Download XML</button>
							</span>
						</div>
						<pre><code>{c.sepa.xml}</code></pre>
						<p className="fine">Synthetic data. This draft is not sent anywhere and is not financial advice.</p>
					</div>
				)}

				<div className="section span doc" ref={docRef}>
					<div className="section-title"><FileText size={14} /> Source document <span className="state">{hl ? `line ${hl} highlighted` : "click a line badge above to jump to its source"}</span></div>
					{docErr && <div className="step-error">{docErr}</div>}
					{docText == null && !docErr && <div className="skeleton" style={{ height: 120 }} />}
					{docText != null && (
						<pre>
							{docText.split("\n").map((l, i) => (
								<span key={i} data-line={i + 1} className={`line${hl === i + 1 ? " hl" : ""}`}>
									<span className="ln">{i + 1}</span>{l || " "}
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
								<span className={`a agent-${t.agent}`}><span className="agent-dot" style={{ display: "inline-block", marginRight: 6, verticalAlign: "1px" }} />{t.agent}</span>
								<span>{t.detail}</span>
							</li>
						))}
					</ul>
				</div>
			</div>
		</div>
	)
}

function Section({ title, icon, agent, step, children }: { title: string; icon: React.ReactNode; agent: string; step: PaymentCase["extraction"] | PaymentCase["validation"] | PaymentCase["audit"] | PaymentCase["decision"]; children: React.ReactNode }) {
	const dur = step.startedAt && step.finishedAt ? `${((Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000).toFixed(1)} s` : null
	return (
		<section className="section">
			<div className={`section-title agent-${agent}`}>
				<span className="agent-dot" />{icon} {title}
				<span className="state">{step.status === "running" ? "running" : step.status === "pending" ? "waiting" : step.status === "error" ? "failed" : dur ? `${agent} · ${dur}` : agent}</span>
			</div>
			{step.status === "running" && <><div className="skeleton" style={{ width: "72%" }} /><div className="skeleton" style={{ width: "48%" }} /></>}
			{step.status === "pending" && <p className="summary fine">Waits for the previous step.</p>}
			{step.status === "error" && <div className="step-error">{step.error}</div>}
			{step.status === "done" && children}
		</section>
	)
}

function Field({ label, value, ev, jump, mono = false }: { label: string; value: string | null; ev?: { quote: string; line: number | null } | null; jump?: (line: number | null) => void; mono?: boolean }) {
	return (
		<>
			<dt>{label}</dt>
			<dd>
				{value ? <span className={`val${mono ? " mono" : ""}`}>{value}</span> : <span className="missing">not in document</span>}
				{ev && (ev.line != null
					? <button className="src" title={`"${ev.quote}"`} onClick={() => jump?.(ev.line)}>line {ev.line}</button>
					: <span className="src unlocated" title={`Quote not found verbatim: "${ev.quote}"`}>quote not located</span>)}
				{value && !ev && label !== "Document" && label !== "Vendor master" && label !== "IBAN checksum" && label !== "Matches master" && label !== "Duplicate of" && <span className="src unlocated" title="The extractor gave no evidence for this field">no source</span>}
			</dd>
		</>
	)
}

function ApprovalBox({ c, onChanged }: Props) {
	const [note, setNote] = useState("")
	const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
	const [err, setErr] = useState<string | null>(null)
	const act = async (d: "approve" | "reject") => {
		setBusy(d); setErr(null)
		try { onChanged(await decide(c.id, d, note)) } catch (e) { setErr(String((e as Error).message)) } finally { setBusy(null) }
	}
	return (
		<div className="decision-box">
			<label>
				Note for the audit trail (optional)
				<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. called the vendor on the number from the master record, confirmed the new IBAN" />
			</label>
			{err && <div className="step-error">{err}</div>}
			<div className="decision-actions">
				<button className="btn btn-good" disabled={busy !== null} onClick={() => act("approve")}><CheckCircle size={14} weight="bold" /> {busy === "approve" ? "Approving" : "Approve payment"}</button>
				<button className="btn btn-bad" disabled={busy !== null} onClick={() => act("reject")}><XCircle size={14} weight="bold" /> {busy === "reject" ? "Rejecting" : "Reject"}</button>
			</div>
		</div>
	)
}

function routeLabel(r: "auto" | "human" | "reject") {
	return r === "auto" ? "Within policy: auto-approved" : r === "human" ? "Needs a human approver" : "Rejected by policy"
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
function download(name: string, text: string) {
	const a = document.createElement("a")
	a.href = URL.createObjectURL(new Blob([text], { type: "application/xml" }))
	a.download = name
	a.click()
	URL.revokeObjectURL(a.href)
}
