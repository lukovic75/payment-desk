/**
 * The Financial Decision Report of one payment, and the operational summary of the desk.
 *
 * Both are assembled by code from the case state and nothing else: no model writes any part of them, so they cannot
 * say something the financial record does not hold. A value that the case does not have is reported as null, never
 * filled in. The report keeps apart what a document says, what a model observed, what code calculated, what a
 * trusted record states, what the policy enforces, what a person did, and what is still open.
 *
 * This is a consolidation for inspection. It is not a certification, an audit opinion or a signed record, and the
 * document hash it carries identifies the bytes that were read; it says nothing about whether their content is true.
 */
import type { Control, EvidenceEntry, PaymentCase, Policy } from "./domain.js"
import { CRITICAL_FIELDS, outcomeOf } from "./domain.js"
import { formatMinor } from "./money.js"

type Source = { ref: string; kind: "document" | "trusted_record" | "calculation" | "unknown"; label: string; excerpt: string | null; line: number | null; page: number | null; asWritten: string | null; normalized: string | null; quoteContainsValue: boolean | null; record: string | null }

const sourceOf = (ref: string, e: EvidenceEntry | undefined): Source => ({
	ref,
	kind: e?.doc ? "document" : e?.record ? "trusted_record" : e?.calc ? "calculation" : "unknown",
	label: e?.label ?? "not in the evidence ledger",
	excerpt: e?.doc?.excerpt ?? null,
	line: e?.doc?.lineStart ?? null,
	page: e?.doc?.page ?? null,
	asWritten: e?.doc?.original ?? null,
	normalized: e?.doc?.normalized ?? e?.calc?.result ?? null,
	quoteContainsValue: e?.doc?.supportsValue ?? null,
	record: e?.record ? `${e.record.source} ${e.record.recordId}` : null,
})

/** Which kind of answers the recorded loops of a case ran on, from what each loop stored at the time. */
export function executionModeOf(c: PaymentCase): { mode: "scripted" | "local model" | "hosted model" | "mixed" | "no agent loop recorded"; models: Record<string, string> } {
	const models = Object.fromEntries(c.runs.map((r) => [r.agent, r.model]))
	const kinds = new Set(c.runs.map((r) => (r.model === "scripted fixture" ? "scripted" : /this machine/.test(r.model) ? "local model" : "hosted model")))
	return { mode: kinds.size === 0 ? "no agent loop recorded" : kinds.size > 1 ? "mixed" : ([...kinds][0] as "scripted" | "local model" | "hosted model"), models }
}

export function decisionReport(c: PaymentCase, policy: Policy) {
	const x = c.extraction.result
	const src = (ref: string | null | undefined) => (ref ? sourceOf(ref, c.ledger[ref]) : null)
	const outcome = outcomeOf(c)
	const d = c.decision.result
	const notPassed = c.controls.filter((k) => k.status === "fail" || k.status === "review" || k.status === "unknown")
	const blocking = c.controls.filter((k) => k.status === "fail" && k.severity === "block")
	const open = (c.challenges ?? []).filter((k) => !["matched_to_record", "accepted_by_reviewer"].includes(k.status))
	const control = (k: Control) => ({ id: k.id, label: k.label, rule: k.rule, status: k.status, severity: k.severity, detail: k.detail, refs: k.refs, settledBy: k.settledBy ?? null })
	const exec = executionModeOf(c)
	return {
		report: "Financial Decision Report",
		notice: "Sandbox. Synthetic financial data. This is not a payment authorization and not a bank instruction. Nothing here was sent to a bank.",
		scope: "Assembled by code from the case state at the time below. No model wrote any part of this report. It is not a certification or an audit opinion, and it is not signed.",
		generatedAt: new Date().toISOString(),
		case: { id: c.id, version: c.version, processingAttempt: c.attempt, receivedAt: c.receivedAt, origin: c.origin },

		decision: {
			inForce: outcome,
			stage: c.stage,
			amount: c.exposure ? { minor: c.exposure.minor, currency: c.exposure.currency, formatted: formatMinor(c.exposure.minor, c.exposure.currency), source: src(c.exposure.ref) } : null,
			primaryReason: blocking[0]?.detail ?? notPassed[0]?.detail ?? (outcome === "PROCESSING_ERROR" ? c.runs.find((r) => r.error)?.error ?? "processing failed" : outcome === "AUTO_APPROVED" ? "Every control passed and the amount is within the automatic approval limits." : null),
			sandboxDraft: c.draft ? { exists: true, draftId: c.draft.draftId, approvalRef: c.draft.approvalRef } : { exists: false, reason: c.stage === "approved" ? "not created" : `only an approved payment has a draft; this one is ${c.stage.replace(/_/g, " ")}` },
		},

		received: {
			sourceFacts: "What the document is. The hash identifies the content that was read; it does not establish that the content is correct.",
			fileName: c.fileName,
			contentHashSha256: c.hash,
			original: c.pdf ? { format: "pdf", pages: c.pdf.pages, bytes: c.pdf.size, fileHashSha256: c.pdf.fileHash } : { format: "text" },
			invoiceNumber: x?.invoiceNumber ?? null,
			supplier: x?.creditorName ?? null,
			currency: x?.currency ?? null,
		},

		criticalFields: CRITICAL_FIELDS.map((field) => {
			const value = x?.[field] ?? null
			const check = c.integrity?.values.find((v) => v.subject === field || v.ref === x?.refs[field])
			return {
				field,
				value: field === "gross" && typeof value === "number" ? formatMinor(value, x?.currency) : value,
				evidence: src(x?.refs[field]),
				reVerifiedByCode: check ? { referenceResolves: check.present, sourceContainsValue: check.correct } : null,
			}
		}),

		modelObservations: {
			note: "What the agents reported. Advisory: none of this decides the payment.",
			executionMode: exec.mode,
			models: exec.models,
			firstReading: c.extraction.status,
			independentReading: { status: c.audit.status, conflictsReported: (c.audit.result?.conflicts ?? []).map((k) => ({ field: k.field, values: k.values, evidence: k.refs.map((r) => src(r)) })), summary: c.audit.result?.summary ?? null },
			validation: c.validation.result ? { summary: c.validation.result.summary, issues: c.validation.result.issues, differsFromComputed: c.validation.result.disagreements } : null,
			investigation: c.investigation.result ? { assessment: c.investigation.result.assessment, explanation: c.investigation.result.explanation, verifiedFacts: c.investigation.result.verifiedFacts, conflictingEvidence: c.investigation.result.conflictingEvidence, unknowns: c.investigation.result.unknowns, recommendedSteps: c.investigation.result.recommendedSteps } : null,
			recommendation: d?.recommended ? { disposition: d.recommended.disposition, rulesApplied: d.recommended.rulesApplied, explanation: d.recommended.explanation } : null,
			outputChecks: c.outputChecks ?? [],
		},

		deterministicControls: {
			note: "Evaluated by code from the case state and the trusted records. A model cannot change them.",
			policy: policy.name,
			evaluated: c.controls.filter((k) => k.status !== "na").length,
			notPassed: notPassed.map(control),
			passed: c.controls.filter((k) => k.status === "pass").map((k) => ({ id: k.id, label: k.label, rule: k.rule })),
			calculations: Object.values(c.ledger).filter((e) => e.calc).map((e) => ({ ref: e.id, label: e.label, method: e.calc!.method, inputs: e.calc!.inputs, result: e.calc!.result, currency: e.calc!.currency })),
		},

		trustedRecordsNote: "Rows of the sandbox's synthetic fixture files. A match is a match with such a row; nobody was called or contacted, and it does not establish who owns an account in the real world.",
		trustedRecords: Object.values(c.ledger).filter((e) => e.record).map((e) => ({ ref: e.id, label: e.label, source: e.record!.source, recordId: e.record!.recordId, fields: e.record!.fields })),

		enforcement: {
			note: "What is in force is the stricter of the recommendation and what the controls allow.",
			recommended: d?.recommended?.disposition ?? null,
			allowedByControls: d?.floor ?? null,
			inForce: d?.final ?? null,
			recommendationOverridden: d?.overridden ?? null,
		},

		challenges: (c.challenges ?? []).map((k) => ({ id: k.id, raisedBy: k.raisedBy, category: k.category, field: k.field, challenged: { ...k.challenged, evidence: src(k.challenged.ref) }, observed: { ...k.observed, evidence: src(k.observed.ref) }, required: k.required, status: k.status, resolution: c.resolutions?.[k.id] ?? null })),

		humanActions: c.review.map((r) => ({ at: r.at, reviewer: r.reviewer, action: r.action, outcome: r.outcome, from: r.from, to: r.to, reason: r.reason, refs: r.refs })),

		unresolved: {
			openChallenges: open.map((k) => ({ id: k.id, status: k.status, required: k.required })),
			controlsNotEvaluated: c.controls.filter((k) => k.status === "unknown").map((k) => k.id),
			evidenceFindings: c.integrity?.findings ?? [],
			unknownsNamedByTheInvestigator: c.investigation.result?.unknowns ?? [],
			failedLoops: c.runs.filter((r) => r.status === "error" || r.status === "timeout").map((r) => ({ agent: r.agent, error: r.error })),
		},

		execution: {
			loops: c.runs.map((r) => ({ id: r.id ?? null, agent: r.agent, model: r.model, attempt: r.attempt, trigger: r.trigger, startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status, tokens: r.tokens })),
		},
	}
}
export type DecisionReport = ReturnType<typeof decisionReport>

/**
 * What the desk has done, counted from the cases it holds. Every figure names what it counts. Amounts are kept per
 * currency and never added across currencies. "Restricted" is an amount that is held or blocked right now; it is not a
 * loss that was prevented, and nothing here measures time or money saved.
 */
export function operationalSummary(cases: PaymentCase[]) {
	const by = (o: string) => cases.filter((c) => outcomeOf(c) === o)
	const perCurrency = (list: PaymentCase[]) => {
		const sums: Record<string, number> = {}
		for (const c of list) if (c.exposure) sums[c.exposure.currency] = (sums[c.exposure.currency] ?? 0) + c.exposure.minor
		return Object.entries(sums).sort().map(([currency, minor]) => ({ currency, minor, formatted: formatMinor(minor, currency), payments: list.filter((c) => c.exposure?.currency === currency).length }))
	}
	const values = cases.flatMap((c) => c.integrity?.values ?? [])
	const critical = values.filter((v) => v.critical)
	// What cannot be checked mechanically, by what it is: a date or a name has no value a program can compare, a narrative is an agent's sentence.
	const kinds = (list: typeof values) => {
		const out: Record<string, number> = {}
		for (const v of list) {
			const k = /date/i.test(v.subject) ? "dates (the quoted line is there; the date format is not compared)" : /^(Investigator|Validator):/.test(v.subject) ? "agent statements (the cited evidence exists; the sentence is not a value)" : "quoted passages (the text is in the document; it is not a value)"
			out[k] = (out[k] ?? 0) + 1
		}
		return out
	}
	const challenges = cases.flatMap((c) => c.challenges ?? [])
	const settled = challenges.filter((k) => ["matched_to_record", "accepted_by_reviewer"].includes(k.status))
	const controls = cases.flatMap((c) => c.controls).filter((k) => k.status !== "na")
	const obligations = new Set(cases.filter((c) => c.extraction.result?.isPaymentRequest && c.extraction.result.invoiceNumber).map((c) => `${c.extraction.result!.creditorName ?? "?"}|${c.extraction.result!.invoiceNumber}`.toLowerCase()))
	const blocked = by("BLOCKED"), held = by("NEEDS_APPROVAL")
	return {
		definitions: {
			documents: "Documents on the desk, one case each. A document processed again is still one document.",
			obligations: "Distinct supplier and invoice number pairs among the documents read as payment requests. Two documents for the same invoice count once.",
			restricted: "Amounts of payments that are blocked or waiting for a person right now, per currency. Not a prevented loss.",
			evidence: "Values the integrity verifier re-read against their source. 'Verified' means the reference resolves and the source contains the value; what cannot be checked mechanically (dates, agent statements, quoted passages) is counted apart and never counted as verified. Critical values are those a payment decision rests on; they are reported separately.",
		},
		documents: cases.length,
		obligations: obligations.size,
		processingAttempts: cases.reduce((n, c) => n + c.attempt, 0),
		agentLoops: cases.reduce((n, c) => n + c.runs.length, 0),
		outcomes: {
			autoApproved: by("AUTO_APPROVED").length,
			approvedByPerson: by("APPROVED_BY_HUMAN").length,
			waitingForPerson: held.length,
			blocked: blocked.length,
			rejected: by("REJECTED").length,
			processingErrors: by("PROCESSING_ERROR").length,
			notPaymentRequests: by("NOT_A_PAYMENT").length,
			inProgress: by("PROCESSING").length,
		},
		controls: { evaluated: controls.length, passed: controls.filter((k) => k.status === "pass").length, notPassed: controls.filter((k) => k.status !== "pass").length },
		evidence: {
			valuesChecked: values.length, verified: values.filter((v) => v.present && v.correct === true).length, notMechanicallyCheckable: values.filter((v) => v.present && v.correct === null).length, failed: values.filter((v) => !v.present || v.correct === false).length,
			// The values a payment decision rests on (creditor, amount, currency, account, exposure, draft, trusted records and calculations), counted apart:
			// the overall figure must not hide one missing critical value, and a narrative that cannot be checked must not look like one.
			critical: { checked: critical.length, verified: critical.filter((v) => v.present && v.correct === true).length, notMechanicallyCheckable: critical.filter((v) => v.present && v.correct === null).length, failed: critical.filter((v) => !v.present || v.correct === false).length },
			notCheckableByKind: kinds(values.filter((v) => v.present && v.correct === null)),
		},
		challenges: { raised: challenges.length, settled: settled.length, open: challenges.length - settled.length, byAuditor: challenges.filter((k) => k.raisedBy === "Auditor").length, byValidator: challenges.filter((k) => k.raisedBy === "Validator").length, byCode: challenges.filter((k) => k.raisedBy === "Firewall").length },
		// Part of what is blocked is a second copy of an invoice that is already paid or already on the desk. That part is named, so the blocked total is not read as new money at risk.
		restricted: { blocked: perCurrency(blocked), blockedAsDuplicates: perCurrency(blocked.filter((c) => c.controls.some((k) => k.id === "duplicate" && k.status === "fail"))), waitingForPerson: perCurrency(held) },
		approved: perCurrency([...by("AUTO_APPROVED"), ...by("APPROVED_BY_HUMAN")]),
		sandboxDrafts: cases.filter((c) => c.draft).length,
	}
}
export type OperationalSummary = ReturnType<typeof operationalSummary>
