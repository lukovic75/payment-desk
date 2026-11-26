/**
 * Cross-agent challenge protocol.
 *
 * A challenge is a structured disagreement about financial evidence: one claim, the claim independently observed against
 * it, and the evidence each rests on. Challenges are derived here, by code, from what is already in shared state: the two
 * readings, the Auditor's findings, the trusted records and the controls. No model writes one, and none is ever erased:
 * a challenge keeps both sides and says how it ended. Only a matching record ends one as verified; a reviewer's approval
 * ends it as accepted, which is a different thing.
 */
import type { Challenge, ChallengeClaim, ChallengeStatus, PaymentCase, ProviderBlock, ProviderFailureKind } from "./domain.js"
import { parseMoney } from "./money.js"

const RUNNING = new Set(["received", "extracting", "checking", "investigating", "deciding"])
const CRITICAL = new Set(["gross", "currency", "iban"])
const isAmount = (field: string) => /gross|amount|total|net|tax/i.test(field)

export function deriveChallenges(c: PaymentCase): Challenge[] {
	const out: Omit<Challenge, "status">[] = []
	const x = c.extraction.result
	const flagged = (id: string) => c.controls.find((k) => k.id === id && (k.status === "fail" || k.status === "review"))
	const fromLedger = (ref: string | null | undefined): string => { const e = ref ? c.ledger[ref] : undefined; return e?.doc?.normalized ?? e?.doc?.original ?? "" }

	// 1. The two independent readings differ on a field. The comparison is the firewall's; this gives it a name and two sides.
	for (const e of Object.values(c.ledger)) {
		if (!e.id.startsWith("C:compare:") || !e.calc || e.calc.inputs.length < 2) continue
		const field = e.id.slice("C:compare:".length)
		const [a, b] = e.calc.inputs
		const critical = CRITICAL.has(field)
		out.push({
			id: `CH:reading:${field}`, caseId: c.id, raisedBy: "Auditor", category: "reading_disagreement", field,
			challenged: { by: "Extractor", value: a!.value, ref: a!.ref ?? null },
			observed: { by: "Auditor", value: b!.value, ref: b!.ref ?? null },
			required: critical ? "Neither reading is trusted. Correct the document or run it again." : "A person compares the two lines and says which one is right.",
			sourceSelectable: !critical && a!.ref != null && b!.ref != null,
		})
	}

	// 2. The Auditor found the document stating one value two different ways.
	const pairs: number[][] = []
	for (const [i, k] of (c.audit.result?.conflicts ?? []).entries()) {
		if (k.values.length < 2) continue
		const claim = (n: number): ChallengeClaim => ({ by: "Document", value: k.values[n]!, ref: k.refs[n] ?? null })
		out.push({
			id: `CH:contradiction:${k.field}:${i + 1}`, caseId: c.id, raisedBy: "Auditor", category: "document_contradiction", field: k.field,
			challenged: claim(0), observed: claim(1),
			required: isAmount(k.field) ? "Verify which amount is payable before approving." : `Verify which ${k.field} is correct before approving.`,
			sourceSelectable: k.refs[0] != null && k.refs[1] != null,
		})
		if (isAmount(k.field)) pairs.push(k.values.slice(0, 2).map((v) => parseMoney(v) ?? -1).sort())
	}

	// 3. Code found another payable amount in the document. Skipped when the Auditor already raised the same two amounts.
	const stated = flagged("stated_amounts")
	if (stated && x?.gross != null) {
		const other = stated.refs.map((r) => c.ledger[r]).find((e) => e?.category === "source_document" && e.id !== x.refs.gross && e.doc?.located)
		const otherMinor = other ? parseMoney(fromLedger(other.id)) : null
		const pair = [x.gross, otherMinor ?? -1].sort()
		if (other && !pairs.some((p) => p[0] === pair[0] && p[1] === pair[1])) {
			out.push({
				id: "CH:stated:gross", caseId: c.id, raisedBy: "Firewall", category: "document_contradiction", field: "gross",
				challenged: { by: "Extractor", value: fromLedger(x.refs.gross), ref: x.refs.gross ?? null },
				observed: { by: "Document", value: fromLedger(other.id), ref: other.id },
				required: "Verify which amount is payable before approving.",
				sourceSelectable: x.refs.gross != null,
			})
		}
	}

	// 4. The account on the document is not the account on file. A checksum says nothing about whose account it is.
	const beneficiary = c.controls.find((k) => k.id === "beneficiary" && k.status === "fail")
	if (beneficiary && x?.iban) {
		const master = beneficiary.refs.map((r) => c.ledger[r]).find((e) => e?.category === "vendor_record")
		out.push({
			id: "CH:beneficiary:iban", caseId: c.id, raisedBy: "Validator", category: "trusted_record_mismatch", field: "iban",
			challenged: { by: "Document", value: x.iban, ref: x.refs.iban ?? null },
			observed: { by: "Trusted record", value: master?.record?.fields.iban?.replace(/\s+/g, "") ?? "", ref: master?.id ?? null },
			required: "A callback on a number already on file, recorded against this vendor and this account. No verified account-change evidence exists yet.",
			sourceSelectable: false,
		})
	}

	// 5. The Validator's report contradicts what the desk computed from the same records. The computed value is the one used.
	for (const [i, d] of (c.validation.result?.disagreements ?? []).entries()) {
		out.push({
			id: `CH:report:${i + 1}`, caseId: c.id, raisedBy: "Firewall", category: "report_mismatch", field: "validation",
			challenged: { by: "Validator", value: d, ref: null }, observed: { by: "Computed", value: "the desk's own check of the same records", ref: null },
			required: "None: the computed result is used. Recorded so that the agent's error is visible.",
			sourceSelectable: false,
		})
	}

	const status = (ch: Omit<Challenge, "status">): ChallengeStatus => {
		if (RUNNING.has(c.stage)) return "open"
		// A vendor confirmation on record for this vendor and invoice: it either states the amount this payment would pay
		// (matched to a record, independent of the document) or another one (the payment as read is wrong).
		if (ch.category === "document_contradiction" && isAmount(ch.field)) {
			const conf = c.controls.find((k) => k.id === "amount_confirmation")
			if (conf?.status === "pass" && c.controls.some((k) => k.settledBy && (k.id === "stated_amounts" || k.id === "agent_agreement"))) return "matched_to_record"
			if (conf?.status === "fail") return "confirmed_discrepancy"
		}
		// A person approved over it. That is an accountable decision, not a verification: a cited line shows that a value is
		// in the document, never which of two stated values is owed.
		if (c.resolutions?.[ch.id]) return "accepted_by_reviewer"
		if (c.stage === "rejected") return "unresolved"
		if (ch.category === "trusted_record_mismatch" || ch.category === "report_mismatch" || (ch.category === "reading_disagreement" && CRITICAL.has(ch.field))) return "confirmed_discrepancy"
		return "requires_human_verification"
	}
	const now = out.map((ch) => ({ ...ch, status: status(ch) }))
	// A challenge against the trusted record that no longer derives (a callback record now matches the account) is kept, with
	// how it ended. Every other kind derives from state that stays, so one that is gone was only superseded: the same two
	// amounts are now on record as the Auditor's own finding, and listing them twice would count one disagreement as two.
	for (const old of c.challenges ?? []) {
		if (old.category !== "trusted_record_mismatch" || now.some((n) => n.id === old.id)) continue
		const verified = old.category === "trusted_record_mismatch" && Object.values(c.ledger).some((e) => e.category === "human_verification")
		now.push({ ...old, status: verified ? "matched_to_record" : old.status === "open" ? "unresolved" : old.status })
	}
	return now
}

/** Is this challenge still waiting for a person, as far as an approval is concerned? */
export const awaitsPerson = (ch: Challenge) => ch.status === "requires_human_verification" || ch.status === "open" || ch.status === "unresolved"

// ───────── provider failures: what kind, and whether trying again can help ─────────

type Failure = { kind: ProviderFailureKind; retryable: boolean; accountWide: boolean; advice: string }
const RULES: [RegExp, Failure][] = [
	[/credit balance|insufficient[_ ](credit|quota|funds|balance)|billing|exceeded your current quota|payment required|\b402\b/i, { kind: "insufficient_credit", retryable: false, accountWide: true, advice: "The model provider account has no credit. Add credit, then run the document again." }],
	[/\b401\b|invalid[_ -]?(x-)?api[_ -]?key|authentication[_ ]error|incorrect api key|unauthorized/i, { kind: "invalid_credentials", retryable: false, accountWide: true, advice: "The model API key was refused. Check ANTHROPIC_API_KEY in .env, restart the server, then run the document again." }],
	[/\b403\b|permission[_ ](error|denied)|forbidden|not allowed to/i, { kind: "permission", retryable: false, accountWide: true, advice: "The model API key is not permitted to do this. Check the key's permissions and the model names in .env." }],
	[/model[^.]{0,40}(not found|does not exist|not supported|unsupported|is not available)|not_found_error|\b404\b/i, { kind: "unsupported_model", retryable: false, accountWide: true, advice: "The configured model was not found. Check FAST_MODEL and CAREFUL_MODEL in .env." }],
	[/\b429\b|rate[_ -]?limit|too many requests/i, { kind: "rate_limited", retryable: true, accountWide: false, advice: "The provider is rate limiting. The call was retried once; run the document again in a moment." }],
	[/\b5\d\d\b|overloaded|service unavailable|internal server error|bad gateway/i, { kind: "unavailable", retryable: true, accountWide: false, advice: "The provider is temporarily unavailable. The call was retried once; run the document again in a moment." }],
	[/timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|network|socket hang up/i, { kind: "network", retryable: true, accountWide: false, advice: "The provider could not be reached. The call was retried once; check the connection and run the document again." }],
]
/** Reads a provider's error text. Only rate limits, outages and network failures are worth one more try; an empty account is not. */
export function classifyProviderError(message: string): Failure {
	for (const [re, f] of RULES) if (re.test(message)) return f
	return { kind: "unknown", retryable: false, accountWide: false, advice: "The model call failed. Run the document again; if it repeats, check the server log." }
}
export const providerBlock = (message: string, f: Failure, at: string): ProviderBlock => ({ kind: f.kind, message: message.slice(0, 300), advice: f.advice, at })
