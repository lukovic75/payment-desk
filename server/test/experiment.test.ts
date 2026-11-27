/**
 * The controlled architecture fault-injection test (server/lab/experiment.ts), run on the real Mozaik runtime.
 * The expectations below were written down after the first run and are kept as a regression: if a control or the
 * challenge protocol changes what catches an injected error, this fails and the published table has to change with it.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.DESK_PERSIST = "off"
process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
process.env.AGENT_TIMEOUT_MS = "4000"
delete process.env.MOZAIK_API_KEY
const { runExperiment, EXPERIMENT_CASES } = await import("../lab/experiment.js")

const result = await runExperiment()
const row = (id: string) => result.rows.find((r) => r.id === id)!

test("every case ends as declared, and the only wrong amount the five-agent workflow lets through is the one declared as a limit", () => {
	assert.equal(result.rows.length, EXPERIMENT_CASES.length)
	for (const r of result.rows) {
		assert.ok(r.expectMulti.includes(r.multi.outcome), `${r.id}: five agents ended ${r.multi.outcome}, declared ${r.expectMulti.join(" or ")}`)
		assert.equal(r.multi.wrongAmountApproved, r.knownLimit === true, `${r.id}: a wrong amount approved only where that is the declared limit`)
		assert.equal(r.pass, true, r.id)
		if (r.multi.outcome !== "AUTO_APPROVED") assert.equal(r.multi.draft, false, `${r.id}: no sandbox draft for a payment that was not approved`)
	}
	assert.deepEqual(result.rows.filter((r) => r.knownLimit).map((r) => r.id), ["F9"])
})

test("the control case is approved in both configurations: the test does not simply stop everything", () => {
	const r = row("F0")
	assert.deepEqual([r.single.outcome, r.multi.outcome], ["AUTO_APPROVED", "AUTO_APPROVED"])
	assert.equal(r.caughtBy, "nothing to catch")
	assert.equal(r.multi.challenges.length, 0)
})

test("a line item reported as the total is held by code when the document labels its total: the quote is right, the field is wrong", () => {
	const r = row("F2")
	assert.equal(r.single.outcome, "NEEDS_APPROVAL", "with one agent too: the document's own total line states another amount")
	assert.ok(r.single.controls.some((c) => c.id === "stated_amounts"), "the control that reads the labelled total line")
	assert.equal(r.single.wrongAmountApproved, false)
	assert.equal(r.multi.outcome, "BLOCKED", "and with five the two readings also differ")
	assert.ok(r.multi.challenges.some((c) => c.id === "CH:reading:gross" && c.raisedBy === "Auditor"))
	assert.equal(r.caughtBy, "code controls, in both configurations")
})

test("the same error where the total is labelled in words code does not know passes every control with one agent and is stopped only by the independent second reading", () => {
	const r = row("F7")
	assert.equal(r.single.outcome, "AUTO_APPROVED", "the baseline has nothing to compare the first reading with")
	assert.equal(r.single.wrongAmountApproved, true)
	assert.equal(r.single.amount, "1,230.00 EUR")
	assert.deepEqual(r.single.controls, [], "no control failed for the baseline: the wrong value is internally consistent and its quote contains it")
	assert.equal(r.multi.outcome, "BLOCKED")
	const ch = r.multi.challenges.find((c) => c.id === "CH:reading:gross")
	assert.ok(ch, "the two readings of the amount are in dispute")
	assert.equal(ch!.raisedBy, "Auditor")
	assert.deepEqual([ch!.challenged.by, ch!.observed.by], ["Extractor", "Auditor"])
	assert.ok(r.multi.controls.some((c) => c.id === "agent_agreement"), "the agreement control is what holds it")
	assert.equal(r.multi.investigator, true)
	assert.equal(r.caughtBy, "only the independent second reading")
})

test("when both readers make the same mistake, a labelled total still holds the payment; with no known label nothing does, and the result says so", () => {
	const labelled = row("F8")
	assert.deepEqual([labelled.single.outcome, labelled.multi.outcome], ["NEEDS_APPROVAL", "NEEDS_APPROVAL"])
	assert.equal(labelled.multi.challenges.some((c) => c.raisedBy === "Auditor"), false, "the second reading raised nothing: it made the same mistake")
	assert.ok(labelled.multi.controls.some((c) => c.id === "stated_amounts"))
	assert.equal(labelled.caughtBy, "code controls, in both configurations")
	const limit = row("F9")
	assert.deepEqual([limit.single.outcome, limit.multi.outcome], ["AUTO_APPROVED", "AUTO_APPROVED"], "the declared limit: two agreeing readings, a correct quote, consistent arithmetic, no known label")
	assert.equal(limit.multi.wrongAmountApproved, true)
	assert.equal(limit.caughtBy, "not caught")
	assert.equal(limit.knownLimit, true)
	assert.match(limit.detail, /Declared in advance as a limit/)
})

test("errors that code controls stop on their own are reported as such, not credited to the agents", () => {
	for (const id of ["F1", "F2", "F3", "F4", "F5", "F6", "F8"]) {
		const r = row(id)
		assert.notEqual(r.single.outcome, "AUTO_APPROVED", `${id}: stopped with one agent`)
		assert.notEqual(r.multi.outcome, "AUTO_APPROVED", `${id}: stopped with five agents`)
		assert.equal(r.caughtBy, "code controls, in both configurations", id)
		assert.ok(r.single.controls.length > 0, `${id}: a control is named`)
	}
	assert.ok(row("F4").multi.controls.some((c) => c.id === "beneficiary"), "the beneficiary control compares the IBAN with the vendor master itself")
	assert.ok(row("F5").multi.controls.some((c) => c.id === "duplicate"), "the duplicate control reads the payment history itself")
	assert.ok(row("F3").multi.controls.some((c) => c.id === "stated_amounts"), "the second stated amount is found in code")
	assert.ok(row("F3").multi.auditorConflicts > 0, "and reported by the Auditor independently")
})

test("a recommendation to approve never loosens the decision in force", () => {
	for (const r of result.rows.filter((x) => x.agent !== "none" && !x.knownLimit)) {
		if (r.multi.recommended === "AUTO_APPROVED") assert.notEqual(r.multi.outcome, "AUTO_APPROVED", `${r.id}: the recommendation was to approve and the decision is stricter`)
	}
	assert.equal(row("F6").multi.outcome, "BLOCKED")
})

test("the summary is counted from the rows", () => {
	const injected = result.rows.filter((r) => r.agent !== "none")
	assert.equal(result.summary.injected, injected.length)
	assert.equal(result.summary.caughtByCodeInBoth + result.summary.caughtOnlyBySecondReading + result.summary.notCaught, injected.length)
	assert.deepEqual([result.summary.caughtByCodeInBoth, result.summary.caughtOnlyBySecondReading, result.summary.notCaught], [7, 1, 1])
	assert.deepEqual([result.summary.baselineWrongApprovals, result.summary.multiWrongApprovals], [2, 1])
	assert.match(result.label, /fault-injection test/i)
})
