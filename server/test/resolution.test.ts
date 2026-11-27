/**
 * How a held or blocked payment can be resolved with a trusted record, and what cannot stand in for one.
 * Two records exist: a vendor confirmation of the payable amount (settles a document that states two amounts) and a
 * callback for a changed bank account. Both are synthetic fixtures; the desk matches a record, it contacts nobody.
 * Real Mozaik runtime, scripted model. Every request goes through `act`, the same function the HTTP API calls.
 */
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { spawn, type ChildProcess } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { PaymentCase } from "../domain.js"

process.env.DESK_PERSIST = "off"
process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
process.env.AGENT_TIMEOUT_MS = "4000"
process.env.DESK_RETRY_DELAY_MS = "5"
delete process.env.MOZAIK_API_KEY
const desk = await import("../desk.js")
const { loadDocuments, loadConfirmations, loadCallbacks } = await import("../data.js")
const { outcomeOf } = await import("../domain.js")
const { scriptedModel } = await import("./scripted.js")
const { READINGS } = await import("./fixtures.js")

const DOCS = Object.fromEntries(loadDocuments().map((d) => [d.id, d]))
const DISPUTED = "INV-2026-1049"
const GOOD = "VC-2026-1126-01"      // V-001, INV-2026-1049, 1,890.00 EUR, verified
const OTHER_VENDOR = "VC-2026-1126-02" // V-002, invoice 7733
const UNVERIFIED = "VC-2026-1126-03"   // V-001, INV-2026-1049, 1,980.00, from an address not in the vendor master
const OTHER_AMOUNT = "VC-2026-1126-04" // V-001, INV-2026-1050, 1,980.00, verified
const control = (c: PaymentCase, id: string) => c.controls.find((k) => k.id === id)
const refused = (fn: () => unknown, status: number, re?: RegExp) => assert.throws(fn, (e: any) => e.status === status && (!re || re.test(e.message)), `expected ${status}${re ? ` ${re}` : ""}`)
const amounts = (c: PaymentCase) => c.challenges!.filter((k) => k.category === "document_contradiction")

async function run(ids: string[], extra: { docs?: Record<string, string>; readings?: Record<string, any>; audits?: Record<string, any> } = {}) {
	desk.resetDesk()
	desk.setModelRunner(scriptedModel({ readings: { ...READINGS, ...extra.readings }, audits: extra.audits, policy: "AUTO_APPROVED" }))
	for (const id of ids) desk.addDocument(id, extra.docs?.[id] ?? DOCS[id]!.text, "demo", DOCS[id]?.receivedAt)
	await desk.whenSettled(30_000)
	return Object.fromEntries(desk.snapshot().cases.map((c) => [c.id, c])) as Record<string, PaymentCase>
}
/** INV-2026-1049 under another invoice number: same contradiction, a different obligation. */
function variant(number: string) {
	const text = DOCS[DISPUTED]!.text.replaceAll(DISPUTED, number)
	const r = structuredClone(READINGS[DISPUTED]!)
	r.fields!.invoiceNumber = { value: number, quote: `Invoice number: ${number}` }
	return { docs: { [number]: text }, readings: { [number]: r } }
}

// ───────── a document that states two amounts ─────────

test("the fixtures: every confirmation names a vendor, an invoice, an amount, a currency, a source, a time and a status", () => {
	const all = loadConfirmations()
	assert.equal(new Set(all.map((k) => k.ref)).size, all.length, "references are unique")
	const vendors = new Set(desk.snapshot().vendors.map((v) => v.id))
	for (const k of all) {
		assert.match(k.ref, /^VC-/)
		assert.ok(vendors.has(k.vendorId), `${k.ref} belongs to a vendor in the vendor master`)
		assert.ok(k.invoiceNumber && Number.isInteger(k.payableAmount) && k.payableAmount > 0 && /^[A-Z]{3}$/.test(k.currency))
		assert.ok(k.method && k.confirmedBy && !Number.isNaN(Date.parse(k.confirmedAt)) && Number.isInteger(k.version))
		assert.ok(k.status === "verified" || k.status === "unverified")
	}
})

test("a verified vendor confirmation for this vendor, invoice and amount settles the contradiction, and a person still approves", async () => {
	const c = (await run([DISPUTED]))[DISPUTED]!
	assert.equal(outcomeOf(c), "NEEDS_APPROVAL")
	const before = amounts(c)
	assert.equal(before.length, 1)
	assert.equal(before[0]!.status, "requires_human_verification")
	refused(() => desk.act(DISPUTED, "approve", {}), 422, /two payable amounts/)
	refused(() => desk.act(DISPUTED, "approve", { reason: "the vendor told me on the phone which amount is right" }), 422, /two payable amounts/)

	const held = desk.act(DISPUTED, "verify_amount", { confirmationRef: GOOD })
	assert.equal(held.stage, "awaiting_approval", "the record does not approve anything; a person still does")
	assert.equal(held.draft, null)
	const vc = held.ledger[`VC:${GOOD}`]!
	assert.equal(vc.category, "vendor_confirmation")
	assert.deepEqual([vc.record!.fields.vendor, vc.record!.fields.invoice, vc.record!.fields.payableAmount, vc.record!.fields.status], ["V-001", DISPUTED, "1,890.00 EUR", "verified"])
	assert.equal(control(held, "amount_confirmation")?.status, "pass")
	assert.equal(control(held, "stated_amounts")?.status, "review", "the contradiction is still a finding")
	assert.equal(control(held, "stated_amounts")?.settledBy, `VC:${GOOD}`, "and it says which record settled it")
	const now = amounts(held)
	assert.equal(now[0]!.status, "matched_to_record")
	assert.deepEqual([now[0]!.challenged, now[0]!.observed], [before[0]!.challenged, before[0]!.observed], "both stated amounts and their sources stay on record")
	assert.equal(held.integrity?.ok, true, "the confirmation passes the independent evidence check")
	assert.deepEqual(desk.openDiscrepancies(held), [])

	const done = desk.act(DISPUTED, "approve", {})
	assert.equal(outcomeOf(done), "APPROVED_BY_HUMAN")
	assert.equal(done.draft?.amount.minor, 189000)
	assert.ok(done.review.at(-1)!.refs.includes(`VC:${GOOD}`), "the approval cites the confirmation it rests on")
	assert.deepEqual(done.review.map((r) => [r.action, r.outcome]), [["approve", "refused"], ["approve", "refused"], ["verify_amount", "applied"], ["approve", "applied"]], "the whole resolution history is kept")
	assert.equal(amounts(done)[0]!.status, "matched_to_record", "approval does not relabel it")
})

test("what cannot settle it: no reference, an unknown one, another vendor's, an unverified one, a malformed one", async () => {
	await run([DISPUTED])
	const attempts: [string | null, RegExp][] = [
		[null, /Enter the reference/], ["", /Enter the reference/], ["   ", /Enter the reference/],
		["VC-0000-0000-00", /not a confirmation on record/],
		[OTHER_VENDOR, /not a confirmation on record/],
		[OTHER_AMOUNT, /not a confirmation on record/], // right vendor, another invoice
		["VC-2026-1126-05", /not a confirmation on record/], // right vendor, invoice and figure, verified, but in USD: another currency is another amount
		[UNVERIFIED, /on record as unverified/],
		["'; DROP TABLE confirmations; --", /not a confirmation on record/],
		["<img src=x onerror=alert(1)>", /not a confirmation on record/],
		[`${GOOD}\u0000`, /not a confirmation on record/],
		["VC".repeat(5000), /not a confirmation on record/],
	]
	for (const [ref, re] of attempts) refused(() => desk.act(DISPUTED, "verify_amount", { confirmationRef: ref }), 422, re)
	const c = desk.peek(DISPUTED)
	assert.equal(c.stage, "awaiting_approval")
	assert.equal(Object.keys(c.ledger).some((k) => k.startsWith("VC:")), false, "nothing was attached")
	assert.equal(amounts(c)[0]!.status, "requires_human_verification")
	assert.equal(c.review.filter((r) => r.action === "verify_amount" && r.outcome === "refused").length, attempts.length, "every refused attempt is on record")
	assert.ok(c.review.every((r) => (r.reason ?? "").length < 400), "an oversized reference is not copied into the history")
	refused(() => desk.act(DISPUTED, "approve", {}), 422, /two payable amounts/)
	// a line of the invoice itself is still not evidence of which amount is owed
	const ch = amounts(c)[0]!
	const paid = [ch.challenged, ch.observed].find((s) => Number(String(c.ledger[s.ref!]!.doc!.normalized).replace(/[^0-9]/g, "")) === c.exposure!.minor)!
	refused(() => desk.act(DISPUTED, "approve", { resolutions: [{ challengeId: ch.id, chosenRef: paid.ref! }] }), 422, /two payable amounts/)
})

test("a verified confirmation that states the other amount blocks the payment: it is evidence against it", async () => {
	const number = "INV-2026-1050"
	const c = (await run([number], variant(number)))[number]!
	assert.equal(outcomeOf(c), "NEEDS_APPROVAL")
	assert.equal(c.exposure?.minor, 189000, "the payment as read would pay the invoice total")
	const blocked = desk.act(number, "verify_amount", { confirmationRef: OTHER_AMOUNT })
	assert.equal(blocked.stage, "blocked")
	assert.equal(control(blocked, "amount_confirmation")?.status, "fail")
	assert.match(control(blocked, "amount_confirmation")!.detail, /1,980\.00 EUR is payable.*would pay 1,890\.00 EUR/)
	assert.equal(amounts(blocked)[0]!.status, "confirmed_discrepancy")
	assert.equal(blocked.draft, null)
	refused(() => desk.act(number, "approve", { reason: "the invoice total is the right amount, I am sure" }), 409, /blocked payment cannot be approved/)
	// running it again does not make the evidence go away
	desk.act(number, "reprocess")
	await desk.whenSettled(20_000)
	assert.equal(outcomeOf(desk.peek(number)), "BLOCKED")
})

test("a confirmation is only for a payment with an open disagreement about its amount", async () => {
	const cases = await run(["INV-2026-1041", "INV-ES-55820"])
	refused(() => desk.act("INV-2026-1041", "verify_amount", { confirmationRef: GOOD }), 409, /no open disagreement/)
	refused(() => desk.act("INV-ES-55820", "verify_amount", { confirmationRef: GOOD }), 409, /no open disagreement/)
	refused(() => desk.act("INV-0000", "verify_amount", { confirmationRef: GOOD }), 404)
	assert.equal(desk.peek("INV-2026-1041").stage, cases["INV-2026-1041"]!.stage)
	assert.equal(outcomeOf(desk.peek("INV-ES-55820")), "BLOCKED", "it does nothing for a changed bank account")
})

test("a confirmation settles its own invoice and no other payment on the desk", async () => {
	const number = "INV-2026-1050"
	const v = variant(number)
	await run([DISPUTED, number], v)
	desk.act(DISPUTED, "verify_amount", { confirmationRef: GOOD })
	const other = desk.peek(number)
	assert.equal(amounts(other)[0]!.status, "requires_human_verification", "the same vendor's other invoice is untouched")
	assert.equal(Object.keys(other.ledger).some((k) => k.startsWith("VC:")), false)
	assert.equal(control(other, "amount_confirmation"), undefined)
	refused(() => desk.act(number, "verify_amount", { confirmationRef: GOOD }), 422, /not a confirmation on record for invoice INV-2026-1050/)
	refused(() => desk.act(number, "approve", {}), 422)
})

test("readers that disagree on the amount are not settled by a confirmation: that payment stays blocked", async () => {
	const audit = structuredClone(READINGS[DISPUTED]!)
	audit.fields!.gross = { value: "1980.00", quote: "please pay EUR 1,980.00 for the express shipment by the end of the week." }
	const c = (await run([DISPUTED], { audits: { [DISPUTED]: audit } }))[DISPUTED]!
	assert.equal(outcomeOf(c), "BLOCKED")
	assert.equal(control(c, "agent_agreement")?.status, "fail")
	refused(() => desk.act(DISPUTED, "verify_amount", { confirmationRef: GOOD }), 409)
	assert.equal(outcomeOf(desk.peek(DISPUTED)), "BLOCKED")
})

test("the same confirmation attached twice, or approved twice, authorises one payment", async () => {
	await run([DISPUTED])
	desk.act(DISPUTED, "verify_amount", { confirmationRef: GOOD })
	refused(() => desk.act(DISPUTED, "verify_amount", { confirmationRef: GOOD }), 409, /no open disagreement/)
	desk.act(DISPUTED, "approve", {})
	refused(() => desk.act(DISPUTED, "approve", {}), 409, /already approved/)
	refused(() => desk.act(DISPUTED, "verify_amount", { confirmationRef: GOOD }), 409)
	assert.equal(desk.snapshot().cases.filter((c) => c.draft).length, 1)
})

// ───────── a changed bank account ─────────

/** An invoice from vendor V-001 that asks for the account the callback fixture confirms. */
function changedAccount(number: string) {
	const text = DOCS["INV-2026-1041"]!.text.replace("DE89 3704 0044 0532 0130 00", "DE62 3704 0044 0532 0130 01").replaceAll("INV-2026-1041", number)
	const r = structuredClone(READINGS["INV-2026-1041"]!)
	r.fields!.iban = { value: "DE62370400440532013001", quote: "IBAN: DE62 3704 0044 0532 0130 01" }
	r.fields!.invoiceNumber = { value: number, quote: `Invoice number: ${number}` }
	r.fields!.reference = { value: number, quote: `Payment reference: ${number}` }
	return { text, r }
}

test("a callback belongs to one vendor and one account: it clears nothing else", async () => {
	const cb = loadCallbacks()[0]!
	assert.deepEqual([cb.ref, cb.vendorId], ["CB-2026-1125-01", "V-001"])
	const a = changedAccount("INV-2026-1058")
	const cases = await run(["INV-2026-1058", "INV-ES-55820"], { docs: { "INV-2026-1058": a.text }, readings: { "INV-2026-1058": a.r } })
	assert.equal(outcomeOf(cases["INV-2026-1058"]!), "BLOCKED")
	// the real reference of another vendor, on Iberia's changed account
	refused(() => desk.act("INV-ES-55820", "verify_beneficiary", { callbackRef: cb.ref }), 422, /does not confirm this account for Iberia/)
	for (const bad of ["", "  ", "CB-2026-1125-02", "cb", `${cb.ref} OR 1=1`, "<script>alert(1)</script>", "C".repeat(20_000)]) refused(() => desk.act("INV-2026-1058", "verify_beneficiary", { callbackRef: bad }), 422)
	assert.equal(outcomeOf(desk.peek("INV-2026-1058")), "BLOCKED", "nothing but the matching reference moves it")
	assert.equal(outcomeOf(desk.peek("INV-ES-55820")), "BLOCKED")

	const ok = desk.act("INV-2026-1058", "verify_beneficiary", { callbackRef: cb.ref.toLowerCase() })
	assert.equal(outcomeOf(ok), "NEEDS_APPROVAL", "a matching callback lifts the block, and a person still approves")
	assert.equal(ok.draft, null)
	assert.ok(ok.ledger[`HV:${cb.ref}`], "the callback is in the case ledger")
	const ch = ok.challenges!.find((k) => k.id === "CH:beneficiary:iban")!
	assert.equal(ch.status, "matched_to_record")
	assert.deepEqual([ch.challenged.value, ch.observed.value], ["DE62370400440532013001", "DE89370400440532013000"], "the original discrepancy stays in the audit history")
	assert.equal(desk.snapshot().vendors.find((v) => v.id === "V-001")!.iban, "DE89370400440532013000", "the vendor master is not modified")
	assert.equal(outcomeOf(desk.peek("INV-ES-55820")), "BLOCKED", "another vendor's payment is not affected")
	refused(() => desk.act("INV-2026-1058", "verify_beneficiary", { callbackRef: cb.ref }), 409, /no unverified beneficiary change/)
})

test("a callback confirms an account for a vendor: a later invoice to that account is not blocked again, and is still not approved by itself", async () => {
	const a = changedAccount("INV-2026-1058"), b = changedAccount("INV-2026-1059")
	await run(["INV-2026-1058"], { docs: { "INV-2026-1058": a.text }, readings: { "INV-2026-1058": a.r, "INV-2026-1059": b.r } })
	desk.act("INV-2026-1058", "verify_beneficiary", { callbackRef: "CB-2026-1125-01" })
	desk.addDocument("INV-2026-1059", b.text)
	await desk.whenSettled(20_000)
	const later = desk.peek("INV-2026-1059")
	assert.equal(outcomeOf(later), "NEEDS_APPROVAL", "the account is the confirmed one, so it is held for a person rather than blocked")
	assert.equal(control(later, "beneficiary")?.status, "review")
	assert.ok(later.ledger["HV:CB-2026-1125-01"], "and its own ledger cites the callback it relies on")
	assert.equal(later.draft, null)
	assert.equal(desk.snapshot().dailyAutoApproved, 0, "neither was approved automatically")
})

// ───────── currency: missing, and read two ways ─────────

test("a payment with no currency, or with a currency the two readers do not agree on, is blocked", async () => {
	const none = structuredClone(READINGS["INV-2026-1041"]!)
	delete none.fields!.currency
	const missing = (await run(["INV-2026-1041"], { readings: { "INV-2026-1041": none }, audits: { "INV-2026-1041": READINGS["INV-2026-1041"]! } }))["INV-2026-1041"]!
	assert.equal(outcomeOf(missing), "BLOCKED", "a missing currency is not assumed to be the policy currency")
	assert.notEqual(control(missing, "mandatory_fields")?.status, "pass")
	assert.equal(missing.draft, null)
	refused(() => desk.act("INV-2026-1041", "approve", { reason: "it is obviously euros, approve it" }), 409)

	const usd = structuredClone(READINGS["INV-2026-1041"]!)
	usd.fields!.currency = { value: "USD", quote: "TOTAL EUR 1,415.00" }
	const split = (await run(["INV-2026-1041"], { audits: { "INV-2026-1041": usd } }))["INV-2026-1041"]!
	assert.equal(outcomeOf(split), "BLOCKED", "EUR from one reader and USD from the other")
	assert.equal(control(split, "agent_agreement")?.status, "fail")
	assert.ok(split.challenges!.some((k) => k.id === "CH:reading:currency" && k.status === "confirmed_discrepancy"))
	assert.equal(split.draft, null)
	assert.equal(desk.snapshot().dailyAutoApproved, 0)
})

// ───────── over HTTP, the way a script would try it ─────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PORT = 8300 + Math.floor(Math.random() * 250)
const BASE = `http://localhost:${PORT}`
let server: ChildProcess
const post = async (p: string, body?: unknown) => { const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) as any } }
before(async () => {
	server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, API_PORT: String(PORT), DESK_SCRIPTED: "1", DESK_PERSIST: "off", LAB_PERSIST: "off", MOZAIK_CREDENTIALS_FILE: "/nonexistent/mozaik-credentials.json", MOZAIK_API_KEY: "" } })
	for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)) }
	throw new Error("the server did not start")
})
after(() => new Promise<void>((r) => { if (!server || server.exitCode != null) return r(); server.once("exit", () => r()); server.kill() }))

test("HTTP: the resolution of the showcase's third scenario, start to finish, with nothing skippable from outside", async () => {
	await post("/api/showcase/start")
	await post("/api/showcase/run", { key: "challenge" })
	let c: any
	for (let i = 0; i < 100; i++) { c = (await (await fetch(`${BASE}/api/state`)).json()).cases.find((k: any) => k.id === DISPUTED); if (c && c.stage === "awaiting_approval") break; await new Promise((r) => setTimeout(r, 50)) }
	assert.equal(c.stage, "awaiting_approval")
	const act = (body: Record<string, unknown>) => post(`/api/cases/${DISPUTED}/actions`, body)
	assert.equal((await act({ action: "approve" })).status, 422)
	assert.equal((await fetch(`${BASE}/api/cases/${DISPUTED}/draft`)).status, 409, "no draft before an approval")
	// values of the wrong type are treated as no reference, never as a match
	for (const ref of [null, 12, true, {}, [GOOD], { ref: GOOD }]) assert.equal((await act({ action: "verify_amount", confirmationRef: ref })).status, 422, `a ${JSON.stringify(ref)} reference`)
	assert.equal((await act({ action: "verify_amount", confirmationRef: UNVERIFIED })).status, 422)
	assert.equal((await act({ action: "verify_amount", callbackRef: GOOD })).status, 422, "the reference in the wrong field is not picked up")
	assert.equal((await act({ action: "verify_beneficiary", callbackRef: GOOD })).status, 409, "and a confirmation is not a callback")
	// two requests at once attach it once
	const [a, b] = await Promise.all([act({ action: "verify_amount", confirmationRef: GOOD }), act({ action: "verify_amount", confirmationRef: GOOD })])
	assert.deepEqual([a.status, b.status].sort(), [200, 409])
	const held = a.status === 200 ? a.body : b.body
	assert.equal(held.stage, "awaiting_approval")
	assert.equal(held.challenges.find((k: any) => k.category === "document_contradiction").status, "matched_to_record")
	const approvals = await Promise.all(Array.from({ length: 5 }, () => act({ action: "approve" })))
	assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409, 409, 409, 409], "five approvals at once: one applies")
	const draft = await (await fetch(`${BASE}/api/cases/${DISPUTED}/draft`)).json()
	assert.deepEqual([draft.sandbox, draft.amount.formatted], [true, "1,890.00 EUR"])
	const s = await (await fetch(`${BASE}/api/state`)).json()
	assert.equal(s.policy.name, "Accounts payable policy v7 (synthetic)")
	const step = s.showcase.steps.find((k: any) => k.key === "challenge")
	assert.deepEqual([step.result, step.actual], ["confirmed", "NEEDS_APPROVAL"], "the scenario still reports what the workflow decided")
})
