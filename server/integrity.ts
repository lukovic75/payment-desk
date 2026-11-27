/**
 * Evidence integrity: an independent re-verification of the ledger.
 *
 * The ledger records, at the moment an agent submits a value, where the quote sits and whether it contains the value.
 * This file trusts none of those flags. For every reported value it goes back to the document text, the trusted
 * records and the arithmetic, and answers two separate questions:
 *
 *   present  — is there a reference, and does the thing it points at exist?
 *   correct  — does that source really support the value, after normalisation?
 *
 * A citation that exists is not thereby correct. Nothing here calls a model.
 */
import type { EvidenceEntry, IntegrityCounts, IntegrityFinding, IntegrityKind, IntegrityReport, IntegrityValue, Minor, PaymentCase, Reading, ReadingField } from "./domain.js"
import { CRITICAL_FIELDS, MONEY_FIELDS, READING_FIELDS } from "./domain.js"
import { FIELD_LABEL, type FirewallContext } from "./firewall.js"
import { formatIban, ibansIn, normalizeIban } from "./lib/iban.js"
import { amountsIn, formatMinor, normalizeCurrency, parseMoney } from "./money.js"

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()
const alnum = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

/** Is the excerpt really at the lines the ledger says it is? */
function excerptIsThere(text: string, d: NonNullable<EvidenceEntry["doc"]>): boolean {
	if (d.lineStart == null || d.lineEnd == null || !d.excerpt.trim()) return false
	const lines = text.split("\n")
	if (d.lineStart < 1 || d.lineEnd > lines.length || d.lineEnd < d.lineStart) return false
	return squash(lines.slice(d.lineStart - 1, d.lineEnd).join(" ")).includes(squash(d.excerpt))
}

/** Does the excerpt contain the value? null: not checkable mechanically (a date written out in words, for instance). */
function excerptSupports(field: ReadingField | "line", value: string | Minor, excerpt: string): boolean | null {
	if (field === "line" || MONEY_FIELDS.includes(field as ReadingField)) return amountsIn(excerpt).includes(value as Minor)
	if (field === "iban") return ibansIn(excerpt).includes(String(value)) || excerpt.replace(/\s+/g, "").toUpperCase().includes(String(value))
	if (field === "currency") return excerpt.toUpperCase().includes(String(value)) || (value === "EUR" && excerpt.includes("€"))
	if (field === "invoiceDate" || field === "dueDate") return null
	return alnum(excerpt).includes(alnum(String(value)))
}

/** Does the stored value follow from what the agent typed (or, for a re-read IBAN, from the quoted line)? */
function normalisedCorrectly(field: ReadingField | "line", value: string | Minor, d: NonNullable<EvidenceEntry["doc"]>): boolean {
	if (field === "line" || MONEY_FIELDS.includes(field as ReadingField)) return parseMoney(d.original) === value && d.normalized === formatMinor(value as Minor)
	if (field === "iban") {
		const fromTyped = d.original != null && normalizeIban(d.original) === value
		const fromLine = d.retypedFrom != null && ibansIn(d.excerpt).includes(String(value))
		return (fromTyped || fromLine) && d.normalized === formatIban(String(value))
	}
	if (field === "currency") return d.original != null && normalizeCurrency(d.original) === value
	return d.normalized === String(value)
}

export function checkIntegrity(c: PaymentCase, ctx: FirewallContext): IntegrityReport {
	const values: IntegrityValue[] = []
	const findings: IntegrityFinding[] = []
	const text = ctx.documents.get(c.id)?.text ?? null
	const flag = (kind: IntegrityKind, subject: string, ref: string | null, detail: string, critical: boolean) => findings.push({ kind, subject, ref, detail, critical })

	/** One value an agent read from the document. */
	const checkRead = (subject: string, field: ReadingField | "line", value: string | Minor, ref: string | null | undefined, critical: boolean) => {
		const e = ref ? c.ledger[ref] : undefined
		if (!ref || !e?.doc) {
			flag("missing_evidence", subject, ref ?? null, "The value has no source reference in the ledger.", critical)
			return values.push({ subject, ref: ref ?? null, critical, present: false, correct: false })
		}
		if (text == null || e.doc.docId !== c.id) {
			flag("broken_reference", subject, ref, `The reference points at document "${e.doc.docId}", which is not this case's document.`, critical)
			return values.push({ subject, ref, critical, present: false, correct: false })
		}
		if (!excerptIsThere(text, e.doc)) {
			flag("broken_reference", subject, ref, e.doc.lineStart == null ? "The quoted text was not found in the document." : `The quoted text is not at line ${e.doc.lineStart} of the document.`, critical)
			return values.push({ subject, ref, critical, present: false, correct: false })
		}
		// For a PDF, the line has to be in the source map and on the page the ledger says. A page number alone proves nothing.
		const src = ctx.documents.get(c.id)?.source
		if (src && e.doc.lineStart != null) {
			const at = src.lines[e.doc.lineStart - 1]
			const bad = !at ? `Line ${e.doc.lineStart} is not in the source map of the PDF.` : !src.pages.some((p) => p.n === at.page) ? `The source map places the line on page ${at.page}, which the PDF does not have.` : e.doc.page != null && e.doc.page !== at.page ? `The reference says page ${e.doc.page}, but that line of the document is on page ${at.page}.` : null
			if (bad) {
				flag("broken_reference", subject, ref, bad, critical)
				return values.push({ subject, ref, critical, present: false, correct: false })
			}
		}
		const supported = excerptSupports(field, value, e.doc.excerpt)
		const normalised = normalisedCorrectly(field, value, e.doc)
		if (supported === false) flag("unsupported_claim", subject, ref, `The quoted line does not contain the value ${e.doc.normalized ?? String(value)}.`, critical)
		if (!normalised) flag("incorrect_normalization", subject, ref, `The stored value ${e.doc.normalized ?? String(value)} does not follow from what was written ("${e.doc.original ?? ""}").`, critical)
		values.push({ subject, ref, critical, present: true, correct: supported === false || !normalised ? false : supported })
	}

	const readingOf = (r: Reading, who: string, critical: (f: ReadingField) => boolean) => {
		for (const f of READING_FIELDS) if (r[f] != null) checkRead(`${who}: ${FIELD_LABEL[f].toLowerCase()}`, f, r[f] as string | Minor, r.refs[f], critical(f))
		r.lines.forEach((l, i) => checkRead(`${who}: line item ${i + 1}`, "line", l.amount, l.ref, false))
	}
	const x = c.extraction.result
	const reader = c.mode === "single" ? "Solo" : "Extractor"
	if (x?.isPaymentRequest) readingOf(x, reader, (f) => CRITICAL_FIELDS.includes(f))
	if (c.audit.result) readingOf(c.audit.result.reading, "Auditor", () => false)

	// Other document excerpts the desk or the Auditor put in the ledger.
	for (const e of Object.values(c.ledger)) {
		if (!e.doc || /^[XA]:(?!conflict)/.test(e.id)) continue
		const ok = text != null && e.doc.docId === c.id && excerptIsThere(text, e.doc)
		if (!ok) flag("broken_reference", e.label, e.id, "The quoted text is not where the ledger says it is.", false)
		values.push({ subject: e.label, ref: e.id, critical: false, present: ok, correct: ok ? null : false })
	}

	// Trusted records: does the record the ledger cites exist, and does it say what the ledger says?
	for (const e of Object.values(c.ledger)) {
		if (!e.record) continue
		const id = e.record.recordId
		let exists = true
		let critical = false
		if (e.id.startsWith("V:")) { const v = ctx.vendors.find((k) => k.id === id); exists = !!v && formatIban(v.iban) === e.record.fields.iban; critical = true }
		else if (e.id.startsWith("H:")) { exists = ctx.history.some((k) => k.id === id); critical = true }
		else if (e.id.startsWith("HV:")) { exists = ctx.verified.some((k) => k.ref === id); critical = true }
		else if (e.id.startsWith("VC:")) { const k = ctx.confirmed.find((v) => v.ref === id); exists = !!k && k.status === "verified" && formatMinor(k.payableAmount, k.currency) === e.record.fields.payableAmount; critical = true }
		else if (e.id.startsWith("PO:")) exists = ctx.purchaseOrders.some((k) => k.po === id)
		else if (e.id === "P:limit") exists = e.record.fields.autoApproveLimit === formatMinor(ctx.policy.autoApproveLimit, ctx.policy.currency)
		else if (e.id === "P:budget") exists = e.record.fields.dailyAutoApproveBudget === formatMinor(ctx.policy.dailyAutoApproveBudget, ctx.policy.currency)
		else if (e.id.startsWith("P:")) exists = ctx.policy.rules.some((k) => k.id === id)
		else if (e.id.startsWith("D:")) exists = ctx.cases.some((k) => k.id === id)
		if (!exists) flag("broken_reference", e.label, e.id, `The record "${id}" is not in ${e.record.source}, or no longer says what the ledger recorded.`, critical)
		values.push({ subject: e.label, ref: e.id, critical, present: exists, correct: exists })
	}

	// Calculations: every input must be traceable, and the inputs must be the values their references hold.
	for (const e of Object.values(c.ledger)) {
		if (!e.calc) continue
		const problems: string[] = []
		for (const input of e.calc.inputs) {
			if (input.ref) {
				const src = c.ledger[input.ref]
				if (!src) problems.push(`input "${input.label}" cites ${input.ref}, which is not in the ledger`)
				else if (src.doc && src.doc.normalized != null && src.doc.normalized !== input.value) problems.push(`input "${input.label}" is ${input.value}, but its source ${input.ref} holds ${src.doc.normalized}`)
				continue
			}
			// An input without a reference must be recomputable from desk state.
			const other = ctx.cases.find((k) => k.id === input.label)
			if (other) { if (other.extraction.result?.gross == null || formatMinor(other.extraction.result.gross) !== input.value) problems.push(`input "${input.label}" does not match that case's extracted amount`) }
			else if (e.id === "C:daily" && input.label === "Auto-approved so far") { if (formatMinor(ctx.dailyAutoApproved) !== input.value) problems.push(`"Auto-approved so far" is ${input.value}, the desk now computes ${formatMinor(ctx.dailyAutoApproved)}`) }
			else problems.push(`input "${input.label}" has no source reference`)
		}
		if (x && e.id === "C:arithmetic" && x.net != null && x.tax != null && !e.calc.result.startsWith(formatMinor(x.net + x.tax))) problems.push("the recorded sum is not net + tax")
		if (x && e.id === "C:lines" && !e.calc.result.startsWith(formatMinor(x.lines.reduce((s, l) => s + l.amount, 0)))) problems.push("the recorded sum is not the sum of the line items")
		for (const p of problems) flag("untraceable_calculation", e.label, e.id, `${p}.`, true)
		values.push({ subject: e.label, ref: e.id, critical: true, present: true, correct: problems.length === 0 })
	}

	// The figures the app reports and acts on: exposure and the draft.
	if (c.exposure && x && !c.controls.some((k) => k.id === "duplicate" && c.exposure!.ref.startsWith("D:same:"))) {
		const ok = c.exposure.ref in c.ledger && c.exposure.minor === x.gross && c.exposure.currency === x.currency
		if (!ok) flag("missing_evidence", "Exposure", c.exposure.ref, "The exposure figure does not rest on the extracted gross amount.", true)
		values.push({ subject: "Exposure", ref: c.exposure.ref, critical: true, present: c.exposure.ref in c.ledger, correct: ok })
	}
	if (c.draft && x) {
		const amountOk = c.draft.amount.minor === x.gross && c.draft.amount.currency === x.currency
		const ibanOk = normalizeIban(c.draft.creditor.iban) === x.iban
		const refsOk = Object.values(c.draft.evidence).every((r) => r in c.ledger)
		if (!amountOk || !ibanOk) flag("unsupported_claim", "Payment draft", c.draft.evidence.amount ?? null, "The draft's amount or account is not the extracted, evidenced value.", true)
		if (!refsOk) flag("broken_reference", "Payment draft", null, "The draft cites evidence that is not in the ledger.", true)
		values.push({ subject: "Payment draft", ref: c.draft.evidence.amount ?? null, critical: true, present: refsOk, correct: amountOk && ibanOk })
	}

	// Agent statements: a fact or an issue that cites nothing is counted, and never treated as verified.
	c.investigation.result?.verifiedFacts.forEach((f, i) => {
		const cited = f.refs.length > 0
		if (!cited) flag("unsupported_claim", `Investigator: verified fact ${i + 1}`, null, "The statement cites no evidence in the ledger.", false)
		values.push({ subject: `Investigator: verified fact ${i + 1}`, ref: f.refs[0] ?? null, critical: false, present: cited, correct: null })
	})
	c.validation.result?.issues.forEach((issue, i) => {
		if (issue.severity === "info") return
		const cited = issue.refs.length > 0
		if (!cited) flag("unsupported_claim", `Validator: issue ${i + 1} (${issue.code})`, null, "The issue cites no evidence in the ledger.", false)
		values.push({ subject: `Validator: issue ${i + 1} (${issue.code})`, ref: issue.refs[0] ?? null, critical: false, present: cited, correct: null })
	})

	return { values, findings, ok: !findings.some((f) => f.critical) }
}

/** Counts for a report or a metric. "checkable" leaves out values whose correctness cannot be checked mechanically. */
export function integrityCounts(reports: IntegrityReport[]): IntegrityCounts {
	const all = reports.flatMap((r) => r.values)
	const present = all.filter((v) => v.present)
	const checkable = present.filter((v) => v.correct !== null)
	return {
		values: all.length, present: present.length, checkable: checkable.length, correct: checkable.filter((v) => v.correct).length,
		critical: all.filter((v) => v.critical).length, criticalCorrect: all.filter((v) => v.critical && v.present && v.correct !== false).length,
		findings: reports.reduce((s, r) => s + r.findings.length, 0), criticalFindings: reports.reduce((s, r) => s + r.findings.filter((f) => f.critical).length, 0),
	}
}
