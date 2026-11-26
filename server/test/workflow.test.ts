/**
 * Integration tests of the whole workflow on the real Mozaik runtime with a SCRIPTED model.
 *
 * Real: the runtime, the five agents' loops, the bound tools, the semantic events, the firewall, enforcement, human actions.
 * Scripted: what the model "says" (see scripted.ts). In most tests the scripted Policy agent recommends AUTO_APPROVED for
 * everything, the worst case, so a pass means the deterministic layer held on its own.
 * These are not live-model tests. `npm run cli` is the live run.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import type { PaymentCase } from "../domain.js"
import type { Script } from "./scripted.js"

process.env.DESK_PERSIST = "off"
// Scripted runs are not sent to Mozaik Cloud, even on a paired machine.
process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
delete process.env.MOZAIK_API_KEY
const desk = await import("../desk.js")
const { loadDocuments, loadScenarios } = await import("../data.js")
const { outcomeOf } = await import("../domain.js")
const { reportedAmounts } = await import("../firewall.js")
const { scriptedModel } = await import("./scripted.js")
const { READINGS } = await import("./fixtures.js")

const DOCS = Object.fromEntries(loadDocuments().map((d) => [d.id, d]))

async function run(ids: string[], script: Partial<Script> = {}): Promise<Record<string, PaymentCase>> {
	desk.resetDesk()
	desk.setModelRunner(scriptedModel({ readings: READINGS, ...script }))
	for (const id of ids) desk.addDocument(id, DOCS[id]!.text, "demo", DOCS[id]!.receivedAt)
	await desk.whenSettled(20_000)
	return Object.fromEntries(desk.snapshot().cases.map((c) => [c.id, c]))
}
const control = (c: PaymentCase, id: string) => c.controls.find((k) => k.id === id)
const refused = (fn: () => unknown, status: number) => assert.throws(fn, (e: any) => e.status === status)

test("1. a valid invoice is approved automatically and gets a payment draft", async () => {
	const { "INV-2026-1041": c } = await run(["INV-2026-1041"])
	assert.equal(outcomeOf(c!), "AUTO_APPROVED")
	assert.ok(c!.controls.every((k) => k.status === "pass" || k.status === "na"), "every control passes or does not apply")
	assert.equal(c!.draft?.amount.minor, 141500)
	assert.equal(c!.investigation.status, "skipped", "no exception, so the Investigator is not called")
	assert.deepEqual(c!.runs.map((r) => r.agent).sort(), ["Auditor", "Extractor", "Policy", "Validator"])
})

test("the Validator and the Auditor run in parallel after the Extractor", async () => {
	const { "INV-2026-1041": c } = await run(["INV-2026-1041"])
	const by = Object.fromEntries(c!.runs.map((r) => [r.agent, r]))
	assert.ok(by.Validator!.startedAt >= by.Extractor!.startedAt && by.Auditor!.startedAt >= by.Extractor!.startedAt)
	assert.ok(by.Validator!.startedAt < by.Auditor!.finishedAt! && by.Auditor!.startedAt < by.Validator!.finishedAt!, "their recorded intervals overlap")
	assert.ok(by.Policy!.startedAt >= by.Validator!.finishedAt! && by.Policy!.startedAt >= by.Auditor!.finishedAt!, "Policy waits for both")
})

test("2. a changed IBAN cannot be approved, whatever the Policy agent recommends", async () => {
	const { "INV-ES-55820": c } = await run(["INV-ES-55820"], { policy: "AUTO_APPROVED" })
	assert.equal(outcomeOf(c!), "BLOCKED")
	assert.equal(control(c!, "beneficiary")?.status, "fail")
	assert.equal(control(c!, "iban_checksum")?.status, "pass", "the IBAN is structurally valid; that does not make it the vendor's")
	assert.equal(c!.decision.result?.recommended?.disposition, "AUTO_APPROVED")
	assert.equal(c!.decision.result?.overridden, true)
	assert.equal(c!.draft, null)
	assert.equal(c!.investigation.status, "done", "the exception was investigated")
	refused(() => desk.act("INV-ES-55820", "approve", { reason: "looks fine" }), 409)
	assert.equal(desk.peek("INV-ES-55820").review.at(-1)?.outcome, "refused", "the refused attempt is on record")
})

test("a changed IBAN is cleared only by a callback reference that matches the trusted record", async () => {
	const text = DOCS["INV-2026-1041"]!.text.replace("DE89 3704 0044 0532 0130 00", "DE02 1203 0000 0000 2020 51").replaceAll("INV-2026-1041", "INV-2026-1058")
	desk.resetDesk()
	const r = structuredClone(READINGS["INV-2026-1041"]!)
	r.fields!.iban = { value: "DE02120300000000202051", quote: "IBAN: DE02 1203 0000 0000 2020 51" }
	r.fields!.invoiceNumber = { value: "INV-2026-1058", quote: "Invoice number: INV-2026-1058" }
	r.fields!.reference = { value: "INV-2026-1058", quote: "Payment reference: INV-2026-1058" }
	desk.setModelRunner(scriptedModel({ readings: { "INV-2026-1058": r } }))
	desk.addDocument("INV-2026-1058", text)
	await desk.whenSettled(20_000)
	assert.equal(outcomeOf(desk.peek("INV-2026-1058")), "BLOCKED")
	refused(() => desk.act("INV-2026-1058", "verify_beneficiary", { callbackRef: "CB-0000-WRONG" }), 422)
	assert.equal(outcomeOf(desk.peek("INV-2026-1058")), "BLOCKED", "a wrong reference changes nothing")
	const c = desk.act("INV-2026-1058", "verify_beneficiary", { callbackRef: "CB-2026-1125-01" })
	assert.equal(outcomeOf(c), "NEEDS_APPROVAL", "verified, and still a person's decision")
	assert.equal(control(c, "beneficiary")?.status, "review")
	assert.ok(c.ledger["HV:CB-2026-1125-01"], "the verification is in the evidence ledger")
	assert.equal(outcomeOf(desk.act("INV-2026-1058", "approve", { reason: "callback checked" })), "APPROVED_BY_HUMAN")
	assert.equal(desk.snapshot().vendors.find((v) => v.id === "V-001")!.iban, "DE89370400440532013000", "the vendor master is not changed")
})

test("an account number is read from the quoted line, not from what the model retyped", async () => {
	const r = structuredClone(READINGS["INV-AE-991204"]!)
	r.fields!.iban = { value: "AT61190430023457320", quote: "IBAN: AT61 1904 3002 3457 3201" } // the model dropped the last digit
	const { "INV-AE-991204": c } = await run(["INV-AE-991204"], { readings: { "INV-AE-991204": r }, audits: { "INV-AE-991204": READINGS["INV-AE-991204"]! } })
	assert.equal(c!.extraction.result?.iban, "AT611904300234573201", "the value comes from the document text")
	assert.equal(c!.ledger["X:iban"]?.doc?.retypedFrom, "AT61190430023457320", "and the ledger says what the model typed")
	assert.equal(outcomeOf(c!), "AUTO_APPROVED")
})

test("3. an invalid IBAN blocks the payment", async () => {
	desk.resetDesk()
	const r = structuredClone(READINGS["INV-ES-55820"]!)
	r.fields!.iban = { value: "ES9121000418450200051333", quote: "IBAN: ES91 2100 0418 4502 0005 1333" }
	desk.setModelRunner(scriptedModel({ readings: { typo: r } }))
	desk.addDocument("typo", DOCS["INV-ES-55820"]!.text.replace("ES66 2100 0418 4012 3456 7891", "ES91 2100 0418 4502 0005 1333"))
	await desk.whenSettled(20_000)
	assert.equal(control(desk.peek("typo"), "iban_checksum")?.status, "fail")
	assert.equal(outcomeOf(desk.peek("typo")), "BLOCKED")
})

test("4. a duplicate invoice is not authorised twice", async () => {
	const cases = await run(["INV-AE-991204", "REM-AE-991204"])
	assert.equal(outcomeOf(cases["INV-AE-991204"]!), "AUTO_APPROVED", "the original is paid once")
	assert.equal(outcomeOf(cases["REM-AE-991204"]!), "BLOCKED")
	assert.equal(control(cases["REM-AE-991204"]!, "duplicate")?.status, "fail")
	assert.equal(desk.snapshot().dailyAutoApproved, 242254, "the amount is counted once")
})

test("4b. an invoice that was paid last month is blocked from the payment history", async () => {
	const { "INV-7701-rappel": c } = await run(["INV-7701-rappel"])
	assert.equal(outcomeOf(c!), "BLOCKED")
	assert.ok(control(c!, "duplicate")?.refs.includes("H:H-0001"))
	assert.equal(c!.ledger["H:H-0001"]?.category, "historical_payment")
})

test("5. the same document under another file name is stopped at intake, before any agent runs", async () => {
	const calls: Script["calls"] = []
	const cases = await run(["INV-7733", "scan_0042"], { calls })
	assert.equal(outcomeOf(cases["scan_0042"]!), "BLOCKED")
	assert.equal(cases["scan_0042"]!.runs.length, 0)
	assert.ok(!calls.some((k) => k.docId === "scan_0042"))
	assert.equal(cases["scan_0042"]!.exposure?.minor, 674000, "its exposure is the original's amount, by reference")
})

test("6. an arithmetic discrepancy is detected and shown with its inputs", async () => {
	const { "INV-BP-2291": c } = await run(["INV-BP-2291"])
	assert.equal(outcomeOf(c!), "BLOCKED")
	assert.equal(control(c!, "arithmetic")?.status, "fail")
	const calc = c!.ledger["C:arithmetic"]!.calc!
	assert.deepEqual(calc.inputs.map((i) => i.value), ["1,500.00", "300.00", "1,900.00"])
	assert.match(calc.result, /1,800\.00 computed; difference 100\.00/)
	assert.ok(calc.inputs.every((i) => i.ref && c!.ledger[i.ref]), "each input points at a source line")
})

test("7. an unknown vendor needs intervention", async () => {
	const { "INV-PX-3001": c } = await run(["INV-PX-3001"])
	assert.equal(outcomeOf(c!), "BLOCKED")
	assert.equal(control(c!, "vendor_known")?.status, "fail")
	assert.ok(c!.runs.some((r) => r.agent === "Investigator"))
})

test("8. missing evidence prevents automatic approval", async () => {
	const missingIban = await run(["INV-TC-20261124"])
	assert.equal(control(missingIban["INV-TC-20261124"]!, "mandatory_fields")?.status, "fail")
	assert.equal(missingIban["INV-TC-20261124"]!.extraction.result?.iban, null, "the IBAN is not filled in from the vendor master")
	assert.equal(outcomeOf(missingIban["INV-TC-20261124"]!), "BLOCKED")

	const r = structuredClone(READINGS["INV-2026-1041"]!)
	r.fields!.gross = { value: "1415.00", quote: "Total payable 1,415.00 as agreed by phone" }
	const unsourced = await run(["INV-2026-1041"], { readings: { "INV-2026-1041": r } })
	assert.equal(control(unsourced["INV-2026-1041"]!, "evidence")?.status, "fail", "a quote that is not in the document supports nothing")
	assert.equal(outcomeOf(unsourced["INV-2026-1041"]!), "BLOCKED")

	const w = structuredClone(READINGS["INV-2026-1041"]!)
	w.fields!.gross = { value: "1451.00", quote: "TOTAL EUR 1,415.00" }
	const misread = await run(["INV-2026-1041"], { readings: { "INV-2026-1041": w }, audits: { "INV-2026-1041": w } })
	assert.equal(control(misread["INV-2026-1041"]!, "evidence")?.status, "fail", "the quoted line does not contain the reported amount")
})

test("9. the per-payment limit is enforced, and a person can then approve", async () => {
	const { "INV-7733": c } = await run(["INV-7733"])
	assert.equal(outcomeOf(c!), "NEEDS_APPROVAL")
	assert.equal(control(c!, "per_payment_limit")?.status, "review")
	assert.equal(c!.investigation.status, "skipped", "a routine limit is not an investigation")
	const approved = desk.act("INV-7733", "approve", { reason: "within the Q4 lighting budget" })
	assert.equal(outcomeOf(approved), "APPROVED_BY_HUMAN")
	const last = approved.review.at(-1)!
	assert.deepEqual([last.reviewer, last.action, last.from, last.to, last.outcome], ["Demo reviewer", "approve", "awaiting_approval", "approved", "applied"])
	assert.equal(desk.snapshot().dailyAutoApproved, 0, "a human approval does not use the automatic budget")
})

test("10 + 11. the daily budget holds even when decisions land together", async () => {
	desk.resetDesk()
	desk.setPolicy({ dailyAutoApproveBudget: 200000 })
	desk.setModelRunner(scriptedModel({ readings: READINGS }))
	for (const id of ["INV-2026-1041", "INV-TC-20261122"]) desk.addDocument(id, DOCS[id]!.text, "demo", DOCS[id]!.receivedAt)
	await desk.whenSettled(20_000)
	const outcomes = desk.snapshot().cases.map(outcomeOf).sort()
	assert.deepEqual(outcomes, ["AUTO_APPROVED", "NEEDS_APPROVAL"], "1,415.00 + 929.80 exceeds 2,000.00: only one goes through automatically")
	assert.ok(desk.snapshot().dailyAutoApproved <= 200000)
	const held = desk.snapshot().cases.find((c) => outcomeOf(c) === "NEEDS_APPROVAL")!
	assert.equal(control(held, "daily_limit")?.status, "review")
})

test("11b. two approvals of the same payment do not both succeed", async () => {
	await run(["INV-7733"])
	const results = await Promise.allSettled([1, 2].map(async () => desk.act("INV-7733", "approve", { reason: "ok" })))
	assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"])
	assert.equal(desk.peek("INV-7733").review.filter((r) => r.action === "approve" && r.outcome === "applied").length, 1)
})

test("12. text in a document cannot change the policy, even if the agents go along with it", async () => {
	const { "INV-ADR-0101": c } = await run(["INV-ADR-0101"], { policy: "AUTO_APPROVED" })
	assert.equal(control(c!, "instruction_content")?.status, "review")
	assert.equal(outcomeOf(c!), "NEEDS_APPROVAL", "flagged and held for a person, not approved")
	assert.equal(c!.decision.result?.overridden, true)

	// the same injected text on an invoice with a changed bank account: still blocked
	desk.resetDesk()
	const text = DOCS["INV-ADR-0101"]!.text.replace("HR12 1001 0051 8630 0016 0", "DE02 1203 0000 0000 2020 51")
	const r = structuredClone(READINGS["INV-ADR-0101"]!)
	r.fields!.iban = { value: "DE02120300000000202051", quote: "IBAN: DE02 1203 0000 0000 2020 51" }
	desk.setModelRunner(scriptedModel({ readings: { inj: r }, policy: "AUTO_APPROVED" }))
	desk.addDocument("inj", text)
	await desk.whenSettled(20_000)
	assert.equal(outcomeOf(desk.peek("inj")), "BLOCKED")
})

test("13. when the Auditor reads a different amount, the payment is blocked and investigated", async () => {
	const other = structuredClone(READINGS["INV-2026-1041"]!)
	other.fields!.gross = { value: "1230.00", quote: "Freight Hamburg -> Belgrade, 3 pallets 3 410.00 1,230.00" }
	const { "INV-2026-1041": c } = await run(["INV-2026-1041"], { audits: { "INV-2026-1041": other } })
	assert.equal(control(c!, "agent_agreement")?.status, "fail")
	assert.equal(outcomeOf(c!), "BLOCKED")
	assert.ok(c!.runs.some((r) => r.agent === "Investigator"), "the disagreement triggered the Investigator")
	assert.deepEqual(c!.ledger["C:compare:gross"]?.calc?.inputs.map((i) => i.value), ["1,415.00", "1,230.00"])
})

test("13b. a Validator report that contradicts the records is caught and reviewed", async () => {
	const { "INV-ES-55820": c } = await run(["INV-ES-55820"], { validations: { "INV-ES-55820": { ibanMatchesMaster: true } } })
	assert.ok(c!.validation.result!.disagreements.length > 0)
	assert.equal(outcomeOf(c!), "BLOCKED", "the computed check, not the agent's claim, decides")
})

test("14. a failed agent prevents approval and leaves a recoverable state", async () => {
	const { "INV-2026-1041": c } = await run(["INV-2026-1041"], { fail: ["Auditor:INV-2026-1041"] })
	assert.equal(outcomeOf(c!), "PROCESSING_ERROR")
	assert.equal(c!.draft, null)
	assert.equal(c!.extraction.status, "done", "what was already read is kept")
	assert.equal(c!.runs.find((r) => r.agent === "Auditor")?.status, "error")
	refused(() => desk.act("INV-2026-1041", "approve"), 409)

	desk.setModelRunner(scriptedModel({ readings: READINGS }))
	desk.act("INV-2026-1041", "reprocess", { reason: "provider recovered" })
	await desk.whenSettled(20_000)
	assert.equal(outcomeOf(desk.peek("INV-2026-1041")), "AUTO_APPROVED")
	assert.equal(desk.peek("INV-2026-1041").attempt, 2)
})

test("14b. a failing Policy agent does not approve by default", async () => {
	const { "INV-2026-1041": c } = await run(["INV-2026-1041"], { fail: ["Policy:INV-2026-1041"] })
	assert.equal(outcomeOf(c!), "PROCESSING_ERROR")
	assert.equal(c!.draft, null)
})

test("15. reprocessing is idempotent", async () => {
	await run(["INV-2026-1041", "INV-ES-55820"])
	assert.equal(desk.snapshot().dailyAutoApproved, 141500)
	refused(() => desk.act("INV-2026-1041", "reprocess"), 409)
	desk.act("INV-ES-55820", "reprocess", { reason: "second look" })
	await desk.whenSettled(20_000)
	assert.equal(desk.snapshot().cases.length, 2, "no extra case")
	assert.equal(outcomeOf(desk.peek("INV-ES-55820")), "BLOCKED", "same answer")
	assert.equal(desk.snapshot().dailyAutoApproved, 141500, "nothing is counted twice")
	desk.addDocument("resent-copy", DOCS["INV-2026-1041"]!.text)
	await desk.whenSettled(20_000)
	assert.equal(outcomeOf(desk.peek("resent-copy")), "BLOCKED", "sending the approved invoice again does not approve it again")
	assert.equal(desk.snapshot().dailyAutoApproved, 141500)
})

test("16. a blocked payment has no draft to export", async () => {
	await run(["INV-2026-1041", "INV-ES-55820", "INV-7733"])
	assert.equal(desk.exportDraft("INV-2026-1041").sandbox, true)
	refused(() => desk.exportDraft("INV-ES-55820"), 409)
	refused(() => desk.exportDraft("INV-7733"), 409)
})

test("17. every reported amount rests on a ledger entry that can be shown", async () => {
	const cases = await run(Object.keys(DOCS))
	let checked = 0
	for (const c of Object.values(cases)) {
		for (const a of reportedAmounts(c)) {
			assert.ok(a.ref, `${c.id}: ${a.label} has no evidence reference`)
			const e = c.ledger[a.ref!]
			assert.ok(e, `${c.id}: ${a.label} points at ${a.ref}, which is not in the ledger`)
			if (e!.category === "source_document" && e!.doc) assert.ok(e!.doc.located || e!.record, `${c.id}: ${a.label} has no located source`)
			checked++
		}
		for (const k of c.controls) for (const r of k.refs) assert.ok(c.ledger[r], `${c.id}: control ${k.id} cites ${r}, which is not in the ledger`)
	}
	assert.ok(checked > 20)
})

test("18b. a payment in another currency is blocked and its amount is kept apart", async () => {
	desk.resetDesk()
	const r = structuredClone(READINGS["INV-2026-1041"]!)
	r.fields!.currency = { value: "USD", quote: "TOTAL USD 1,415.00" }
	r.fields!.gross = { value: "1415.00", quote: "TOTAL USD 1,415.00" }
	desk.setModelRunner(scriptedModel({ readings: { usd: r, "INV-7733": READINGS["INV-7733"]! } }))
	desk.addDocument("usd", DOCS["INV-2026-1041"]!.text.replace("TOTAL EUR 1,415.00", "TOTAL USD 1,415.00"))
	desk.addDocument("INV-7733", DOCS["INV-7733"]!.text)
	await desk.whenSettled(20_000)
	assert.equal(control(desk.peek("usd"), "currency")?.status, "fail")
	assert.deepEqual(desk.snapshot().cases.map((c) => c.exposure?.currency).sort(), ["EUR", "USD"])
})

test("every synthetic scenario ends where scenarios.json says it should (scripted model)", async () => {
	const cases = await run(Object.keys(DOCS))
	for (const sc of loadScenarios()) {
		const c = cases[sc.docId]
		assert.ok(c, `scenario ${sc.docId} has no case`)
		assert.ok(sc.expect.includes(outcomeOf(c!)), `${sc.docId}: expected ${sc.expect.join(" or ")}, got ${outcomeOf(c!)}`)
		for (const id of sc.controls) assert.ok(["fail", "review"].includes(control(c!, id)?.status ?? ""), `${sc.docId}: control ${id} should be flagged, is ${control(c!, id)?.status}`)
	}
	const clean = ["INV-2026-1041", "INV-TC-20261122", "INV-AE-991204"]
	assert.ok(clean.every((id) => outcomeOf(cases[id]!) === "AUTO_APPROVED"), "the firewall lets valid payments through")
})
