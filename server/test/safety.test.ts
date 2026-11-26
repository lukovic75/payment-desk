/**
 * Financial safety at the edges: amounts that are not payable, amounts at the limits of the number format, and every
 * agent failing in turn. Real Mozaik runtime, scripted model, so each input is known exactly.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import type { PaymentCase } from "../domain.js"
import type { ReadingInput } from "../firewall.js"

process.env.DESK_PERSIST = "off"
process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
delete process.env.MOZAIK_API_KEY
const desk = await import("../desk.js")
const { outcomeOf } = await import("../domain.js")
const { parseMoney, formatMinor } = await import("../money.js")
const { scriptedModel } = await import("./scripted.js")

const f = (value: string, quote: string) => ({ value, quote })
/** A minimal invoice from a vendor that is in the vendor master with this IBAN, so that only the amount is in question. */
const invoice = (no: string, total: string) => `NORDLICHT LOGISTIK GmbH\nHafenstraße 12, 20457 Hamburg, Germany\n\nInvoice number: ${no}\nInvoice date: 20 November 2026\n\nTOTAL EUR ${total}\n\nIBAN: DE89 3704 0044 0532 0130 00\nPayment reference: ${no}`
const reading = (no: string, total: string, value: string): ReadingInput => ({ fields: { creditorName: f("NORDLICHT LOGISTIK GmbH", "NORDLICHT LOGISTIK GmbH"), invoiceNumber: f(no, `Invoice number: ${no}`), invoiceDate: f("2026-11-20", "Invoice date: 20 November 2026"), currency: f("EUR", `TOTAL EUR ${total}`), gross: f(value, `TOTAL EUR ${total}`), iban: f("DE89370400440532013000", "IBAN: DE89 3704 0044 0532 0130 00"), reference: f(no, `Payment reference: ${no}`) } })

async function one(no: string, total: string, value: string): Promise<PaymentCase> {
	desk.resetDesk()
	desk.setModelRunner(scriptedModel({ readings: { [no]: reading(no, total, value) } }))
	desk.addDocument(no, invoice(no, total), "demo")
	await desk.whenSettled(20_000)
	return desk.peek(no)
}
const neverPayable = (c: PaymentCase, why: string) => {
	assert.notEqual(c.stage, "approved", `${why}: not approved`)
	assert.equal(c.draft, null, `${why}: no draft`)
	assert.throws(() => desk.exportDraft(c.id), (e: any) => e.status === 409, `${why}: nothing to export`)
	assert.throws(() => desk.act(c.id, "approve", { reason: "a person insists on approving this anyway" }), (e: any) => e.status === 409, `${why}: a person cannot approve it either`)
	assert.equal(desk.snapshot().dailyAutoApproved, 0, `${why}: nothing counted as approved`)
}

test("the control case: the same minimal invoice with an ordinary amount is approved", async () => {
	const c = await one("INV-OK-1", "1,415.00", "1415.00")
	assert.equal(outcomeOf(c), "AUTO_APPROVED")
	assert.equal(c.draft?.amount.minor, 141500)
})

test("a zero amount is not a payment to authorise", async () => {
	const c = await one("INV-ZERO-1", "0.00", "0.00")
	neverPayable(c, "zero")
	assert.equal(outcomeOf(c), "BLOCKED")
})

test("a negative amount (a credit note) is never turned into a payment draft", async () => {
	const c = await one("INV-NEG-1", "-1,415.00", "-1415.00")
	neverPayable(c, "negative")
	assert.equal(outcomeOf(c), "BLOCKED")
})

test("amounts keep their exact value at the edges of the format", () => {
	assert.equal(parseMoney("9.999.999.999,99"), 999999999999)
	assert.equal(parseMoney("9,999,999,999.99"), 999999999999)
	assert.equal(formatMinor(999999999999, "EUR"), "9,999,999,999.99 EUR")
	assert.equal(parseMoney("1.415,00"), parseMoney("1,415.00"))
	assert.equal(parseMoney("0,10")! + parseMoney("0,20")!, parseMoney("0,30"))
	assert.equal(parseMoney("1415"), 141500)
	assert.equal(parseMoney("EUR 1 415,5"), 141550)
	assert.equal(parseMoney("(250.00)"), -25000)
	assert.equal(parseMoney("no amount here"), null)
	assert.equal(parseMoney("12345678901234567890.00"), null, "a number too large to hold exactly is refused, not rounded")
})

test("a very large amount is exact, above the limit, and needs a person", async () => {
	const c = await one("INV-BIG-1", "9,999,999,999.99", "9999999999.99")
	assert.equal(c.exposure?.minor, 999999999999)
	assert.equal(outcomeOf(c), "NEEDS_APPROVAL")
	assert.equal(c.draft, null)
})

for (const agent of ["Extractor", "Validator", "Auditor", "Policy"] as const) {
	test(`when the ${agent} fails, nothing is approved and the document can be run again`, async () => {
		desk.resetDesk()
		desk.setModelRunner(scriptedModel({ readings: { "INV-F-1": reading("INV-F-1", "1,415.00", "1415.00") } }))
		desk.setFault({ agent, kind: "provider_error" })
		desk.addDocument("INV-F-1", invoice("INV-F-1", "1,415.00"), "demo")
		await desk.whenSettled(20_000)
		const c = desk.peek("INV-F-1")
		assert.equal(outcomeOf(c), "PROCESSING_ERROR")
		assert.equal(c.draft, null)
		assert.equal(desk.snapshot().dailyAutoApproved, 0)
		assert.throws(() => desk.act("INV-F-1", "approve", { reason: "approve it despite the failure" }), (e: any) => e.status === 409)
		assert.ok(c.runs.some((r) => r.agent === agent && r.status !== "done"), "the failure is on the execution record")
		desk.setFault(null)
		desk.act("INV-F-1", "reprocess")
		await desk.whenSettled(20_000)
		assert.equal(outcomeOf(desk.peek("INV-F-1")), "AUTO_APPROVED", "with the fault gone the same document is processed normally")
	})
}
