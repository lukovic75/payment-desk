/** Domain types shared by the agents, the HTTP API and the web UI. */

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

export type Policy = {
	name: string
	currency: string
	autoApproveLimit: number
	dailyAutoApproveBudget: number
	requireHumanWhen: string[]
	rejectWhen: string[]
	debtor: { name: string; iban: string; bic: string }
}

export type SourceDocument = {
	id: string
	fileName: string
	text: string
	receivedAt: string
}

/** A quote lifted verbatim from the document: the source of a number. */
export type Evidence = {
	field: string
	quote: string
	/** 1-based line number in the document where the quote appears, or null if the agent could not locate it. */
	line: number | null
}

export type Extraction = {
	isPaymentRequest: boolean
	documentKind: string
	invoiceNumber: string | null
	creditorName: string | null
	amount: number | null
	currency: string | null
	iban: string | null
	bic: string | null
	dueDate: string | null
	reference: string | null
	evidence: Evidence[]
	note: string
}

export type Issue = {
	code:
		| "vendor_unknown"
		| "iban_invalid"
		| "iban_differs_from_master"
		| "bic_differs_from_master"
		| "possible_duplicate"
		| "currency_mismatch"
		| "missing_field"
	severity: "block" | "review" | "info"
	message: string
	source: string
}

export type Validation = {
	vendorId: string | null
	vendorName: string | null
	ibanValid: boolean | null
	ibanMatchesMaster: boolean | null
	duplicateOf: string | null
	issues: Issue[]
	summary: string
}

export type Discrepancy = { field: string; extracted: string; inDocument: string }

export type Audit = {
	ok: boolean
	discrepancies: Discrepancy[]
	summary: string
}

export type Route = "auto" | "human" | "reject"

export type Decision = {
	route: Route
	reasons: string[]
	summary: string
	/** Set when the deterministic policy guard overrode the agent's proposed route. */
	overriddenFrom: Route | null
}

export type Approval = {
	by: "policy" | "human"
	decision: "approved" | "rejected"
	note: string | null
	at: string
}

export type SepaDraft = {
	messageId: string
	endToEndId: string
	xml: string
	createdAt: string
}

export type Stage =
	| "received"
	| "extracting"
	| "checking"
	| "deciding"
	| "awaiting_approval"
	| "approved"
	| "rejected"
	| "not_a_payment"
	| "error"

export type TimelineEntry = {
	at: string
	agent: string
	kind: "loop.started" | "inference" | "tool" | "answer" | "error" | "info"
	detail: string
}

export type StepStatus<T> = { status: "pending" | "running" | "done" | "error"; startedAt: string | null; finishedAt: string | null; result: T | null; error: string | null }

export type PaymentCase = {
	id: string
	fileName: string
	receivedAt: string
	stage: Stage
	extraction: StepStatus<Extraction>
	validation: StepStatus<Validation>
	audit: StepStatus<Audit>
	decision: StepStatus<Decision>
	approval: Approval | null
	sepa: SepaDraft | null
	timeline: TimelineEntry[]
}

export type AgentInfo = { id: string; name: string; role: string; model: string }

export type DeskSnapshot = {
	startedAt: string | null
	agents: AgentInfo[]
	policy: Policy
	vendors: Vendor[]
	cases: PaymentCase[]
	dailyAutoApproved: number
	cloudEnabled: boolean
	models: { fast: string; careful: string }
}

export function emptyStep<T>(): StepStatus<T> {
	return { status: "pending", startedAt: null, finishedAt: null, result: null, error: null }
}

export const nowIso = () => new Date().toISOString()
