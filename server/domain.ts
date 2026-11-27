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
/**
 * A vendor's own statement of the amount payable for one invoice, held by the desk as a trusted record. It is independent
 * of the invoice document, which is what lets it settle a document that states two amounts. Only a "verified" record
 * counts. In this sandbox the records are synthetic fixtures (server/data/confirmations.json); the desk matches a
 * record, it does not contact the vendor.
 */
export type AmountConfirmation = { ref: string; vendorId: string; invoiceNumber: string; payableAmount: Minor; currency: string; status: "verified" | "unverified"; confirmedAt: string; method: string; confirmedBy: string; version: number }

/**
 * Where the text of a document comes from when it was not text to begin with. For a PDF: the original file's identity,
 * its pages, and for every line of the extracted text the page it is on and, where the parser could establish it, the
 * box it occupies on that page (in page units at scale 1, origin top-left). `box: null` means the page is known and the
 * exact position is not; nothing is ever estimated.
 */
export type SourceLine = { page: number; line: number; box: [number, number, number, number] | null }
export type DocumentSource = {
	format: "pdf"
	fileName: string
	mime: "application/pdf"
	size: number
	/** SHA-256 of the original file. Two files with this hash are the same file whatever they are called. */
	fileHash: string
	pages: { n: number; w: number; h: number; rotate: number }[]
	/** One entry per line of the document text, in order: line n of the text is lines[n - 1]. */
	lines: SourceLine[]
	warnings: string[]
	parser: string
}
/** `hash` is over the normalised text, as it always was; `source` is present only for a document that arrived as a PDF. */
export type SourceDocument = { id: string; fileName: string; text: string; hash: string; receivedAt: string; source?: DocumentSource }

// ───────── evidence ledger ─────────

export type EvidenceCategory = "source_document" | "vendor_record" | "historical_payment" | "policy" | "calculation" | "human_verification" | "vendor_confirmation"

export type EvidenceEntry = {
	id: string
	category: EvidenceCategory
	label: string
	/** Who put it in the ledger. */
	by: string
	doc?: {
		docId: string
		field: string
		/** For a PDF: the page the cited line is on and its line number on that page. Set by code from the source map. */
		page?: number
		pageLine?: number
		/** 1-based line range in the document text; null when the quote could not be located. */
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
	/** Set on a review-level discrepancy that an independent trusted record has settled: the evidence id of that record. */
	settledBy?: string
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
	action: "approve" | "reject" | "request_verification" | "verify_beneficiary" | "verify_amount" | "reprocess" | "withdraw_auto_approval"
	reason: string | null
	from: string
	to: string
	outcome: "applied" | "refused"
	refs: string[]
	/** For an approval over a cross-check: what each acceptance rests on. Never upgraded to verification. */
	resolutions?: Resolution[]
}

/**
 * A cross-agent challenge: a structured, inspectable disagreement about financial evidence. It is derived by code from
 * what the agents and the records say, never written by a model, and it is kept even after it is settled.
 */
/**
 * "matched_to_record": a record held by the desk (a callback against the vendor and the exact account) matches. The desk
 * matches the record; it does not place the call. "accepted_by_reviewer": a person approved the payment on a written
 * statement, with or without citing a line. That is accountability, not verification: the disagreement itself stands.
 */
export type ChallengeStatus = "open" | "confirmed_discrepancy" | "requires_human_verification" | "matched_to_record" | "accepted_by_reviewer" | "unresolved"
export type ChallengeCategory = "reading_disagreement" | "document_contradiction" | "trusted_record_mismatch" | "report_mismatch"
export type ChallengeClaim = { by: "Extractor" | "Auditor" | "Validator" | "Document" | "Trusted record" | "Computed"; value: string; ref: string | null }
export type Challenge = {
	id: string
	caseId: string
	/** Who raised it: the agent whose independent finding differs, or the comparison in code. */
	raisedBy: "Auditor" | "Validator" | "Firewall"
	category: ChallengeCategory
	field: string
	/** The claim that is challenged, and what was independently observed against it. Each carries its own evidence. */
	challenged: ChallengeClaim
	observed: ChallengeClaim
	required: string
	status: ChallengeStatus
	/** True when the two sides are both lines of the document, so a reviewer can settle it by pointing at one of them. */
	sourceSelectable: boolean
}
/**
 * What a reviewer's acceptance of a challenge rests on. Both need a written statement.
 * "source_cited": the reviewer also pointed at a line of the document; code re-read it and it states the amount that will
 * be paid. That shows the value is in the document, not that it is the amount owed when the document states another too.
 * "assertion": the statement alone.
 */
export type Resolution = { challengeId: string; basis: "source_cited" | "assertion"; chosenRef: string | null; chosenValue: string | null }

/** Something in a model's well-formed output that code found to be wrong and removed or refused. Kept for the audit trail. */
export type OutputCheck = { at: string; agent: AgentName; kind: "unknown_evidence_ref" | "unknown_policy_rule" | "unknown_control" | "invalid_result" | "not_a_conflict"; detail: string }

/** Why the model provider is refusing calls, when the refusal concerns the whole account and retrying cannot help. */
export type ProviderFailureKind = "insufficient_credit" | "invalid_credentials" | "permission" | "unsupported_model" | "rate_limited" | "unavailable" | "network" | "unknown"
export type ProviderBlock = { kind: ProviderFailureKind; message: string; advice: string; at: string }

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

export type AgentName = "Extractor" | "Validator" | "Auditor" | "Investigator" | "Policy" | "Solo"
/** "single" is the benchmark baseline: one agent (Solo) does the reading, the checking and the recommendation. Never used for the payment inbox. */
export type Configuration = "multi" | "single"

/** One agent loop on one case: the observability record behind the timeline. */
export type AgentRun = {
	/** Execution id: unique per loop, stable for the life of the record. */
	id?: string
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
	/** Present when the document arrived as a PDF: enough to show what it is without fetching the source map. */
	pdf?: { pages: number; size: number; fileHash: string }
	hash: string
	receivedAt: string
	/** Bumped on every write, so a reader can tell two snapshots apart. */
	version: number
	/** Bumped on reprocess; writes from an older attempt are discarded. */
	attempt: number
	challenges?: Challenge[]
	/** Settlements by a person, by challenge id. A challenge keeps its history: the disagreement is never erased. */
	resolutions?: Record<string, Resolution & { at: string; reviewer: string }>
	outputChecks?: OutputCheck[]
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
	/** Absent means "multi". */
	mode?: Configuration
	/** Independent re-verification of the evidence behind every reported value. Recomputed with the controls. */
	integrity?: IntegrityReport
}

// ───────── evidence integrity ─────────

export type IntegrityKind = "missing_evidence" | "broken_reference" | "unsupported_claim" | "incorrect_normalization" | "untraceable_calculation"
export type IntegrityFinding = { kind: IntegrityKind; subject: string; ref: string | null; detail: string; critical: boolean }
/** One checked value. `present`: a reference exists and resolves. `correct`: the referenced source really supports the value; null when that cannot be checked mechanically. */
export type IntegrityValue = { subject: string; ref: string | null; critical: boolean; present: boolean; correct: boolean | null }
/** Fault injection for the Stress Lab and the tests. Always labelled in the case timeline; never model behaviour. */
export type Fault = { agent: AgentName; kind: "provider_error" | "alter_gross" }
/** Totals over one or more integrity reports. "checkable" leaves out values whose correctness cannot be checked mechanically. */
export type IntegrityCounts = { values: number; present: number; checkable: number; correct: number; critical: number; criticalCorrect: number; findings: number; criticalFindings: number }
export type IntegrityReport = {
	values: IntegrityValue[]
	findings: IntegrityFinding[]
	/** False when a critical value has missing, broken or unsupporting evidence. Such a payment is never approved automatically. */
	ok: boolean
}

export type AgentInfo = { id: string; name: AgentName; role: string; model: string }

export type Scenario = { docId: string; title: string; expect: string[]; controls: string[]; why: string }

// ───────── interactive showcase: a guided run of a few synthetic scenarios through the real workflow ─────────

export type ShowcaseKey = "legitimate" | "beneficiary" | "challenge" | "duplicate" | "injection"
/**
 * "confirmed": the enforced outcome is the one the scenario file expects. "unexpected": it settled on something else.
 * "failed": the workflow did not finish. Derived from the case; never set by hand.
 */
export type ShowcaseResult = "not_run" | "running" | "confirmed" | "unexpected" | "failed"
export type ShowcaseStep = { key: ShowcaseKey; docId: string; optional: boolean; expected: string[]; startedAt: string | null; result: ShowcaseResult; actual: string | null; /** The file this step runs on, as it is named on the desk. Absent in recordings made before it was recorded. */ fileName?: string }
export type Showcase = { id: string; startedAt: string; mode: "live" | "scripted"; steps: ShowcaseStep[] }
/** A stored execution of an earlier run with live models. Read-only: replaying it calls no model and decides nothing. */
export type Recording = { recordedAt: string; note: string; models: { fast: string; careful: string }; steps: ShowcaseStep[]; cases: PaymentCase[]; /** Which stored run this is: "earlier" (26 November, hosted models, older code) or "current" (this version of the code). */ id?: "earlier" | "previous" | "current"; /** One line on what ran it and on which code, shown beside the date. */ version?: string }

export type DeskSnapshot = {
	startedAt: string | null
	agents: AgentInfo[]
	policy: Policy
	vendors: Vendor[]
	history: HistoricalPayment[]
	cases: PaymentCase[]
	scenarios: Scenario[]
	dailyAutoApproved: Minor
	/** Set while the provider refuses every call for a reason retrying cannot fix. Null when calls are going through. */
	provider: ProviderBlock | null
	cloudEnabled: boolean
	models: { fast: string; careful: string }
	inboxWaiting: number
	reviewer: string
	persisted: boolean
	/** "scripted" only when the server was started with the test fixture model (npm run dev:scripted). */
	modelMode: "live" | "scripted"
	/** Where the agents' answers come from: predefined text, a cloud provider, or a model running on this machine. */
	inference: import("./local.js").Inference
	/** The guided demo, when one has been started. Its scenario documents are ordinary demo cases on this desk. */
	showcase: Showcase | null
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
