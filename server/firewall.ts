/**
 * The payment firewall: every control that decides whether money may be authorised.
 *
 * Nothing in this file calls a model. It reads the shared case state (what the agents wrote),
 * the trusted records and the policy, and produces controls, evidence and the strictest disposition
 * the policy allows. An agent can explain, and can ask for something stricter; it cannot loosen any of this.
 */
import type {
	Callback, Control, Disposition, EvidenceEntry, HistoricalPayment, Minor, PaymentCase, Policy, PurchaseOrder, Reading, ReadingField, SourceDocument, Vendor,
} from "./domain.js"
import { CRITICAL_FIELDS, MONEY_FIELDS, READING_FIELDS } from "./domain.js"
import { locate } from "./data.js"
import { formatIban, ibansIn, isValidIban, normalizeIban } from "./lib/iban.js"
import { amountsIn, formatMinor, normalizeCurrency, parseMoney, strictAmountsIn } from "./money.js"

export const STRICTNESS: Record<Disposition, number> = { AUTO_APPROVED: 0, NEEDS_APPROVAL: 1, BLOCKED: 2, PROCESSING_ERROR: 3 }
export const stricter = (a: Disposition, b: Disposition): Disposition => (STRICTNESS[a] >= STRICTNESS[b] ? a : b)

export type FirewallContext = {
	policy: Policy
	vendors: Vendor[]
	history: HistoricalPayment[]
	purchaseOrders: PurchaseOrder[]
	/** Bank-detail changes a person verified on this desk against a recorded callback. */
	verified: (Callback & { verifiedBy: string; verifiedAt: string })[]
	cases: PaymentCase[]
	documents: Map<string, SourceDocument>
	/** Total already approved automatically today, not counting the case being evaluated. */
	dailyAutoApproved: Minor
}

// ───────── helpers ─────────

const alnum = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
const LEGAL = /\b(gmbh|ag|sas|sa|sarl|bv|b\.v\.|nv|sl|s\.l\.|ltd|limited|llc|inc|doo|d\.o\.o\.|oy|oü|ou|ab|as|plc)\b/g
const nameTokens = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(LEGAL, " ").split(/\s+/).filter((t) => t.length > 1))

export function matchVendor(name: string | null, vendors: Vendor[]): { vendor: Vendor | null; score: number; candidates: { id: string; name: string; score: number }[] } {
	if (!name) return { vendor: null, score: 0, candidates: [] }
	const a = nameTokens(name)
	const scored = vendors.map((v) => {
		const b = nameTokens(v.name)
		const inter = [...a].filter((t) => b.has(t)).length
		const union = new Set([...a, ...b]).size
		return { id: v.id, name: v.name, score: union ? inter / union : 0 }
	}).sort((x, y) => y.score - x.score)
	const best = scored[0]
	return { vendor: best && best.score >= 0.5 ? vendors.find((v) => v.id === best.id)! : null, score: best?.score ?? 0, candidates: scored.slice(0, 3) }
}

const daysBetween = (a: string | null, b: string | null): number | null => {
	if (!a || !b || !/^\d{4}-\d{2}-\d{2}/.test(a) || !/^\d{4}-\d{2}-\d{2}/.test(b)) return null
	return Math.abs(Date.parse(a.slice(0, 10)) - Date.parse(b.slice(0, 10))) / 86_400_000
}

// ───────── readings: turning what an agent submitted into values plus evidence ─────────

export type FieldInput = { value?: string | number | null; quote?: string | null } | null | undefined
export type ReadingInput = {
	isPaymentRequest?: boolean
	documentKind?: string
	fields?: Partial<Record<ReadingField, FieldInput>>
	lines?: { label?: string; amount?: string | number | null; quote?: string | null }[]
	note?: string
}

function supports(field: ReadingField | "line", normalized: string | Minor, quote: string): boolean | null {
	if (!quote.trim()) return false
	if (field === "line" || MONEY_FIELDS.includes(field as ReadingField)) return amountsIn(quote).includes(normalized as Minor)
	if (field === "iban") return quote.replace(/\s+/g, "").toUpperCase().includes(String(normalized))
	if (field === "currency") return quote.toUpperCase().includes(String(normalized)) || (normalized === "EUR" && quote.includes("€"))
	if (field === "invoiceDate" || field === "dueDate") return null
	return alnum(quote).includes(alnum(String(normalized)))
}

/**
 * Builds a Reading from raw agent input. Every value gets a ledger entry that records the quote, where it sits
 * in the document, and whether the quote really contains the value. A value without input stays null: nothing is inferred.
 */
export function buildReading(input: ReadingInput, doc: SourceDocument, by: "Extractor" | "Auditor"): { reading: Reading; entries: EvidenceEntry[] } {
	const prefix = by === "Extractor" ? "X" : "A"
	const entries: EvidenceEntry[] = []
	const reading: Reading = {
		isPaymentRequest: input.isPaymentRequest !== false,
		documentKind: (input.documentKind ?? "unknown").trim() || "unknown",
		creditorName: null, vendorTaxId: null, beneficiaryName: null, invoiceNumber: null, invoiceDate: null, dueDate: null, currency: null,
		net: null, tax: null, gross: null, iban: null, bic: null, reference: null, poReference: null,
		lines: [], refs: {}, note: (input.note ?? "").trim(),
	}
	const entry = (id: string, field: string, label: string, original: string | null, normalized: string, quote: string, check: boolean | null, retypedFrom: string | null = null) => {
		const at = quote.trim() ? locate(doc.text, quote) : null
		entries.push({ id, category: "source_document", label, by, doc: { docId: doc.id, field, lineStart: at?.start ?? null, lineEnd: at?.end ?? null, excerpt: quote.trim(), original, normalized, located: at != null, retypedFrom, supportsValue: at == null ? false : check } })
	}
	for (const f of READING_FIELDS) {
		const raw = input.fields?.[f]
		if (!raw || raw.value == null || String(raw.value).trim() === "") continue
		const original = String(raw.value).trim()
		const quote = (raw.quote ?? "").toString()
		let value: string | Minor | null
		let retypedFrom: string | null = null
		if (MONEY_FIELDS.includes(f)) value = parseMoney(original)
		else if (f === "iban") {
			// An account number is read from the quoted line itself, character by character. What the agent retyped is only
			// used when the line is missing or holds more than one IBAN: a model can drop a digit, the document text cannot.
			value = normalizeIban(original)
			const written = locate(doc.text, quote) ? ibansIn(quote) : []
			if (written.length === 1 && written[0] !== value) { retypedFrom = value; value = written[0]! }
		}
		else if (f === "currency") value = normalizeCurrency(original)
		else if (f === "bic") value = original.replace(/\s+/g, "").toUpperCase()
		else value = original
		if (value == null) continue
		;(reading as Record<string, unknown>)[f] = value
		const id = `${prefix}:${f}`
		reading.refs[f] = id
		const shown = typeof value === "number" ? formatMinor(value) : f === "iban" ? formatIban(value) : value
		entry(id, f, `${FIELD_LABEL[f]} as read by the ${by}`, original, shown, quote, supports(f, value, quote), retypedFrom)
	}
	;(input.lines ?? []).forEach((l, i) => {
		const amount = parseMoney(l.amount ?? null)
		if (amount == null) return
		const id = `${prefix}:line:${i + 1}`
		const quote = (l.quote ?? "").toString()
		entry(id, "line", `Line item ${i + 1} as read by the ${by}`, String(l.amount), formatMinor(amount), quote, supports("line", amount, quote))
		reading.lines.push({ label: (l.label ?? `line ${i + 1}`).trim(), amount, ref: id })
	})
	return { reading, entries }
}

export const FIELD_LABEL: Record<ReadingField, string> = {
	creditorName: "Creditor", vendorTaxId: "Vendor tax id", beneficiaryName: "Beneficiary", invoiceNumber: "Invoice number", invoiceDate: "Invoice date", dueDate: "Due date",
	currency: "Currency", net: "Net amount", tax: "Tax amount", gross: "Gross amount", iban: "IBAN", bic: "BIC", reference: "Payment reference", poReference: "Purchase order",
}

// ───────── instruction-like content ─────────

const INSTRUCTION_PATTERNS = [
	/ignore\s+(?:all\s+|any\s+|the\s+|your\s+|previous\s+|prior\s+)*(?:instructions?|rules?|polic(?:y|ies)|approval|controls?)/i,
	/(?:automatically|auto[- ]?)\s*approve/i,
	/do\s+not\s+(?:flag|review|mention|report|escalate)/i,
	/(?:system|developer)\s+(?:note|prompt|message|instruction)/i,
	/(?:\bai\b|\bllm\b|language model|assistant)[^.\n]{0,40}(?:processing|reading|must|should)/i,
	/disregard[^.\n]{0,40}(?:polic|instruction|rule)/i,
	/override[^.\n]{0,40}(?:polic|control|limit|approval)/i,
]

/** Lines of a document that read like instructions to whoever is processing it. Detection only; the text is never obeyed. */
export function instructionLines(text: string): { line: number; text: string }[] {
	return text.split("\n").map((t, i) => ({ line: i + 1, text: t.trim() })).filter((l) => l.text && INSTRUCTION_PATTERNS.some((p) => p.test(l.text))).slice(0, 6)
}

const PAY_PHRASE = /please pay|amount due|amount payable|to be paid|zu zahlen|bitte überweisen|net à payer|à payer|a pagar|za platiti|za uplatu/i

// ───────── the controls ─────────

export type Evaluation = {
	controls: Control[]
	entries: EvidenceEntry[]
	/** The most permissive disposition the controls allow. */
	floor: Disposition
	/** Whether an exception is serious enough to send to the Investigator. */
	investigate: boolean
	exposure: PaymentCase["exposure"]
}

const ROUTINE = new Set(["per_payment_limit", "daily_limit"])

export function evaluate(c: PaymentCase, ctx: FirewallContext): Evaluation {
	const { policy } = ctx
	const controls: Control[] = []
	const entries: EvidenceEntry[] = []
	const add = (id: string, label: string, rule: string | null, status: Control["status"], severity: Control["severity"], detail: string, refs: (string | null | undefined)[] = []) => {
		const all = [...refs, rule ? `P:${rule}` : null].filter((r): r is string => !!r)
		controls.push({ id, label, rule, status, severity, detail, refs: [...new Set(all)] })
	}
	const record = (id: string, category: EvidenceEntry["category"], label: string, source: string, recordId: string, fields: Record<string, string>) => { entries.push({ id, category, label, by: "Desk", record: { source, recordId, fields } }); return id }
	const calc = (id: string, label: string, method: string, inputs: { label: string; value: string; ref: string | null }[], result: string, currency: string | null) => { entries.push({ id, category: "calculation", label, by: "Desk", calc: { method, inputs, result, currency, rounding: "exact, in minor units; no rounding or tolerance" } }); return id }
	for (const r of policy.rules) record(`P:${r.id}`, "policy", `Policy rule ${r.id}`, "server/data/policy.json", r.id, { rule: r.text, effect: r.effect === "blocked" ? "blocks the payment" : "needs a human approver" })
	const limitRef = record("P:limit", "policy", "Auto-approve limit", "server/data/policy.json", "autoApproveLimit", { autoApproveLimit: formatMinor(policy.autoApproveLimit, policy.currency) })
	const budgetRef = record("P:budget", "policy", "Daily auto-approve budget", "server/data/policy.json", "dailyAutoApproveBudget", { dailyAutoApproveBudget: formatMinor(policy.dailyAutoApproveBudget, policy.currency) })

	const others = ctx.cases.filter((o) => o.id !== c.id)
	const earlier = (o: PaymentCase) => o.receivedAt < c.receivedAt || (o.receivedAt === c.receivedAt && o.id < c.id)
	const byReceived = (a: PaymentCase, b: PaymentCase) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id)

	// Intake: the same content under another name. Decided before any agent runs.
	const original = others.filter((o) => o.hash === c.hash && earlier(o)).sort(byReceived)[0]
	if (original) {
		const ox = original.extraction.result
		const ref = record(`D:same:${original.id}`, "source_document", `Identical document already in the inbox`, "content hash (SHA-256 of the normalised text)", original.id, { document: original.fileName, hash: c.hash.slice(0, 16) + "…", received: original.receivedAt })
		add("duplicate", "Duplicate payment request", "R7", "fail", "block", `This file has exactly the same content as ${original.fileName}, received earlier. It is the same request under another name.`, [ref])
		const exposure = ox?.gross != null && ox.currency ? { minor: ox.gross, currency: ox.currency, ref } : null
		return { controls, entries, floor: "BLOCKED", investigate: false, exposure }
	}

	const x = c.extraction.result
	if (!x || !x.isPaymentRequest) return { controls, entries, floor: c.extraction.status === "error" ? "PROCESSING_ERROR" : "AUTO_APPROVED", investigate: false, exposure: null }
	const doc = ctx.documents.get(c.id)
	const ref = (f: ReadingField) => x.refs[f] ?? null
	const src = (f: ReadingField) => (ref(f) ? c.ledger[ref(f)!] : undefined)

	// 1. mandatory fields
	const missing = CRITICAL_FIELDS.filter((f) => x[f] == null)
	if (missing.length) add("mandatory_fields", "Mandatory fields", "R1", "fail", "block", `Not on the document: ${missing.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")}. A missing value is never taken from another record.`, CRITICAL_FIELDS.map(ref))
	else add("mandatory_fields", "Mandatory fields", "R1", "pass", "block", "Creditor, gross amount, currency and IBAN are all on the document.", CRITICAL_FIELDS.map(ref))

	// 2. evidence
	const unlocated = CRITICAL_FIELDS.filter((f) => x[f] != null && !src(f)?.doc?.located)
	const unsupported = CRITICAL_FIELDS.filter((f) => x[f] != null && src(f)?.doc?.located && src(f)?.doc?.supportsValue === false)
	if (unlocated.length || unsupported.length) {
		const parts = [unlocated.length ? `no quote found in the document for: ${unlocated.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")}` : "", unsupported.length ? `the quote does not contain the value for: ${unsupported.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")}` : ""].filter(Boolean)
		add("evidence", "Source evidence", "R2", "fail", "block", `${parts.join("; ")}. An unsupported value cannot be paid.`, CRITICAL_FIELDS.map(ref))
	} else add("evidence", "Source evidence", "R2", "pass", "block", "Every critical value is quoted from the document and the quote contains it.", CRITICAL_FIELDS.map(ref))

	// 3. vendor
	const vendor = matchVendor(x.creditorName, ctx.vendors).vendor
	const vendorRef = vendor ? record(`V:${vendor.id}`, "vendor_record", `Vendor master record ${vendor.id}`, "server/data/vendors.json", vendor.id, { name: vendor.name, iban: formatIban(vendor.iban), bic: vendor.bic, vatId: vendor.vatId, approvedSince: vendor.approvedSince }) : null
	if (!x.creditorName) add("vendor_known", "Known vendor", "R3", "unknown", "block", "No creditor name to look up.")
	else if (!vendor) add("vendor_known", "Known vendor", "R3", "fail", "block", `"${x.creditorName}" is not in the vendor master. Its bank details cannot be checked against anything we trust.`, [ref("creditorName")])
	else {
		const taxMismatch = x.vendorTaxId && alnum(x.vendorTaxId) !== alnum(vendor.vatId) && !alnum(vendor.vatId).includes(alnum(x.vendorTaxId)) && !alnum(x.vendorTaxId).includes(alnum(vendor.vatId).replace(/^[a-z]{2}/, ""))
		if (taxMismatch) add("vendor_known", "Known vendor", "R14", "review", "review", `The name matches ${vendor.name} (${vendor.id}) but the tax id on the document (${x.vendorTaxId}) is not the one on file (${vendor.vatId}).`, [ref("creditorName"), ref("vendorTaxId"), vendorRef])
		else add("vendor_known", "Known vendor", "R3", "pass", "block", `${vendor.name} is approved vendor ${vendor.id}.`, [ref("creditorName"), vendorRef])
	}

	// 4. IBAN checksum
	if (!x.iban) add("iban_checksum", "IBAN checksum", "R4", "unknown", "block", "No IBAN to check.")
	else if (!isValidIban(x.iban)) add("iban_checksum", "IBAN checksum", "R4", "fail", "block", `${formatIban(x.iban)} fails the ISO 13616 mod-97 checksum. This account number cannot exist.`, [ref("iban")])
	else add("iban_checksum", "IBAN checksum", "R4", "pass", "block", "Structurally valid (ISO 13616, mod 97). Validity says nothing about who owns the account.", [ref("iban")])

	// 5. beneficiary
	if (x.iban && vendor) {
		if (normalizeIban(vendor.iban) === x.iban) add("beneficiary", "Beneficiary account", "R5", "pass", "block", "The IBAN on the document is the one on file for this vendor.", [ref("iban"), vendorRef])
		else {
			const v = ctx.verified.find((k) => k.vendorId === vendor.id && normalizeIban(k.iban) === x.iban)
			if (v) {
				const hv = record(`HV:${v.ref}`, "human_verification", `Callback verification ${v.ref}`, "server/data/callbacks.json, confirmed by a reviewer", v.ref, { vendor: vendor.id, iban: formatIban(v.iban), method: v.method, confirmedBy: v.confirmedBy, confirmedAt: v.confirmedAt, checkedBy: v.verifiedBy, checkedAt: v.verifiedAt })
				add("beneficiary", "Beneficiary account", "R5", "review", "review", `The IBAN differs from the vendor master, and the change is verified by callback ${v.ref}. The vendor master is unchanged; a person still approves this payment.`, [ref("iban"), vendorRef, hv])
			} else add("beneficiary", "Beneficiary account", "R5", "fail", "block", `The document asks for ${formatIban(x.iban)}; the vendor master has ${formatIban(vendor.iban)}. The checksum is valid, but ownership of the new account is unverified.`, [ref("iban"), vendorRef])
		}
	} else add("beneficiary", "Beneficiary account", "R5", "unknown", "block", !x.iban ? "No IBAN on the document." : "No vendor record to compare the IBAN with.", [ref("iban")])
	if (vendor && x.beneficiaryName && !matchVendor(x.beneficiaryName, [vendor]).vendor) add("beneficiary_name", "Beneficiary name", "R14", "review", "review", `The beneficiary named on the document ("${x.beneficiaryName}") is not ${vendor.name}.`, [ref("beneficiaryName"), vendorRef])

	// 6. currency
	if (x.currency) {
		if (policy.currencies.includes(x.currency)) add("currency", "Currency", "R6", "pass", "block", `${x.currency} is payable under the policy.`, [ref("currency")])
		else add("currency", "Currency", "R6", "fail", "block", `${x.currency} is not in the policy's currencies (${policy.currencies.join(", ")}).`, [ref("currency")])
	}

	// 7. duplicates
	const vendorKey = (r: Reading) => matchVendor(r.creditorName, ctx.vendors).vendor?.id ?? alnum(r.creditorName)
	const mine = vendorKey(x)
	const payments = others.filter((o) => o.extraction.result?.isPaymentRequest)
	const sameInvoice = payments.filter((o) => mine && vendorKey(o.extraction.result!) === mine && alnum(x.invoiceNumber) !== "" && alnum(o.extraction.result!.invoiceNumber) === alnum(x.invoiceNumber))
	const firstSame = sameInvoice.filter(earlier).sort(byReceived)[0]
	const paid = vendor && x.invoiceNumber ? ctx.history.find((h) => h.vendorId === vendor.id && alnum(h.invoiceNumber) === alnum(x.invoiceNumber)) : undefined
	const near = payments.filter((o) => {
		const ox = o.extraction.result!
		if (!mine || vendorKey(ox) !== mine || x.gross == null || ox.gross !== x.gross || ox.currency !== x.currency || sameInvoice.includes(o) || !earlier(o)) return false
		const gap = daysBetween(x.invoiceDate, ox.invoiceDate)
		return gap == null || gap <= policy.nearDuplicateWindowDays
	})
	if (paid) {
		const h = record(`H:${paid.id}`, "historical_payment", `Payment history record ${paid.id}`, "server/data/history.json", paid.id, { vendor: paid.vendorId, invoiceNumber: paid.invoiceNumber, gross: formatMinor(paid.gross, paid.currency), paidAt: paid.paidAt })
		add("duplicate", "Duplicate payment request", "R7", "fail", "block", `Invoice ${x.invoiceNumber} from ${vendor!.name} was already paid on ${paid.paidAt} (${paid.id}).`, [ref("invoiceNumber"), h])
	} else if (firstSame) {
		const o = record(`D:dup:${firstSame.id}`, "source_document", `Earlier document with the same invoice number`, "the inbox", firstSame.id, { document: firstSame.fileName, invoiceNumber: firstSame.extraction.result!.invoiceNumber ?? "", received: firstSame.receivedAt })
		add("duplicate", "Duplicate payment request", "R7", "fail", "block", `Same vendor and invoice number as ${firstSame.id}, which was received earlier. Paying both would pay the invoice twice.`, [ref("invoiceNumber"), o])
	} else if (near.length) {
		const o = record(`D:near:${near[0]!.id}`, "source_document", `Earlier request for the same amount`, "the inbox", near[0]!.id, { document: near[0]!.fileName, invoiceNumber: near[0]!.extraction.result!.invoiceNumber ?? "none", gross: formatMinor(x.gross!, x.currency) })
		add("duplicate", "Duplicate payment request", "R14", "review", "review", `Same vendor and the same amount as ${near[0]!.id}, with a different or missing invoice number. A suspected near-duplicate, not a proven one.`, [ref("gross"), o])
	} else {
		const later = sameInvoice.filter((o) => !earlier(o)).map((o) => o.id)
		add("duplicate", "Duplicate payment request", "R7", "pass", "block", later.length ? `This is the first request for this invoice. A later copy (${later.join(", ")}) is stopped instead.` : "No other request for this invoice in the inbox or in the payment history.", [ref("invoiceNumber")])
	}

	// 8. arithmetic
	if (x.net != null && x.tax != null && x.gross != null) {
		const sum = x.net + x.tax
		const id = calc("C:arithmetic", "Net plus tax against gross", "net + tax, compared with the gross amount on the document", [{ label: "Net", value: formatMinor(x.net), ref: ref("net") }, { label: "Tax", value: formatMinor(x.tax), ref: ref("tax") }, { label: "Gross on the document", value: formatMinor(x.gross), ref: ref("gross") }], `${formatMinor(sum)} computed; difference ${formatMinor(x.gross - sum)}`, x.currency)
		if (sum === x.gross) add("arithmetic", "Arithmetic", "R8", "pass", "block", `Net ${formatMinor(x.net)} + tax ${formatMinor(x.tax)} = gross ${formatMinor(x.gross)}.`, [id])
		else add("arithmetic", "Arithmetic", "R8", "fail", "block", `Net ${formatMinor(x.net)} + tax ${formatMinor(x.tax)} is ${formatMinor(sum)}, but the document asks for ${formatMinor(x.gross)}: a difference of ${formatMinor(Math.abs(x.gross - sum), x.currency)}.`, [id])
	} else add("arithmetic", "Arithmetic", null, "na", "info", "Not applicable: the document states one total and no separate net and tax, so there is nothing to add up.", [ref("gross")])
	if (x.lines.length >= 2 && x.lines.every((l) => l.ref && c.ledger[l.ref]?.doc?.supportsValue)) {
		const target = x.net ?? x.gross
		const sum = x.lines.reduce((s, l) => s + l.amount, 0)
		if (target != null) {
			const id = calc("C:lines", "Sum of line items", `sum of the ${x.lines.length} line totals, compared with the ${x.net != null ? "net" : "gross"} amount`, [...x.lines.map((l) => ({ label: l.label, value: formatMinor(l.amount), ref: l.ref })), { label: x.net != null ? "Net on the document" : "Gross on the document", value: formatMinor(target), ref: ref(x.net != null ? "net" : "gross") }], `${formatMinor(sum)} computed; difference ${formatMinor(target - sum)}`, x.currency)
			if (sum === target) add("line_items", "Line items", "R14", "pass", "review", `The ${x.lines.length} line totals add up to ${formatMinor(target)}.`, [id])
			else add("line_items", "Line items", "R14", "review", "review", `The line totals add up to ${formatMinor(sum)}, the document states ${formatMinor(target)}.`, [id])
		}
	}

	// 9 + 10. limits
	if (x.gross != null) {
		const lid = calc("C:limit", "Amount against the auto-approve limit", "gross compared with the per-payment auto-approve limit", [{ label: "Gross", value: formatMinor(x.gross), ref: ref("gross") }, { label: "Limit", value: formatMinor(policy.autoApproveLimit), ref: limitRef }], x.gross > policy.autoApproveLimit ? `over by ${formatMinor(x.gross - policy.autoApproveLimit)}` : `under by ${formatMinor(policy.autoApproveLimit - x.gross)}`, x.currency)
		if (x.gross > policy.autoApproveLimit) add("per_payment_limit", "Per-payment limit", "R9", "review", "review", `${formatMinor(x.gross, x.currency)} is above the auto-approve limit of ${formatMinor(policy.autoApproveLimit, policy.currency)}.`, [lid])
		else add("per_payment_limit", "Per-payment limit", "R9", "pass", "review", `${formatMinor(x.gross, x.currency)} is within the auto-approve limit of ${formatMinor(policy.autoApproveLimit, policy.currency)}.`, [lid])
		const after = ctx.dailyAutoApproved + x.gross
		const did = calc("C:daily", "Daily auto-approved total", "already auto-approved today + this payment, compared with the daily budget", [{ label: "Auto-approved so far", value: formatMinor(ctx.dailyAutoApproved), ref: null }, { label: "This payment", value: formatMinor(x.gross), ref: ref("gross") }, { label: "Daily budget", value: formatMinor(policy.dailyAutoApproveBudget), ref: budgetRef }], `${formatMinor(after)} of ${formatMinor(policy.dailyAutoApproveBudget)}`, x.currency)
		if (after > policy.dailyAutoApproveBudget) add("daily_limit", "Daily auto-approve budget", "R10", "review", "review", `Approving this automatically would bring today's total to ${formatMinor(after, policy.currency)}, above the daily budget of ${formatMinor(policy.dailyAutoApproveBudget, policy.currency)}.`, [did])
		else add("daily_limit", "Daily auto-approve budget", "R10", "pass", "review", `Today's automatic total would be ${formatMinor(after, policy.currency)} of ${formatMinor(policy.dailyAutoApproveBudget, policy.currency)}.`, [did])
	}

	// 11. split payments
	if (vendor && x.gross != null && x.gross <= policy.autoApproveLimit) {
		const related = payments.filter((o) => {
			const ox = o.extraction.result!
			if (matchVendor(ox.creditorName, ctx.vendors).vendor?.id !== vendor.id || ox.gross == null || ox.currency !== x.currency || sameInvoice.includes(o)) return false
			const samePo = !!x.poReference && alnum(ox.poReference) === alnum(x.poReference)
			const sameDay = !x.poReference && !ox.poReference && !!x.invoiceDate && ox.invoiceDate === x.invoiceDate
			const gap = daysBetween(x.invoiceDate, ox.invoiceDate)
			return (samePo && (gap == null || gap <= policy.splitWindowDays)) || sameDay
		})
		const total = related.reduce((s, o) => s + o.extraction.result!.gross!, x.gross)
		if (related.length && total > policy.autoApproveLimit && related.every((o) => o.extraction.result!.gross! <= policy.autoApproveLimit)) {
			const id = calc("C:split", "Related requests added together", `requests from ${vendor.name} on ${x.poReference ? `purchase order ${x.poReference}` : `invoice date ${x.invoiceDate}`} within ${policy.splitWindowDays} days`, [{ label: c.id, value: formatMinor(x.gross), ref: ref("gross") }, ...related.map((o) => ({ label: o.id, value: formatMinor(o.extraction.result!.gross!), ref: null })), { label: "Limit", value: formatMinor(policy.autoApproveLimit), ref: limitRef }], `${formatMinor(total)} together`, x.currency)
			add("split_payment", "Split payment", "R11", "review", "review", `Together with ${related.map((o) => o.id).join(", ")} this comes to ${formatMinor(total, x.currency)}, above the limit, while each request alone is under it. A possible split, not a proven one.`, [id, ref("poReference")])
		}
	}

	// purchase order
	if (x.poReference) {
		const po = ctx.purchaseOrders.find((p) => alnum(p.po) === alnum(x.poReference))
		const pid = po ? record(`PO:${po.po}`, "vendor_record", `Purchase order ${po.po}`, "server/data/purchase-orders.json", po.po, { vendor: po.vendorId, description: po.description, amount: formatMinor(po.amount, po.currency) }) : null
		if (!po) add("purchase_order", "Purchase order", "R14", "review", "review", `${x.poReference} is not a purchase order on record.`, [ref("poReference")])
		else if (vendor && po.vendorId !== vendor.id) add("purchase_order", "Purchase order", "R14", "review", "review", `${po.po} belongs to vendor ${po.vendorId}, not ${vendor.id}.`, [ref("poReference"), pid])
		else add("purchase_order", "Purchase order", null, "pass", "info", `${po.po} exists for this vendor (${formatMinor(po.amount, po.currency)}).`, [ref("poReference"), pid])
	}

	// 12. instruction-like content, 14. amounts stated elsewhere in the document
	if (doc) {
		const lines = instructionLines(doc.text)
		if (lines.length) {
			const refs = lines.map((l) => { entries.push({ id: `D:instruction:${l.line}`, category: "source_document", label: "Instruction-like text in the document", by: "Desk", doc: { docId: doc.id, field: "content", lineStart: l.line, lineEnd: l.line, excerpt: l.text, original: null, normalized: null, located: true, supportsValue: null } }); return `D:instruction:${l.line}` })
			add("instruction_content", "Instruction-like content", "R12", "review", "review", `The document contains text addressed to whoever processes it (line${lines.length > 1 ? "s" : ""} ${lines.map((l) => l.line).join(", ")}). It is treated as document content and has no effect on the controls.`, refs)
		} else add("instruction_content", "Instruction-like content", "R12", "pass", "review", "No text in the document reads like an instruction to the processor.")
		if (x.gross != null) {
			const odd = doc.text.split("\n").map((t, i) => ({ line: i + 1, text: t.trim(), amounts: PAY_PHRASE.test(t) ? strictAmountsIn(t).filter((a) => a !== x.gross) : [] })).filter((l) => l.amounts.length)
			if (odd.length) {
				const refs = odd.slice(0, 3).map((l) => { entries.push({ id: `D:stated:${l.line}`, category: "source_document", label: "Another payable amount stated in the document", by: "Desk", doc: { docId: doc.id, field: "gross", lineStart: l.line, lineEnd: l.line, excerpt: l.text, original: formatMinor(l.amounts[0]!), normalized: formatMinor(l.amounts[0]!), located: true, supportsValue: true } }); return `D:stated:${l.line}` })
				add("stated_amounts", "Amounts stated in the document", "R14", "review", "review", `The document also asks for ${odd.map((l) => formatMinor(l.amounts[0]!, x.currency)).join(", ")} (line ${odd.map((l) => l.line).join(", ")}), which is not the extracted total of ${formatMinor(x.gross, x.currency)}.`, [...refs, ref("gross")])
			}
		}
	}

	// 13. agreement between the Extractor and the independent Auditor
	const a = c.audit.result
	if (a) {
		const same = (f: ReadingField): boolean => {
			const xv = x[f], av = a.reading[f]
			if (f === "creditorName") return (matchVendor(String(xv), ctx.vendors).vendor?.id ?? alnum(String(xv))) === (matchVendor(String(av), ctx.vendors).vendor?.id ?? alnum(String(av)))
			return typeof xv === "number" || typeof av === "number" ? xv === av : alnum(String(xv)) === alnum(String(av))
		}
		const show = (f: ReadingField, v: unknown) => (typeof v === "number" ? formatMinor(v) : f === "iban" ? formatIban(String(v)) : String(v))
		const compared: ReadingField[] = ["gross", "currency", "iban", "net", "tax", "creditorName", "invoiceNumber"]
		const differ = compared.filter((f) => x[f] != null && a.reading[f] != null && !same(f))
		const unseen = CRITICAL_FIELDS.filter((f) => x[f] != null && a.reading[f] == null)
		const refs = differ.map((f) => calc(`C:compare:${f}`, `${FIELD_LABEL[f]}: Extractor against Auditor`, "the two agents read the document independently; the desk compares the values", [{ label: "Extractor", value: show(f, x[f]), ref: ref(f) }, { label: "Auditor", value: show(f, a.reading[f]), ref: a.reading.refs[f] ?? null }], "different", f === "gross" || f === "net" || f === "tax" ? x.currency : null))
		const critical = differ.filter((f) => f === "gross" || f === "currency" || f === "iban")
		if (critical.length) add("agent_agreement", "Extractor and Auditor agree", "R13", "fail", "block", `The two agents read a different ${critical.map((f) => FIELD_LABEL[f].toLowerCase()).join(" and ")} from the same document. Neither value is trusted until the document is reprocessed or corrected.`, refs)
		else if (differ.length || unseen.length || a.conflicts.length || c.validation.result?.disagreements.length) {
			const parts = [
				differ.length ? `the agents differ on ${differ.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")}` : "",
				unseen.length ? `the Auditor could not find ${unseen.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")} in the document` : "",
				a.conflicts.length ? `the Auditor found the document contradicting itself on ${a.conflicts.map((k) => k.field).join(", ")}` : "",
				c.validation.result?.disagreements.length ? "the Validator's report differs from the computed checks" : "",
			].filter(Boolean)
			add("agent_agreement", "Extractor and Auditor agree", "R14", "review", "review", `${parts.join("; ")}.`, [...refs, ...a.conflicts.flatMap((k) => k.refs)])
		} else add("agent_agreement", "Extractor and Auditor agree", "R13", "pass", "block", "The Auditor read the document on its own and arrived at the same amount, currency, IBAN, creditor and invoice number.", (["gross", "iban"] as ReadingField[]).flatMap((f) => [ref(f), a.reading.refs[f] ?? null]))
	}

	// stages: fail closed
	const failed = (["extraction", "validation", "audit", "investigation", "decision"] as const).filter((s) => c[s].status === "error")
	const incomplete = (["validation", "audit"] as const).filter((s) => c[s].status !== "done")
	const exceptions = controls.filter((k) => (k.status === "fail" || k.status === "review") && !ROUTINE.has(k.id))
	if (failed.length) add("stages", "Agent stages", null, "fail", "block", `Failed: ${failed.join(", ")}. A payment is never approved on an incomplete run.`)
	else if (incomplete.length) add("stages", "Agent stages", null, "unknown", "block", `Still waiting for: ${incomplete.join(", ")}.`)
	else add("stages", "Agent stages", null, "pass", "block", "Extraction, validation and the independent audit all completed.")

	let floor: Disposition = "AUTO_APPROVED"
	if (controls.some((k) => k.status === "fail" && k.severity === "block")) floor = "BLOCKED"
	else if (controls.some((k) => k.status === "review" || k.status === "fail")) floor = "NEEDS_APPROVAL"
	else if (controls.some((k) => k.status === "unknown" && k.severity === "block")) floor = "NEEDS_APPROVAL"
	if (failed.length || incomplete.length) floor = "PROCESSING_ERROR"

	const exposure = x.gross != null && x.currency && ref("gross") ? { minor: x.gross, currency: x.currency, ref: ref("gross")! } : null
	return { controls, entries, floor, investigate: exceptions.length > 0, exposure }
}

/** Every amount the app reports for a case, with the ledger entry it rests on. Used by the tests and by the UI. */
export function reportedAmounts(c: PaymentCase): { label: string; minor: Minor; ref: string | null }[] {
	const out: { label: string; minor: Minor; ref: string | null }[] = []
	const x = c.extraction.result
	if (x) {
		for (const f of MONEY_FIELDS) if (x[f] != null) out.push({ label: FIELD_LABEL[f], minor: x[f] as Minor, ref: x.refs[f] ?? null })
		for (const l of x.lines) out.push({ label: l.label, minor: l.amount, ref: l.ref })
	}
	if (c.exposure) out.push({ label: "Exposure", minor: c.exposure.minor, ref: c.exposure.ref })
	if (c.draft) out.push({ label: "Draft amount", minor: c.draft.amount.minor, ref: c.draft.evidence.amount ?? null })
	return out
}
