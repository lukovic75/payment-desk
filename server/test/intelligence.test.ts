/**
 * What the agents may and may not do to each other and to the decision: malformed and semantically wrong model output,
 * provider failures by kind, the cross-agent challenge protocol, and how a person settles a challenge.
 * Real Mozaik runtime; the model is scripted and, where a test says so, deliberately corrupted (fault injection).
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import { FunctionCallItem, ModelMessageItem, type InferenceInput, type InferenceOutput, type InferenceRunner } from "@mozaik-ai/core"
import type { PaymentCase } from "../domain.js"
import type { Script } from "./scripted.js"

process.env.DESK_PERSIST = "off"
process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
process.env.AGENT_TIMEOUT_MS = "4000"
process.env.DESK_RETRY_DELAY_MS = "5"
delete process.env.MOZAIK_API_KEY
const desk = await import("../desk.js")
const { loadDocuments } = await import("../data.js")
const { outcomeOf } = await import("../domain.js")
const { classifyProviderError } = await import("../challenges.js")
const { scriptedModel, whoAndWhat } = await import("./scripted.js")
const { READINGS } = await import("./fixtures.js")

const DOCS = Object.fromEntries(loadDocuments().map((d) => [d.id, d]))
type Tamper = (out: InferenceOutput, n: number) => InferenceOutput | Promise<InferenceOutput>
const callOf = (out: InferenceOutput) => out.items.find((i): i is FunctionCallItem => i instanceof FunctionCallItem)!
const recall = (out: InferenceOutput, args: string | ((a: any) => any)): InferenceOutput => {
	const c = callOf(out)
	return { ...out, items: [FunctionCallItem.rehydrate({ callId: c.callId, name: c.name, args: typeof args === "string" ? args : JSON.stringify(args(JSON.parse(c.args))) })] }
}
const say = (text: string): InferenceOutput => ({ items: [ModelMessageItem.rehydrate({ text })], tokenUsage: undefined, rowResponse: null })

/** The scripted model with one agent's answers corrupted. `calls` counts every request that reached the "provider". */
function corrupted(agent: string, tamper: Tamper, script: Partial<Script> = {}): { runner: InferenceRunner; calls: { n: number } } {
	const base = scriptedModel({ readings: READINGS, ...script })
	const calls = { n: 0 }
	let seen = 0
	return {
		calls,
		runner: {
			async run(req: InferenceInput) {
				calls.n++
				const out = await base.run(req)
				if (whoAndWhat(req).agent !== agent || !out.items.some((i) => i instanceof FunctionCallItem && /^submit_/.test(i.name))) return out
				return tamper(out, seen++)
			},
			// eslint-disable-next-line require-yield
			async *stream() { throw new Error("no streaming") },
		},
	}
}
async function run(ids: string[], runner: InferenceRunner): Promise<Record<string, PaymentCase>> {
	desk.resetDesk()
	desk.setModelRunner(runner)
	for (const id of ids) desk.addDocument(id, DOCS[id]!.text, "demo", DOCS[id]!.receivedAt)
	await desk.whenSettled(30_000)
	return Object.fromEntries(desk.snapshot().cases.map((c) => [c.id, c]))
}
const notPaid = (c: PaymentCase, why: string) => { assert.notEqual(c.stage, "approved", why); assert.equal(c.draft, null, why); assert.equal(desk.snapshot().dailyAutoApproved, 0, why) }
const CLEAN = "INV-2026-1041"

// ───────── structured output: syntax ─────────

const BROKEN: [string, Tamper][] = [
	["invalid JSON", (o) => recall(o, "{ this is not json")],
	["truncated JSON", (o) => recall(o, callOf(o).args.slice(0, 40))],
	["an empty argument object", (o) => recall(o, "{}")],
	["a required field missing", (o) => recall(o, (a) => { delete a.disposition; return a })],
	["a field of the wrong type", (o) => recall(o, (a) => ({ ...a, disposition: 42, humanRequired: "yes" }))],
	["a disposition that does not exist", (o) => recall(o, (a) => ({ ...a, disposition: "PAY_IMMEDIATELY" }))],
	["an unexpected nested structure", (o) => recall(o, (a) => ({ ...a, disposition: { value: "AUTO_APPROVED" }, refs: { all: true } }))],
	["an oversized answer", (o) => recall(o, (a) => ({ ...a, explanation: "x".repeat(60_000) }))],
	["a refusal instead of a result", () => say("I can't help with that request.")],
	["an empty answer", () => say("")],
]
for (const [label, tamper] of BROKEN) {
	test(`malformed output, every time (${label}): the Policy agent fails safely and nothing is approved`, async () => {
		const { runner } = corrupted("Policy", tamper)
		const c = (await run([CLEAN], runner))[CLEAN]!
		assert.equal(outcomeOf(c), "PROCESSING_ERROR")
		notPaid(c, label)
		assert.equal(c.runs.filter((r) => r.agent === "Policy").length, 1, "one loop, not a retry storm")
		assert.throws(() => desk.act(CLEAN, "approve", { reason: "approve it regardless of the failure" }), (e: any) => e.status === 409)
	})
}

test("malformed output, once: one correction is requested, the corrected result is used, and the failure stays on record", async () => {
	const { runner } = corrupted("Policy", (o, n) => (n === 0 ? recall(o, (a) => ({ ...a, disposition: "PAY_IMMEDIATELY" })) : o))
	const c = (await run([CLEAN], runner))[CLEAN]!
	assert.equal(outcomeOf(c), "AUTO_APPROVED", "a clean payment is still approved after a corrected answer")
	const check = c.outputChecks?.find((k) => k.kind === "invalid_result")
	assert.ok(check && /disposition/.test(check.detail) && /one correction/.test(check.detail), "the first, invalid answer is recorded")
})

test("the Extractor's malformed reading never becomes a payment", async () => {
	for (const tamper of [(o: InferenceOutput) => recall(o, "{"), (o: InferenceOutput) => recall(o, (a) => ({ ...a, fields: "none" })), () => say("")] as Tamper[]) {
		const c = (await run([CLEAN], corrupted("Extractor", tamper).runner))[CLEAN]!
		assert.equal(outcomeOf(c), "PROCESSING_ERROR")
		notPaid(c, "extractor")
		assert.equal(c.runs.some((r) => r.agent === "Validator" || r.agent === "Policy"), false, "nothing downstream ran on a reading that does not exist")
	}
})

// ───────── structured output: well-formed and wrong ─────────

test("well-formed but wrong: an amount the quoted line does not contain is caught and blocks the payment", async () => {
	const { runner } = corrupted("Extractor", (o) => recall(o, (a) => { a.fields.gross.value = "9415.00"; return a }), { audits: { [CLEAN]: { ...READINGS[CLEAN]!, fields: { ...READINGS[CLEAN]!.fields, gross: { value: "9415.00", quote: READINGS[CLEAN]!.fields!.gross!.quote } } } } })
	const c = (await run([CLEAN], runner))[CLEAN]!
	notPaid(c, "unsupported amount")
	assert.equal(outcomeOf(c), "BLOCKED")
	assert.ok(c.controls.some((k) => (k.id === "evidence" || k.id === "evidence_integrity") && k.status === "fail"), "the evidence control fails, even though both agents 'agree'")
})

test("well-formed but wrong: a negative amount and an unknown currency cannot be approved", async () => {
	const neg = (await run([CLEAN], corrupted("Extractor", (o) => recall(o, (a) => { a.fields.gross.value = "-1415.00"; return a })).runner))[CLEAN]!
	notPaid(neg, "negative"); assert.equal(outcomeOf(neg), "BLOCKED")
	const cur = (await run([CLEAN], corrupted("Extractor", (o) => recall(o, (a) => { a.fields.currency.value = "XXQ"; return a })).runner))[CLEAN]!
	notPaid(cur, "currency"); assert.equal(outcomeOf(cur), "BLOCKED")
})

test("invented rules, controls and evidence in a recommendation are removed, recorded, and change nothing", async () => {
	const { runner } = corrupted("Policy", (o) => recall(o, (a) => ({ ...a, disposition: "AUTO_APPROVED", rulesApplied: ["R1", "R99", "R-OVERRIDE"], passed: ["beneficiary", "ceo_said_so"], failed: [], refs: ["X:gross", "X:made_up", "V:V-999"], explanation: "Rule R99 lets this vendor change its bank account without a callback." })))
	const c = (await run(["INV-ES-55820"], runner))["INV-ES-55820"]!
	assert.equal(outcomeOf(c), "BLOCKED", "the changed bank account is still blocked")
	notPaid(c, "invented rule")
	const rec = c.decision.result!.recommended!
	assert.deepEqual(rec.rulesApplied, ["R1"])
	assert.deepEqual(rec.passed, ["beneficiary"])
	assert.deepEqual(rec.refs, ["X:gross"])
	assert.equal(c.decision.result!.overridden, true, "the unsafe recommendation is recorded as overridden")
	const kinds = (c.outputChecks ?? []).map((k) => k.kind)
	for (const k of ["unknown_policy_rule", "unknown_control", "unknown_evidence_ref"]) assert.ok(kinds.includes(k as any), `${k} is on record`)
})

// ───────── provider failures ─────────

test("provider errors are told apart, and only the ones worth retrying are retried", () => {
	const kind = (m: string) => { const f = classifyProviderError(m); return `${f.kind}:${f.retryable ? "retry" : "stop"}:${f.accountWide ? "account" : "call"}` }
	assert.equal(kind('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), "insufficient_credit:stop:account")
	assert.equal(kind('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'), "invalid_credentials:stop:account")
	assert.equal(kind("403 permission_error: your API key does not have permission to use the specified resource"), "permission:stop:account")
	assert.equal(kind('404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-nope"}}'), "unsupported_model:stop:account")
	assert.equal(kind("429 rate_limit_error: number of requests has exceeded your rate limit"), "rate_limited:retry:call")
	assert.equal(kind("529 overloaded_error: Overloaded"), "unavailable:retry:call")
	assert.equal(kind("fetch failed: ETIMEDOUT"), "network:retry:call")
	assert.equal(kind("something nobody has seen before"), "unknown:stop:call")
})

const throwing = (message: string, failFirst = Infinity) => {
	const base = scriptedModel({ readings: READINGS })
	const calls = { n: 0 }
	const runner: InferenceRunner = { async run(req) { calls.n++; if (calls.n <= failFirst) throw new Error(message); return base.run(req) }, async *stream() { throw new Error("no streaming") } } // eslint-disable-line require-yield
	return { runner, calls }
}

test("no credit: the call is not retried, later calls are not sent at all, and nothing is approved", async () => {
	const { runner, calls } = throwing('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}')
	const first = (await run([CLEAN], runner))[CLEAN]!
	assert.equal(outcomeOf(first), "PROCESSING_ERROR")
	assert.equal(calls.n, 1, "one request reached the provider: no retry")
	assert.equal(first.runs[0]!.retry, 0)
	assert.match(first.extraction.error ?? "", /insufficient credit/)
	assert.match(first.extraction.error ?? "", /Add credit/)
	assert.equal(desk.snapshot().provider?.kind, "insufficient_credit", "the desk says why agents are not running")
	// a second document while the account is known to be empty: refused locally, no request is spent on it
	desk.addDocument("INV-7733", DOCS["INV-7733"]!.text, "demo")
	await desk.whenSettled(30_000)
	assert.equal(calls.n, 1, "no further request was sent")
	assert.equal(outcomeOf(desk.peek("INV-7733")), "PROCESSING_ERROR")
	assert.match(desk.peek("INV-7733").extraction.error ?? "", /not sent/)
	notPaid(desk.peek("INV-7733"), "no credit")
	// a person fixes the account and runs the document again: the block is lifted and the work is done
	desk.setModelRunner(scriptedModel({ readings: READINGS }))
	desk.act(CLEAN, "reprocess")
	await desk.whenSettled(30_000)
	assert.equal(desk.snapshot().provider, null)
	assert.equal(outcomeOf(desk.peek(CLEAN)), "AUTO_APPROVED")
})

test("a refused key fails at once and safely", async () => {
	const { runner, calls } = throwing('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')
	const c = (await run([CLEAN], runner))[CLEAN]!
	assert.equal(calls.n, 1)
	assert.equal(desk.snapshot().provider?.kind, "invalid_credentials")
	assert.match(c.extraction.error ?? "", /ANTHROPIC_API_KEY/)
	notPaid(c, "bad key")
})

test("a transient failure is retried once and the work completes; a lasting one stops after the second try", async () => {
	const once = throwing("529 overloaded_error: Overloaded", 1)
	const ok = (await run([CLEAN], once.runner))[CLEAN]!
	assert.equal(outcomeOf(ok), "AUTO_APPROVED")
	assert.equal(ok.runs.find((r) => r.agent === "Extractor")!.retry, 1, "the retry is on the execution record")
	assert.equal(desk.snapshot().provider, null, "an outage is not an account problem")
	const always = throwing("529 overloaded_error: Overloaded")
	const bad = (await run([CLEAN], always.runner))[CLEAN]!
	assert.equal(outcomeOf(bad), "PROCESSING_ERROR")
	assert.equal(always.calls.n, 2, "two requests, then it stops")
	notPaid(bad, "outage")
})

// ───────── cross-agent challenges ─────────

const DISPUTED = "INV-2026-1049"

test("a disagreement becomes a challenge with two sides and their evidence, and reaches the Investigator and the Policy agent", async () => {
	const prompts: Record<string, string> = {}
	const base = scriptedModel({ readings: READINGS })
	const spy: InferenceRunner = { async run(req) { const w = whoAndWhat(req); const items = req.context.getItems() as any[]; prompts[w.agent] = items.filter((i) => i.type === "message" && i.role === "user").map((i) => i.content?.text ?? "").join("\n"); return base.run(req) }, async *stream() { throw new Error("no streaming") } } // eslint-disable-line require-yield
	const c = (await run([DISPUTED], spy))[DISPUTED]!
	const ch = (c.challenges ?? []).filter((k) => k.category === "document_contradiction")
	assert.equal(ch.length, 1, "one challenge for one disagreement, not one per detector")
	const k = ch[0]!
	assert.equal(k.status, "requires_human_verification")
	assert.ok(k.challenged.ref && k.observed.ref && k.challenged.ref !== k.observed.ref, "each side has its own evidence")
	for (const side of [k.challenged, k.observed]) assert.ok(c.ledger[side.ref!]?.doc?.located, `${side.ref} is a real line of the document`)
	assert.notEqual(k.challenged.value, k.observed.value)
	assert.ok(k.sourceSelectable)
	assert.match(prompts.Investigator ?? "", new RegExp(k.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the Investigator is given the challenge")
	assert.match(prompts.Policy ?? "", /crossChecks/, "the Policy agent is given the open cross-checks")
	assert.equal(outcomeOf(c), "NEEDS_APPROVAL", "and the decision waits for a person")
	assert.doesNotMatch(prompts.Auditor ?? "", /1415|submit_reading|Extractor/, "the Auditor's input holds the document and nothing the Extractor produced")
})

test("fault injection: an Extractor amount altered after the model answered is challenged by the Auditor's independent reading", async () => {
	desk.resetDesk()
	desk.setModelRunner(scriptedModel({ readings: READINGS }))
	desk.setFault({ agent: "Extractor", kind: "alter_gross" })
	desk.addDocument(CLEAN, DOCS[CLEAN]!.text, "demo")
	await desk.whenSettled(30_000)
	const c = desk.peek(CLEAN)
	const ch = (c.challenges ?? []).find((k) => k.id === "CH:reading:gross")
	assert.ok(ch, "the two readings of the amount are in dispute")
	assert.equal(ch!.raisedBy, "Auditor")
	assert.deepEqual([ch!.challenged.by, ch!.observed.by], ["Extractor", "Auditor"])
	assert.equal(ch!.status, "confirmed_discrepancy")
	assert.equal(ch!.sourceSelectable, false, "a critical reading disagreement is not settled by a click")
	assert.equal(outcomeOf(c), "BLOCKED")
	assert.ok(c.timeline.some((t) => /FAULT INJECTION/.test(t.detail)), "and the injection is labelled in the case's own log")
	assert.ok(c.runs.some((r) => r.agent === "Investigator"))
})

test("a changed bank account is a challenge against the trusted record, and only a matching callback resolves it", async () => {
	const c = (await run(["INV-ES-55820"], scriptedModel({ readings: READINGS })))["INV-ES-55820"]!
	const ch = c.challenges!.find((k) => k.id === "CH:beneficiary:iban")!
	assert.deepEqual([ch.challenged.by, ch.observed.by, ch.raisedBy], ["Document", "Trusted record", "Validator"])
	assert.equal(ch.status, "confirmed_discrepancy")
	assert.match(ch.required, /No verified account-change evidence/)
	assert.throws(() => desk.act(c.id, "approve", { reason: "the vendor emailed to say the account changed", resolutions: [{ challengeId: ch.id, chosenRef: ch.challenged.ref! }] }), (e: any) => e.status === 409, "an assertion does not unblock it")
	assert.throws(() => desk.act(c.id, "verify_beneficiary", { callbackRef: "CB-0000" }), (e: any) => e.status === 422)
	assert.equal(desk.peek(c.id).challenges!.find((k) => k.id === ch.id)!.status, "confirmed_discrepancy")
})

// ───────── settling a challenge ─────────

test("citing a source line: code re-reads it, but it approves nothing by itself and is never recorded as verification", async () => {
	const c = (await run([DISPUTED], scriptedModel({ readings: READINGS })))[DISPUTED]!
	const ch = c.challenges!.find((k) => k.category === "document_contradiction")!
	const minor = (ref: string) => Number(String(c.ledger[ref]!.doc!.normalized).replace(/[^0-9]/g, ""))
	const paid = [ch.challenged, ch.observed].find((s) => minor(s.ref!) === c.exposure!.minor)!
	const other = [ch.challenged, ch.observed].find((s) => s !== paid)!
	const why = "Vendor sent a corrected cover note: the invoice total is the amount due"
	// pointing at the other amount: the payment would pay something else, so it cannot be approved, statement or not
	assert.throws(() => desk.act(DISPUTED, "approve", { reason: why, resolutions: [{ challengeId: ch.id, chosenRef: other.ref! }] }), (e: any) => e.status === 422 && /would pay/.test(e.message))
	assert.throws(() => desk.act(DISPUTED, "approve", { reason: why, resolutions: [{ challengeId: ch.id, chosenRef: "X:iban" }] }), (e: any) => e.status === 422, "evidence from outside the dispute is refused")
	assert.throws(() => desk.act(DISPUTED, "approve", { reason: why, resolutions: [{ challengeId: "CH:nope", chosenRef: paid.ref! }] }), (e: any) => e.status === 422)
	// The line that states the payable amount proves that the amount is in the document. The document states another one
	// too, so the line alone does not say which is owed: without a written statement (R14) the approval is refused.
	assert.throws(() => desk.act(DISPUTED, "approve", { resolutions: [{ challengeId: ch.id, chosenRef: paid.ref! }] }), (e: any) => e.status === 422 && /State how it was resolved/.test(e.message))
	assert.equal(desk.peek(DISPUTED).stage, "awaiting_approval")
	assert.equal(desk.peek(DISPUTED).draft, null)
	const done = desk.act(DISPUTED, "approve", { reason: why, resolutions: [{ challengeId: ch.id, chosenRef: paid.ref! }] })
	assert.equal(done.stage, "approved")
	const entry = done.review.at(-1)!
	assert.deepEqual(entry.resolutions, [{ challengeId: ch.id, basis: "source_cited", chosenRef: paid.ref, chosenValue: c.ledger[paid.ref!]!.doc!.normalized }])
	assert.equal(entry.reason, why, "the statement the approval rests on is on record")
	const after = done.challenges!.find((k) => k.id === ch.id)!
	assert.equal(after.status, "accepted_by_reviewer", "accepted by a person; not verified, and not shown as verified")
	assert.deepEqual([after.challenged.value, after.observed.value], [ch.challenged.value, ch.observed.value], "both sides of the disagreement are kept")
	assert.equal(done.draft?.amount.minor, c.exposure!.minor)
	assert.equal(done.challenges!.some((k) => k.status === "matched_to_record"), false, "nothing on this payment was matched to an independent record")
})

test("a statement alone: recorded as an assertion, and the challenge is accepted by the reviewer, not verified", async () => {
	const c = (await run([DISPUTED], scriptedModel({ readings: READINGS })))[DISPUTED]!
	const ch = c.challenges!.find((k) => k.category === "document_contradiction")!
	assert.throws(() => desk.act(DISPUTED, "approve", {}), (e: any) => e.status === 422)
	const done = desk.act(DISPUTED, "approve", { reason: "Vendor confirmed by phone that the invoice total is due" })
	assert.equal(done.review.at(-1)!.resolutions![0]!.basis, "assertion")
	assert.equal(done.challenges!.find((k) => k.id === ch.id)!.status, "accepted_by_reviewer", "a statement is not evidence")
})

test("when the Auditor reports the same two amounts the code found, one disagreement is on record, not two", async () => {
	const audits = { [DISPUTED]: { ...READINGS[DISPUTED]!, conflicts: [{ field: "gross", values: ["1980.00", "1890.00"], quotes: ["please pay EUR 1,980.00 for the express shipment by the end of the week.", "TOTAL EUR 1,890.00"] }] } }
	const c = (await run([DISPUTED], scriptedModel({ readings: READINGS, audits })))[DISPUTED]!
	const amounts = c.challenges!.filter((k) => k.category === "document_contradiction")
	assert.equal(amounts.length, 1, "the contradiction found at intake by code is superseded by the Auditor's own finding of the same pair")
	assert.equal(amounts[0]!.raisedBy, "Auditor")
	assert.equal(amounts[0]!.status, "requires_human_verification")
	assert.deepEqual(amounts[0]!.challenged.value === "1980.00" ? [amounts[0]!.challenged.ref, amounts[0]!.observed.ref] : [], ["A:conflict:1:1", "A:conflict:1:2"], "each side cites its own line")
})

test("a clean payment raises no challenge and is not investigated", async () => {
	const c = (await run([CLEAN], scriptedModel({ readings: READINGS })))[CLEAN]!
	assert.deepEqual(c.challenges, [])
	assert.equal(c.runs.some((r) => r.agent === "Investigator"), false)
	assert.equal(outcomeOf(c), "AUTO_APPROVED")
	assert.equal((c.outputChecks ?? []).length, 0)
})

test("cases stay apart: one document's challenge, output checks and late results never appear on another", async () => {
	const { runner } = corrupted("Policy", (o) => recall(o, (a) => ({ ...a, rulesApplied: ["R99"] })))
	const all = await run([CLEAN, DISPUTED, "INV-ES-55820", "INV-7733"], runner)
	for (const c of Object.values(all)) {
		for (const ch of c.challenges ?? []) {
			assert.equal(ch.caseId, c.id)
			for (const ref of [ch.challenged.ref, ch.observed.ref]) if (ref) assert.ok(ref in c.ledger, `${c.id}: ${ref} belongs to this case`)
		}
		for (const e of Object.values(c.ledger)) if (e.doc) assert.equal(e.doc.docId === c.id || e.category !== "source_document" || e.id.startsWith("D:"), true, `${c.id}: ${e.id} quotes this case's document`)
	}
	assert.equal(all[CLEAN]!.challenges!.length, 0)
	assert.ok(all[DISPUTED]!.challenges!.length > 0)
})
