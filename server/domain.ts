/** Domain types shared by the firewall, the agents, the HTTP API and the web UI. */

/** Money is an integer number of minor units (cents). No floats anywhere near a total. */
export type Minor = number

export type Vendor = {
	id: string
	name: string
	country: string
	iban: string
	bic: string
	vatId: string
	currency: string
	paymentTermsDays: number
	approvedSince: string
}

export type PolicyRule = { id: string; effect: "blocked" | "needs_approval"; text: string }

export type Policy = {
	name: string
	currency: string
	currencies: string[]
	autoApproveLimit: Minor
	dailyAutoApproveBudget: Minor
	splitWindowDays: number
	nearDuplicateWindowDays: number
	rules: PolicyRule[]
	debtor: { name: string; iban: string; bic: string }
}

export type HistoricalPayment = { id: string; vendorId: string; invoiceNumber: string; gross: Minor; currency: string; paidAt: string; iban: string }
export type PurchaseOrder = { po: string; vendorId: string; description: string; amount: Minor; currency: string }
/** Synthetic trusted evidence that a vendor confirmed a bank-detail change out of band. */
export type Callback = { ref: string; vendorId: string; iban: string; confirmedAt: string; method: string; confirmedBy: string }

export type SourceDocument = { id: string; fileName: string; text: string; hash: string; receivedAt: string }

// ───────── evidence ledger ─────────

export type EvidenceCategory = "source_document" | "vendor_record" | "historical_payment" | "policy" | "calculation" | "human_verification"

export type EvidenceEntry = {
	id: string
	category: EvidenceCategory
	label: string
	/** Who put it in the ledger. */
	by: string
	doc?: {
		docId: string
		field: string
		/** 1-based line range in the plain-text document; null when the quote could not be located. */
		lineStart: number | null
		lineEnd: number | null
		excerpt: string
		/** The value as written in the document, and as normalised by the desk. */
		original: string | null
		normalized: string | null
		located: boolean
		/** Set when the agent's typed value differed from what the quoted line says and the desk read the line instead. */
		retypedFrom?: string | null
		/** Whether the quote actually contains the value. null when that cannot be checked mechanically (dates, names). */
		supportsValue: boolean | null
	}
	record?: { source: string; recordId: string; fields: Record<string, string> }
	calc?: { method: string; inputs: { label: string; value: string; ref: string | null }[]; result: string; currency: string | null; rounding: string }
}

// ───────── agent readings ─────────

export const READING_FIELDS = ["creditorName", "vendorTaxId", "beneficiaryName", "invoiceNumber", "invoiceDate", "dueDate", "currency", "net", "tax", "gross", "iban", "bic", "reference", "poReference"] as const
export type ReadingField = (typeof READING_FIELDS)[number]
export const MONEY_FIELDS: readonly ReadingField[] = ["net", "tax", "gross"]
export const CRITICAL_FIELDS: readonly ReadingField[] = ["creditorName", "gross", "currency", "iban"]

/** What an agent read from the document. Each present field has an evidence id in `refs`. */
export type Reading = {
	isPaymentRequest: boolean
	documentKind: string
	creditorName: string | null
	vendorTaxId: string | null
	beneficiaryName: string | null
	invoiceNumber: string | null
	invoiceDate: string | null
	dueDate: string | null
	currency: string | null
	net: Minor | null
	tax: Minor | null
	gross: Minor | null
	iban: string | null
	bic: string | null
	reference: string | null
	poReference: string | null
	lines: { label: string; amount: Minor; ref: string | null }[]
	refs: Partial<Record<ReadingField, string>>
	note: string
}

export type Issue = { code: string; severity: "block" | "review" | "info"; message: string; refs: string[] }

export type Validation = {
	vendorId: string | null
	ibanValid: boolean | null
	ibanMatchesMaster: boolean | null
	duplicateOf: string | null
	issues: Issue[]
	summary: string
	/** Where the agent's report differs from what the desk computed itself. */
	disagreements: string[]
}

/** The Auditor's own reading of the document, made without seeing the Extractor's. */
export type Audit = {
	reading: Reading
	/** Places where the document contradicts itself on a critical value. */
	conflicts: { field: string; values: string[]; refs: string[] }[]
	summary: string
}

export type Disposition = "AUTO_APPROVED" | "NEEDS_APPROVAL" | "BLOCKED" | "PROCESSING_ERROR"

export type Investigation = {
	category: string
	verifiedFacts: { text: string; refs: string[] }[]
	conflictingEvidence: { text: string; refs: string[] }[]
	explanation: string
	unknowns: string[]
	recommendedSteps: string[]
	recommendedDisposition: Disposition
	/** Says explicitly whether this is a confirmed discrepancy or only a suspicion. */
	assessment: "confirmed_discrepancy" | "suspected" | "no_issue_found"
}

/** One deterministic control of the payment firewall. Computed by code from shared state, never by a model. */
export type Control = {
	id: string
	label: string
	rule: string | null
	/** "na": the control does not apply to this document. "unknown": it applies but could not be evaluated. */
	status: "pass" | "fail" | "review" | "unknown" | "na"
	severity: "block" | "review" | "info"
	detail: string
	refs: string[]
}

export type PolicyOpinion = {
	disposition: Disposition
	rulesApplied: string[]
	passed: string[]
	failed: string[]
	humanRequired: boolean
	explanation: string
	refs: string[]
}

export type Decision = {
	/** What the Policy agent recommended. Advisory. */
	recommended: PolicyOpinion | null
	/** The floor the deterministic controls allow. */
	floor: Disposition
	/** What is in force: the stricter of the two. */
	final: Disposition
	overridden: boolean
}

export type ReviewEntry = {
	reviewer: string
	at: string
	action: "approve" | "reject" | "request_verification" | "verify_beneficiary" | "reprocess" | "withdraw_auto_approval"
	reason: string | null
	from: string
	to: string
	outcome: "applied" | "refused"
	refs: string[]
}

export type PaymentDraft = {
	draftId: string
	sandbox: true
	note: string
	caseId: string
	approvalRef: string
	creditor: { name: string; iban: string; bic: string | null }
	debtor: { name: string; iban: string; bic: string }
	amount: { minor: Minor; currency: string; formatted: string }
	reference: string
	requestedExecutionDate: string | null
	createdAt: string
	evidence: Record<string, string>
}

export type Stage =
	| "received" | "extracting" | "checking" | "investigating" | "deciding"
	| "awaiting_approval" | "blocked" | "approved" | "rejected" | "not_a_payment" | "error"

export type AgentName = "Extractor" | "Validator" | "Auditor" | "Investigator" | "Policy"

/** One agent loop on one case: the observability record behind the timeline. */
export type AgentRun = {
	agent: AgentName
	model: string
	attempt: number
	retry: number
	startedAt: string
	finishedAt: string | null
	status: "running" | "done" | "error" | "timeout" | "superseded"
	/** null when the provider reported no usage; never shown as zero. */
	tokens: { input: number; output: number } | null
	trigger: string
	error: string | null
}

export type TimelineEntry = { at: string; agent: string; kind: "loop.started" | "inference" | "tool" | "answer" | "error" | "info"; detail: string }

export type StepStatus<T> = { status: "pending" | "running" | "done" | "error" | "skipped"; startedAt: string | null; finishedAt: string | null; result: T | null; error: string | null }

export type PaymentCase = {
	id: string
	origin: "demo" | "user"
	fileName: string
	hash: string
	receivedAt: string
	/** Bumped on every write, so a reader can tell two snapshots apart. */
	version: number
	/** Bumped on reprocess; writes from an older attempt are discarded. */
	attempt: number
	stage: Stage
	extraction: StepStatus<Reading>
	validation: StepStatus<Validation>
	audit: StepStatus<Audit>
	investigation: StepStatus<Investigation>
	decision: StepStatus<Decision>
	controls: Control[]
	ledger: Record<string, EvidenceEntry>
	/** Gross amount of the request, once extracted. The figure every exposure metric is built from. */
	exposure: { minor: Minor; currency: string; ref: string } | null
	verificationRequested: boolean
	review: ReviewEntry[]
	draft: PaymentDraft | null
	runs: AgentRun[]
	timeline: TimelineEntry[]
}

export type AgentInfo = { id: string; name: AgentName; role: string; model: string }

export type Scenario = { docId: string; title: string; expect: string[]; controls: string[]; why: string }

export type DeskSnapshot = {
	startedAt: string | null
	agents: AgentInfo[]
	policy: Policy
	vendors: Vendor[]
	history: HistoricalPayment[]
	cases: PaymentCase[]
	scenarios: Scenario[]
	dailyAutoApproved: Minor
	cloudEnabled: boolean
	models: { fast: string; careful: string }
	inboxWaiting: number
	reviewer: string
	persisted: boolean
	/** "scripted" only when the server was started with the test fixture model (npm run dev:scripted). */
	modelMode: "live" | "scripted"
	runtime: { participants: number; events: Record<string, number> }
}

export function emptyStep<T>(): StepStatus<T> {
	return { status: "pending", startedAt: null, finishedAt: null, result: null, error: null }
}

export const nowIso = () => new Date().toISOString()

/** The outcome a case shows, including the ones that are not dispositions. */
export function outcomeOf(c: PaymentCase): string {
	if (c.stage === "not_a_payment") return "NOT_A_PAYMENT"
	if (c.stage === "error") return "PROCESSING_ERROR"
	if (c.stage === "rejected") return "REJECTED"
	if (c.stage === "approved") return c.review.some((r) => r.action === "approve" && r.outcome === "applied") ? "APPROVED_BY_HUMAN" : "AUTO_APPROVED"
	if (c.stage === "blocked") return "BLOCKED"
	if (c.stage === "awaiting_approval") return "NEEDS_APPROVAL"
	return "PROCESSING"
}
