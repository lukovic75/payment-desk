/**
 * The Financial Decision Report and the operational summary: both are assembled from case state by code, so the tests
 * compare them with that state. Real Mozaik runtime, scripted model.
 */
import assert from "node:assert/strict"
import { test } from "node:test"

process.env.DESK_PERSIST = "off"
process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
process.env.AGENT_TIMEOUT_MS = "4000"
delete process.env.MOZAIK_API_KEY
const desk = await import("../desk.js")
const { loadDocuments } = await import("../data.js")
const { outcomeOf } = await import("../domain.js")
const { scriptedModel } = await import("./scripted.js")
const { READINGS } = await import("./fixtures.js")
const { decisionReport, operationalSummary, executionModeOf } = await import("../report.js")

const DOCS = Object.fromEntries(loadDocuments().map((d) => [d.id, d]))
const CLEAN = "INV-2026-1041", CHANGED = "INV-ES-55820", TWO = "INV-2026-1049", DUP = "INV-7701-rappel"
const conflict = { ...READINGS[TWO]!, conflicts: [{ field: "gross", values: ["1980.00", "1890.00"], quotes: ["please pay EUR 1,980.00 for the express shipment by the end of the week.", "TOTAL EUR 1,890.00"] }] }

desk.resetDesk()
desk.setModelRunner(scriptedModel({ readings: READINGS, audits: { [TWO]: conflict } }))
for (const id of [CLEAN, CHANGED, TWO, DUP]) desk.addDocument(id, DOCS[id]!.text, "demo")
await desk.whenSettled(30_000)
const policy = desk.snapshot().policy
const report = (id: string) => decisionReport(desk.peek(id), policy)

test("the report of an approved payment repeats the case: amount, source line, hash, draft, policy", () => {
	const c = desk.peek(CLEAN), r = report(CLEAN)
	assert.equal(r.decision.inForce, "AUTO_APPROVED")
	assert.equal(r.decision.amount!.minor, c.exposure!.minor)
	assert.equal(r.decision.amount!.minor, 141500)
	assert.equal(r.decision.amount!.currency, "EUR")
	assert.equal(r.decision.amount!.source!.ref, c.exposure!.ref)
	assert.match(r.decision.amount!.source!.excerpt ?? "", /1,415\.00/, "the cited line holds the amount")
	assert.equal(r.received.contentHashSha256, c.hash)
	assert.equal(r.received.invoiceNumber, "INV-2026-1041")
	assert.equal(r.decision.sandboxDraft.exists, true)
	assert.equal(r.deterministicControls.policy, policy.name)
	assert.equal(r.deterministicControls.notPassed.length, 0)
	assert.equal(r.humanActions.length, c.review.length)
	assert.match(r.notice, /Sandbox/)
	assert.match(r.scope, /No model wrote/)
})

test("every critical field carries its evidence and what code found when it read the source again", () => {
	const c = desk.peek(CLEAN), r = report(CLEAN)
	assert.deepEqual(r.criticalFields.map((f) => f.field), ["creditorName", "gross", "currency", "iban"])
	for (const f of r.criticalFields) {
		assert.ok(f.value != null, `${f.field} has a value`)
		assert.equal(f.evidence!.ref, c.extraction.result!.refs[f.field as "gross"])
		assert.equal(f.evidence!.kind, "document")
		assert.ok(f.evidence!.line != null, `${f.field} has a line number`)
	}
	const gross = r.criticalFields.find((f) => f.field === "gross")!
	assert.equal(gross.value, "1,415.00 EUR")
	assert.deepEqual(gross.reVerifiedByCode, { referenceResolves: true, sourceContainsValue: true })
})

test("a blocked payment: recommendation and enforcement are kept apart, no draft, and the reason is the failing control", () => {
	const c = desk.peek(CHANGED), r = report(CHANGED)
	assert.equal(r.decision.inForce, "BLOCKED")
	assert.equal(r.enforcement.recommended, "AUTO_APPROVED", "the scripted Policy agent recommends approval")
	assert.equal(r.enforcement.inForce, "BLOCKED")
	assert.equal(r.enforcement.recommendationOverridden, true)
	assert.equal(r.decision.sandboxDraft.exists, false)
	const failing = c.controls.filter((k) => k.status === "fail" && k.severity === "block")
	assert.equal(r.decision.primaryReason, failing[0]!.detail)
	assert.ok(r.deterministicControls.notPassed.some((k) => k.id === "beneficiary"))
	assert.ok(r.trustedRecords.length > 0, "the vendor master record it was compared with is listed")
	assert.match(r.trustedRecordsNote, /synthetic fixture/, "and the report says what a trusted record is here")
	assert.equal(r.challenges.length, (c.challenges ?? []).length)
})

test("an open contradiction is listed as unresolved, with both sides and their sources", () => {
	const r = report(TWO)
	assert.equal(r.decision.inForce, "NEEDS_APPROVAL")
	assert.ok(r.unresolved.openChallenges.length > 0)
	const ch = r.challenges.find((k) => k.category === "document_contradiction")!
	assert.ok(ch.challenged.evidence && ch.observed.evidence, "each side opens its source")
	assert.equal(r.modelObservations.independentReading.conflictsReported.length, 1)
	assert.equal(r.modelObservations.executionMode, "scripted")
})

test("what the case does not have is null, not invented", () => {
	desk.addDocument("MSG-newsletter", DOCS["MSG-newsletter"]!.text, "demo")
	return desk.whenSettled(30_000).then(() => {
		const r = report("MSG-newsletter")
		assert.equal(r.decision.amount, null)
		assert.equal(r.received.invoiceNumber, null)
		assert.equal(r.enforcement.recommended, null)
		assert.equal(r.decision.sandboxDraft.exists, false)
	})
})

test("the execution mode comes from what each loop stored", () => {
	const c = structuredClone(desk.peek(CLEAN))
	assert.equal(executionModeOf(c).mode, "scripted")
	c.runs.forEach((r) => { r.model = "gemma2:9b · Ollama, this machine" })
	assert.equal(executionModeOf(c).mode, "local model")
	c.runs[0]!.model = "claude-haiku-4-5"
	assert.equal(executionModeOf(c).mode, "mixed")
	c.runs = []
	assert.equal(executionModeOf(c).mode, "no agent loop recorded")
})

test("the operational summary is counted from the cases and its parts add up", () => {
	const cases = desk.snapshot().cases
	const s = operationalSummary(cases)
	assert.equal(s.documents, cases.length)
	assert.equal(Object.values(s.outcomes).reduce((a, b) => a + b, 0), cases.length, "every document is in exactly one outcome")
	assert.equal(s.outcomes.autoApproved, cases.filter((c) => outcomeOf(c) === "AUTO_APPROVED").length)
	assert.equal(s.outcomes.blocked, 2, "the changed account and the duplicate")
	assert.equal(s.outcomes.notPaymentRequests, 1)
	assert.equal(s.controls.passed + s.controls.notPassed, s.controls.evaluated)
	assert.equal(s.evidence.verified + s.evidence.notMechanicallyCheckable + s.evidence.failed, s.evidence.valuesChecked)
	const critical = cases.flatMap((c) => c.integrity?.values ?? []).filter((v) => v.critical)
	assert.equal(s.evidence.critical.checked, critical.length, "critical values are counted from the integrity reports")
	assert.ok(critical.length > 0)
	assert.equal(s.evidence.critical.verified, critical.length, "every value a decision rests on is verified at its source")
	assert.equal(s.evidence.critical.notMechanicallyCheckable, 0, "no decision rests on a value a program cannot check")
	assert.equal(Object.values(s.evidence.notCheckableByKind).reduce((a, b) => a + b, 0), s.evidence.notMechanicallyCheckable, "what cannot be checked is listed by kind and adds up")
	assert.equal(s.challenges.settled + s.challenges.open, s.challenges.raised)
	assert.equal(s.challenges.byAuditor + s.challenges.byValidator + s.challenges.byCode, s.challenges.raised)
	assert.deepEqual(s.restricted.blocked.map((m) => [m.currency, m.minor, m.payments]), [["EUR", 274400 + 112000, 2]])
	assert.deepEqual(s.restricted.blockedAsDuplicates.map((m) => [m.currency, m.minor, m.payments]), [["EUR", 112000, 1]], "the duplicate's amount is named apart: it is an invoice already paid, not new money at risk")
	assert.equal(s.sandboxDrafts, cases.filter((c) => c.draft).length)
	assert.equal(s.agentLoops, cases.reduce((n, c) => n + c.runs.length, 0))
})

test("amounts in different currencies are never added together, and a reprocessed or repeated invoice is not a new obligation", () => {
	const cases = structuredClone(desk.snapshot().cases)
	const dup = cases.find((c) => c.id === DUP)!
	dup.exposure!.currency = "USD"
	const again = structuredClone(cases.find((c) => c.id === CLEAN)!)
	again.id = "INV-2026-1041-copy"
	again.attempt = 2
	const s = operationalSummary([...cases, again])
	assert.deepEqual(s.restricted.blocked.map((m) => [m.currency, m.minor]), [["EUR", 274400], ["USD", 112000]])
	assert.equal(s.documents, cases.length + 1)
	assert.equal(s.obligations, operationalSummary(cases).obligations, "the same supplier and invoice number counts once")
	assert.equal(s.processingAttempts, operationalSummary(cases).processingAttempts + 2)
})

test("an empty desk reports nothing done", () => {
	const s = operationalSummary([])
	assert.equal(s.documents, 0)
	assert.deepEqual(s.restricted, { blocked: [], blockedAsDuplicates: [], waitingForPerson: [] })
	assert.equal(s.evidence.valuesChecked, 0)
	assert.deepEqual(s.evidence.critical, { checked: 0, verified: 0, notMechanicallyCheckable: 0, failed: 0 })
})
