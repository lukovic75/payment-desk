import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowLeft, ArrowsClockwise, CaretRight, CheckCircle, DownloadSimple, FileText, Hourglass, Minus, Prohibit, Warning, WarningCircle, XCircle } from "@phosphor-icons/react"
import { decide, fetchDocument, retryCase, type DeskSnapshot, type PaymentCase } from "../lib/api"
import { exceptionsOf, loopsOf, titleOf, type AgentName } from "../lib/derive"
import { amount, cap, clock, day, dueLabel, iban as fmtIban, money, plain, reduceMotion } from "../lib/format"
import { href, type View } from "../lib/router"
import { ExceptionTag, Money, Prov, Spinner, StageTag } from "./bits"
import { Timeline } from "./Timeline"

type Props = { c: PaymentCase; snapshot: DeskSnapshot; view: View; onDecided?: (c: PaymentCase) => void }

const FIELD_ALIASES: Record<string, string[]> = {
	creditorName: ["creditor", "vendor", "name", "supplier", "payee"],
	invoiceNumber: ["invoice", "number"],
	amount: ["amount", "total", "sum"],
	iban: ["iban", "account"],
	bic: ["bic", "swift"],
	dueDate: ["due", "date"],
	reference: ["reference", "ref"],
}

/** The payment workspace: who and how much, the decision and why, then each agent's work with its provenance. */
export function PaymentDetail({ c, snapshot, view, onDecided }: Props) {
	const x = c.extraction.result
	const k = c.checks
	const [hl, setHl] = useState<number | null>(null)
	const [doc, setDoc] = useState<{ text: string | null; error: string | null }>({ text: null, error: null })
	const docRef = useRef<HTMLPreElement>(null)

	useEffect(() => {
		let gone = false
		setDoc({ text: null, error: null }); setHl(null)
		fetchDocument(c.id).then((text) => !gone && setDoc({ text, error: null })).catch((e: Error) => !gone && setDoc({ text: null, error: e.message }))
		return () => { gone = true }
	}, [c.id])

	const jump = (line: number) => {
		setHl(line)
		const pre = docRef.current
		const el = pre?.querySelector<HTMLElement>(`[data-line="${line}"]`)
		if (!pre || !el) return
		// Invoice totals sit far right after padding; bring the text itself into view, not just the line.
		const lead = (doc.text?.split("\n")[line - 1] ?? "").match(/^\s*/)![0].length
		const ch = parseFloat(getComputedStyle(pre).fontSize) * 0.6
		const behavior = reduceMotion() ? "auto" : "smooth"
		el.scrollIntoView({ block: "center", inline: "nearest", behavior })
		pre.scrollTo({ left: Math.max(0, (lead - 6) * ch), behavior })
	}
	const cited = useMemo(() => new Set((x?.evidence ?? []).map((e) => e.line).filter((l): l is number => l != null)), [x])
	const loops = useMemo(() => loopsOf([c]), [c])
	const ev = (field: string) => x?.evidence.find((e) => e.field === field)
	const discrepancy = (field: string) => c.audit.result?.discrepancies.find((d) => {
		const f = d.field.toLowerCase().replace(/[^a-z]/g, "")
		return f === field.toLowerCase() || (FIELD_ALIASES[field] ?? []).some((a) => f.includes(a))
	})
	const amountUnverified = !!x?.isPaymentRequest && (k?.unsourced.includes("amount") || !!discrepancy("amount"))
	const due = x?.isPaymentRequest ? dueLabel(x.dueDate) : null
	const live = ["received", "extracting", "checking", "deciding"].includes(c.stage)

	const field = (label: string, key: keyof typeof FIELD_ALIASES, value: string | null, mono = false, flag = false) => {
		const e = ev(key)
		const d = discrepancy(key)
		return (
			<div className="frow" key={key}>
				<dt>{label}</dt>
				<dd className={`${value ? "" : "none"}${flag ? " flag" : ""}${mono && value ? " mono" : ""}`}>{value ?? "not in the document"}</dd>
				<dd>
					{value && (e?.line != null
						? <button className="srcbtn" aria-pressed={hl === e.line} title={`Quoted from the document: “${e.quote}”`} onClick={() => jump(e.line!)}><FileText size={11} />line {e.line}</button>
						: <span className="nosrc" title={e ? `The quote “${e.quote}” was not found verbatim in the document.` : "The Extractor gave no quote for this value."}><Warning size={11} weight="bold" />{e ? "quote not found" : "no source"}</span>)}
				</dd>
				{d && <span className="note"><Prov kind="agent" label="Auditor" /> document says “{d.inDocument}”, extraction has “{d.extracted}”</span>}
			</div>
		)
	}

	return (
		<article className="detail swap" key={c.id} aria-label={`Payment ${titleOf(c)}`}>
			<header className="d-head">
				<div style={{ display: "grid", gap: 6, minWidth: 0 }}>
					<a className="btn btn-ghost btn-sm back" href={href(view)} style={{ justifySelf: "start" }}><ArrowLeft size={13} /> Back to list</a>
					<h2>{titleOf(c)}</h2>
					<div className="d-ids">
						<StageTag stage={c.stage} />
						{x?.invoiceNumber && <span>Invoice <span className="mono">{x.invoiceNumber}</span></span>}
						<span className="mono">{c.fileName}</span>
						<span>received {clock(c.receivedAt)}</span>
					</div>
				</div>
				{x?.amount != null && (
					<div className="d-money">
						<span className="d-amount"><Money value={x.amount} ccy={x.currency} /></span>
						<span className="d-sub">
							{amountUnverified && <span className="nosrc" title="The amount has no located source, or the Auditor disputes it."><Warning size={11} weight="bold" />unverified</span>}
							{due && <span className={due.overdue ? "due over" : ""}>{day(x.dueDate)} · {due.text}</span>}
						</span>
					</div>
				)}
			</header>

			<Verdict c={c} snapshot={snapshot} onDecided={onDecided} />

			<div className="d-body">
				<div className="d-main">
					<Section title="Payment details" agent="Extractor" step={c.extraction}>
						{x && (
							<>
								{x.isPaymentRequest ? (
									<dl className="ftable">
										{field("Creditor", "creditorName", x.creditorName)}
										{field("Invoice no.", "invoiceNumber", x.invoiceNumber, true)}
										{field("Amount", "amount", x.amount != null ? money(x.amount, x.currency) : null)}
										{field("IBAN", "iban", x.iban ? fmtIban(x.iban) : null, true, k?.ibanValid === false)}
										{field("BIC", "bic", x.bic, true)}
										{field("Due date", "dueDate", x.dueDate ? day(x.dueDate) : null)}
										{field("Reference", "reference", x.reference, true)}
									</dl>
								) : (
									<dl className="ftable"><div className="frow"><dt>Document</dt><dd>{cap(x.documentKind)}</dd><dd /></div></dl>
								)}
								{x.note && <div><div className="sub-h">Extractor's note <Prov kind="agent" /></div><p className="say">{x.note}</p></div>}
							</>
						)}
					</Section>

					{x?.isPaymentRequest && (
						<Section title="Validation" agent="Validator" step={c.validation} early={k ? <Checks c={c} view={view} /> : null}>
							{c.validation.result && (
								<>
									<Checks c={c} view={view} />
									<div style={{ display: "grid", gap: 8 }}>
										<div className="sub-h">Validator's findings <Prov kind="agent" /></div>
										{c.validation.result.issues.length > 0 && (
											<ul className="issues">
												{c.validation.result.issues.map((i, n) => (
													<li key={n} className="issue">
														<span className="top"><span className={`tag ${i.severity === "block" ? "bad" : i.severity === "review" ? "warn" : ""}`}>{i.code.replace(/_/g, " ")}</span><span className="from">via {i.source}</span></span>
														<span>{i.message}</span>
													</li>
												))}
											</ul>
										)}
										<p className="say">{c.validation.result.summary}</p>
										{c.validation.result.disagreements.length > 0 && (
											<div className="banner warn"><WarningCircle size={16} weight="bold" /><div><b>The Validator's report differs from the computed checks.</b> The computed values above are the ones the policy guard uses.<ul className="bullets" style={{ marginTop: 4 }}>{c.validation.result.disagreements.map((d, n) => <li key={n}>{d}</li>)}</ul></div></div>
										)}
									</div>
								</>
							)}
						</Section>
					)}

					{x?.isPaymentRequest && (
						<Section title="Audit" agent="Auditor" step={c.audit}>
							{c.audit.result && (
								<>
									<div className={`check ${c.audit.result.ok ? "ok" : "flag"}`} style={{ gridTemplateColumns: "16px minmax(0,1fr) auto" }}>
										{c.audit.result.ok ? <CheckCircle size={14} weight="bold" /> : <WarningCircle size={14} weight="bold" />}
										<span className="val">{c.audit.result.ok ? "The Auditor re-read the document and found every extracted value in it." : `The Auditor found ${c.audit.result.discrepancies.length} difference${c.audit.result.discrepancies.length === 1 ? "" : "s"} between the extraction and the document.`}</span>
										<Prov kind="agent" />
									</div>
									{c.audit.result.discrepancies.length > 0 && (
										<ul className="issues">
											{c.audit.result.discrepancies.map((d, n) => (
												<li key={n} className="issue">
													<span className="top"><span className="tag warn">{d.field}</span></span>
													<dl className="pair" style={{ gridColumn: "auto", padding: 0, background: "none" }}><dt>Extracted</dt><dd>{d.extracted}</dd><dt>In document</dt><dd>{d.inDocument}</dd></dl>
												</li>
											))}
										</ul>
									)}
									<p className="say">{c.audit.result.summary}</p>
								</>
							)}
						</Section>
					)}

					{x?.isPaymentRequest && (
						<Section title="Policy" agent="Policy" step={c.decision}>
							{c.decision.result && (
								<>
									<div style={{ display: "grid", gap: 8 }}>
										<div className="sub-h">Policy guard <Prov kind="computed" /></div>
										{c.decision.result.guardReasons.length > 0
											? <ul className="bullets">{c.decision.result.guardReasons.map((r, n) => <li key={n}>{r}</li>)}</ul>
											: <p className="say">No rule requires a human: known vendor, bank details on file, under the limit, no duplicate, every value sourced.</p>}
										{c.decision.result.overriddenFrom && <p className="say"><b>The guard overrode the agent:</b> it proposed “{c.decision.result.overriddenFrom}”, the policy requires “{c.decision.result.route}”.</p>}
									</div>
									<div style={{ display: "grid", gap: 8 }}>
										<div className="sub-h">Policy agent's reasoning <Prov kind="agent" /></div>
										<ul className="bullets">{c.decision.result.reasons.map((r, n) => <li key={n}>{r}</li>)}</ul>
									</div>
									<dl className="kv">
										<div><dt>Auto-approve limit</dt><dd>{money(snapshot.policy.autoApproveLimit, snapshot.policy.currency)}</dd></div>
										<div><dt>Auto-approved today</dt><dd>{amount(snapshot.dailyAutoApproved)} of {money(snapshot.policy.dailyAutoApproveBudget, snapshot.policy.currency)}</dd></div>
									</dl>
								</>
							)}
						</Section>
					)}

					{c.sepa && (
						<details className="panel fold rise">
							<summary><CaretRight size={12} weight="bold" className="caret" /> SEPA credit transfer draft <span className="right mono">pain.001.001.09</span></summary>
							<div className="sec-body">
								<pre className="xml"><code>{c.sepa.xml}</code></pre>
								<div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
									<button className="btn" onClick={() => download(`${c.sepa!.messageId}.xml`, c.sepa!.xml)}><DownloadSimple size={14} /> Download XML</button>
									<span className="muted" style={{ fontSize: "var(--fs-12)" }}>Synthetic data. This draft is not sent anywhere and is not financial advice.</span>
								</div>
							</div>
						</details>
					)}

					<section className="panel">
						<div className="sec-head"><h3>How the agents processed this</h3><span className="right">{loops.length} loop{loops.length === 1 ? "" : "s"}</span></div>
						<div className={`live-surface${live ? " is-live" : ""}`}><Timeline loops={loops} scope="case" live={live} empty="The agents have not started on this document yet." /></div>
						<details className="fold" style={{ borderTop: "1px solid var(--line)" }}>
							<summary><CaretRight size={12} weight="bold" className="caret" /> Agent log <span className="right">{c.timeline.filter((t) => t.kind !== "inference").length} events</span></summary>
							<ul className="log">
								{c.timeline.filter((t) => t.kind !== "inference").map((t, n) => (
									<li key={n} className={t.kind === "error" ? "err" : ""}>
										<span className="t">{clock(t.at)}</span>
										<span className={`a agent-${t.agent}`}><span className="swatch" />{t.agent === "human" ? "Human" : t.agent}</span>
										<span>{plain(t.detail)}</span>
									</li>
								))}
							</ul>
						</details>
					</section>
				</div>

				<aside className="d-rail" aria-label="Source evidence">
					<section className="panel">
						<div className="sec-head"><FileText size={14} /><h3>Source document</h3><span className="right">{hl ? `line ${hl}` : cited.size ? `${cited.size} lines cited` : c.fileName}</span></div>
						{doc.error && <div className="sec-body"><div className="errbox">{doc.error}</div></div>}
						{doc.text == null && !doc.error && <div className="sec-body"><div className="skel" style={{ height: 14, width: "70%" }} /><div className="skel" style={{ height: 14, width: "92%" }} /><div className="skel" style={{ height: 14, width: "54%" }} /></div>}
						{doc.text != null && (
							<pre className="doc" ref={docRef} tabIndex={0} aria-label="Original document text">
								<span className="doc-in">
									{doc.text.split("\n").map((l, i) => (
										<span key={i} data-line={i + 1} className={`ln${hl === i + 1 ? " hl" : ""}${cited.has(i + 1) ? " cited" : ""}`}>
											<span className="gut"><i aria-hidden /><span className="no">{i + 1}</span></span><span>{l || " "}</span>
										</span>
									))}
								</span>
							</pre>
						)}
					</section>
					<div className="legend" aria-label="How to read provenance labels">
						<Prov kind="source" label="Source: quoted from the document" />
						<Prov kind="computed" label="Computed: by code" />
						<Prov kind="agent" label="Agent: an interpretation" />
						<Prov kind="human" label="Human: a person's decision" />
					</div>
				</aside>
			</div>
		</article>
	)
}

// ───────── verdict: what was decided, why, and the action if it is the reviewer's ─────────

function Verdict({ c, snapshot, onDecided }: Pick<Props, "c" | "snapshot" | "onDecided">) {
	const d = c.decision.result
	const x = c.extraction.result
	const ex = exceptionsOf(c)
	const shell = (tone: string, icon: ReactNode, what: string, why: ReactNode, rest?: ReactNode) => (
		<section className={`verdict ${tone}`} aria-label="Decision">
			<div className="verdict-top"><span className="ico">{icon}</span><span className="what">{what}</span><span className="why">{why}</span></div>
			{rest}
		</section>
	)

	if (c.stage === "error") {
		const err = c.extraction.error ?? c.validation.error ?? c.audit.error ?? c.decision.error ?? "unknown error"
		const failed = (["extraction", "validation", "audit", "decision"] as const).filter((s) => c[s].status === "error").map((s) => ({ extraction: "Extractor", validation: "Validator", audit: "Auditor", decision: "Policy" })[s])
		return shell("bad", <Warning size={18} weight="bold" />, `${failed.join(" and ") || "An agent"} failed on this document`, "Nothing was approved or drafted. The provider's message is below; fix the cause and run the document again.",
			<div className="verdict-act"><div className="errbox">{err}</div><RetryButton id={c.id} /></div>)
	}
	if (c.stage === "not_a_payment") return shell("", <Prohibit size={18} weight="bold" />, "Not a payment request", <>{x?.note || `The Extractor read this as a ${x?.documentKind ?? "document"}; nothing is due.`} <Prov kind="agent" label="Extractor" /></>)
	if (!d || ["received", "extracting", "checking", "deciding"].includes(c.stage)) {
		const step = c.stage === "checking" ? "The Validator and the Auditor are checking it in parallel." : c.stage === "deciding" ? "The Policy agent is routing it." : "The Extractor is reading the document."
		return shell("run", <Hourglass size={18} weight="bold" />, "The agents are working on this", step)
	}

	const reasons = ex.length > 0 && (
		<ul className="reasons">
			{ex.map((e) => (
				<li key={e.code} className="reason flag">
					{e.severity === "block" ? <XCircle size={14} weight="bold" /> : <Warning size={14} weight="bold" />}
					<span><b>{e.label}.</b> {e.detail}</span>
					<Prov kind={e.by} />
				</li>
			))}
		</ul>
	)

	if (c.stage === "awaiting_approval") {
		return shell("warn", <Hourglass size={18} weight="bold" />, "Needs your approval",
			<>{d.summary} <Prov kind="agent" label="Policy agent" /></>,
			<>{reasons}<ApprovalBox c={c} onDecided={onDecided} /></>)
	}
	if (c.stage === "approved") {
		return c.approval?.by === "human"
			? shell("good", <CheckCircle size={18} weight="bold" />, "Approved by a human", <>At {clock(c.approval.at)}{c.approval.note ? <>: “{c.approval.note}”</> : ""}. A SEPA draft is ready below; nothing has been sent. <Prov kind="human" /></>, reasons)
			: shell("good", <CheckCircle size={18} weight="bold" />, "Approved automatically", <>No policy rule requires a human for this payment. A SEPA draft is ready below; nothing has been sent. <Prov kind="computed" label="Policy guard" /></>)
	}
	return c.approval?.by === "human"
		? shell("bad", <XCircle size={18} weight="bold" />, "Rejected by a human", <>At {clock(c.approval.at)}{c.approval.note ? <>: “{c.approval.note}”</> : ""}. No draft was created. <Prov kind="human" /></>, reasons)
		: shell("bad", <XCircle size={18} weight="bold" />, "Rejected by policy", <>{d.guardReasons.join("; ") || d.summary} <Prov kind="computed" label="Policy guard" /></>, reasons)
}

function ApprovalBox({ c, onDecided }: Pick<Props, "c" | "onDecided">) {
	const [note, setNote] = useState("")
	const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
	const [err, setErr] = useState<string | null>(null)
	const act = async (d: "approve" | "reject") => {
		if (busy) return
		setBusy(d); setErr(null)
		try { onDecided?.(await decide(c.id, d, note.trim())) } catch (e) { setErr((e as Error).message); setBusy(null) }
	}
	return (
		<div className="verdict-act">
			<label className="label">
				Note for the audit trail (optional)
				<textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. called the vendor on the number in the master record; new IBAN confirmed" />
			</label>
			{err && <div className="errbox" role="alert">{err}</div>}
			<div className="buttons">
				<button className="btn btn-good" disabled={busy !== null} onClick={() => act("approve")}>{busy === "approve" ? <Spinner /> : <CheckCircle size={14} weight="bold" />} Approve payment</button>
				<button className="btn btn-danger" disabled={busy !== null} onClick={() => act("reject")}>{busy === "reject" ? <Spinner /> : <XCircle size={14} weight="bold" />} Reject</button>
				<span className="hint">Approving creates a SEPA draft. Nothing is sent.</span>
			</div>
		</div>
	)
}

function RetryButton({ id }: { id: string }) {
	const [busy, setBusy] = useState(false)
	const [err, setErr] = useState<string | null>(null)
	return (
		<div className="buttons">
			<button className="btn" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await retryCase(id) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>
				{busy ? <Spinner /> : <ArrowsClockwise size={14} />} Run this document again
			</button>
			{err && <span className="errbox" role="alert">{err}</span>}
		</div>
	)
}

// ───────── computed checks ─────────

function Checks({ c, view }: { c: PaymentCase; view: View }) {
	const k = c.checks
	const x = c.extraction.result
	if (!k || !x) return null
	const row = (state: "ok" | "flag" | "block" | "na", label: string, value: ReactNode, extra?: ReactNode) => (
		<li className={`check ${state}`}>
			{state === "ok" ? <CheckCircle size={14} weight="bold" /> : state === "flag" ? <Warning size={14} weight="bold" /> : state === "block" ? <XCircle size={14} weight="bold" /> : <Minus size={14} />}
			<span className="lbl">{label}</span><span className="val">{value}</span>
			{extra}
		</li>
	)
	const link = (id: string) => <a className="mono" style={{ textDecoration: "underline", textUnderlineOffset: 3 }} href={href(view, id)}>{id}</a>
	const diff = (a: string, b: string) => fmtIban(a).split(" ").map((g, i) => <span key={i}>{g !== fmtIban(b).split(" ")[i] ? <mark>{g}</mark> : g}{" "}</span>)
	return (
		<div style={{ display: "grid", gap: 8 }}>
			<div className="sub-h">Checks <Prov kind="computed" /></div>
			<ul className="checks">
				{k.vendorId ? row("ok", "Vendor master", <>{k.vendorName} <span className="mono muted">{k.vendorId}</span></>) : row("flag", "Vendor master", "not found: this creditor has never been approved")}
				{k.ibanValid == null ? row("na", "IBAN checksum", "no IBAN to check") : k.ibanValid ? row("ok", "IBAN checksum", "valid (ISO 13616, mod 97)") : row("block", "IBAN checksum", "invalid: this account number cannot exist")}
				{k.ibanMatchesMaster == null ? row("na", "IBAN on file", k.vendorId ? "no IBAN on the document" : "no vendor record to compare with")
					: k.ibanMatchesMaster ? row("ok", "IBAN on file", "matches the vendor master")
						: row("flag", "IBAN on file", "differs from the vendor master",
							<dl className="pair"><dt>On the document</dt><dd>{diff(x.iban!, k.masterIban!)}</dd><dt>On file</dt><dd>{diff(k.masterIban!, x.iban!)}</dd></dl>)}
				{k.bicMatchesMaster == null ? null : k.bicMatchesMaster ? row("ok", "BIC on file", "matches the vendor master") : row("flag", "BIC on file", "differs from the vendor master")}
				{k.duplicateOf ? row("flag", "Duplicates", <>same invoice as the earlier document {link(k.duplicateOf)}</>)
					: k.duplicatedBy.length ? row("flag", "Duplicates", <>a later document repeats this invoice: {k.duplicatedBy.map((id, i) => <span key={id}>{i > 0 && ", "}{link(id)}</span>)}</>)
						: row("ok", "Duplicates", "none in the inbox")}
				{k.overLimit == null ? row("na", "Auto-approve limit", "no amount to compare")
					: row(k.overLimit ? "flag" : "ok", "Auto-approve limit", <>{amount(x.amount)} {k.overLimit ? ">" : "≤"} {money(k.limit, x.currency)}</>)}
				{k.unsourced.length ? row("flag", "Sources located", `no located quote for: ${k.unsourced.join(", ")}`) : row("ok", "Sources located", "amount, IBAN and creditor are quoted from the document")}
			</ul>
		</div>
	)
}

// ───────── section shell ─────────

type Step = PaymentCase["extraction"] | PaymentCase["validation"] | PaymentCase["audit"] | PaymentCase["decision"]

function Section({ title, agent, step, early, children }: { title: string; agent: AgentName; step: Step; early?: ReactNode; children: ReactNode }) {
	const ran = step.startedAt && step.finishedAt ? `${((Date.parse(step.finishedAt) - Date.parse(step.startedAt)) / 1000).toFixed(1)} s` : null
	return (
		<section className="panel">
			<div className={`sec-head agent-${agent}`}>
				<span className="swatch" /><h3>{title}</h3>
				<span className="right">{step.status === "running" ? <><Spinner /> {agent} running</> : step.status === "pending" ? "waiting" : step.status === "error" ? `${agent} failed` : `${agent}${ran ? ` · ${ran}` : ""}`}</span>
			</div>
			<div className="sec-body">
				{step.status === "running" && <>{early}<div style={{ display: "grid", gap: 8 }} aria-label={`${agent} is working`}><div className="skel" style={{ height: 12, width: "72%" }} /><div className="skel" style={{ height: 12, width: "46%" }} /></div></>}
				{step.status === "pending" && <p className="muted">Starts when the previous step has finished.</p>}
				{step.status === "error" && <div className="errbox">{step.error}</div>}
				{step.status === "done" && children}
			</div>
		</section>
	)
}

function download(name: string, text: string) {
	const a = document.createElement("a")
	a.href = URL.createObjectURL(new Blob([text], { type: "application/xml" }))
	a.download = name
	a.click()
	URL.revokeObjectURL(a.href)
}
