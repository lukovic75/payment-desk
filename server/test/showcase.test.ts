/**
 * The interactive showcase. Real Mozaik runtime, scripted model. What is checked: that a scenario's result is read from
 * its payment case and nowhere else, that a second start or a second click cannot authorise anything twice, that the
 * demo leaves a person's own documents alone, that the execution mode is reported as it is, and that the recorded
 * execution is read-only.
 */
import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { spawn, type ChildProcess } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

process.env.DESK_PERSIST = "off"
process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
process.env.AGENT_TIMEOUT_MS = "4000"
process.env.DESK_RETRY_DELAY_MS = "5"
delete process.env.MOZAIK_API_KEY
const desk = await import("../desk.js")
const { loadDocuments } = await import("../data.js")
const { outcomeOf } = await import("../domain.js")
const { SHOWCASE } = await import("../showcase.js")
const { scriptedModel } = await import("./scripted.js")
const { READINGS } = await import("./fixtures.js")
const { SHOWCASE_RESPONSES } = await import("./showcase-responses.js")

const DOCS = Object.fromEntries(loadDocuments().map((d) => [d.id, d]))
const scripted = (extra: Record<string, unknown> = {}) => scriptedModel({ readings: READINGS, policy: "AUTO_APPROVED", ...SHOWCASE_RESPONSES, ...extra })
const fresh = (extra: Record<string, unknown> = {}) => { desk.resetDesk(); desk.setModelRunner(scripted(extra), "scripted") }
const step = (key: string) => desk.snapshot().showcase!.steps.find((s) => s.key === key)!
const refused = (fn: () => unknown, status: number, re?: RegExp) => assert.throws(fn, (e: any) => e.status === status && (!re || re.test(e.message)))
async function play(key: string) { desk.runShowcaseStep(key); await desk.whenSettled(20_000); return step(key) }

test("the four scenarios run one at a time and each result is the outcome the controls enforced", async () => {
	fresh()
	assert.equal(desk.snapshot().showcase, null, "no demo until one is started")
	const s = desk.startShowcase()
	assert.equal(s.cases.length, 0, "starting loads nothing and calls no model")
	assert.deepEqual(s.showcase!.steps.map((k) => [k.key, k.docId, k.result]), SHOWCASE.map((k) => [k.key, k.docId, "not_run"]))
	const expected: [string, string, string][] = [["legitimate", "AUTO_APPROVED", "approved"], ["beneficiary", "BLOCKED", "blocked"], ["challenge", "NEEDS_APPROVAL", "awaiting_approval"], ["duplicate", "BLOCKED", "blocked"]]
	for (const [key, outcome, stage] of expected) {
		const done = await play(key)
		assert.deepEqual([done.result, done.actual], ["confirmed", outcome], key)
		assert.equal(desk.peek(done.docId).stage, stage)
		assert.equal(desk.peek(done.docId).origin, "demo")
	}
	assert.equal(desk.snapshot().cases.length, 4, "only the scenarios that were run are on the desk")
	assert.equal(step("injection").result, "not_run", "the optional scenario stays optional")
	// what each scenario is there to show, read from the cases
	const ok = desk.peek("INV-2026-1041")
	assert.equal(ok.draft?.sandbox, true)
	assert.equal(ok.runs.some((r) => r.agent === "Investigator"), false, "a clean payment is not investigated")
	const iban = desk.peek("INV-ES-55820").challenges!.find((k) => k.id === "CH:beneficiary:iban")!
	assert.deepEqual([iban.challenged.ref, iban.observed.ref], ["X:iban", "V:V-004"], "both accounts carry a source reference")
	const amounts = desk.peek("INV-2026-1049").challenges!.filter((k) => k.category === "document_contradiction")
	assert.deepEqual(amounts.map((k) => [k.raisedBy, k.challenged.value, k.observed.value, k.status]), [["Auditor", "1980.00", "1890.00", "requires_human_verification"]])
	assert.ok(desk.peek("INV-2026-1049").runs.some((r) => r.agent === "Investigator"), "the disagreement reached the Investigator")
	const dup = desk.peek("INV-7701-rappel").controls.find((k) => k.id === "duplicate")!
	assert.equal(dup.status, "fail")
	assert.ok(dup.refs.includes("H:H-0001"), "the duplicate cites the payment history record")
	for (const c of desk.snapshot().cases) assert.deepEqual(c.outputChecks ?? [], [], `${c.id}: the predefined responses cite only evidence that exists`)
})

test("a scenario cannot be run twice, two cannot run at once, and an unknown one is refused", async () => {
	fresh({ latencyMs: 60 })
	refused(() => desk.runShowcaseStep("legitimate"), 409, /Start the demo first/)
	desk.startShowcase()
	refused(() => desk.runShowcaseStep("nope"), 404)
	desk.runShowcaseStep("legitimate")
	refused(() => desk.runShowcaseStep("legitimate"), 409, /already running/)
	refused(() => desk.runShowcaseStep("beneficiary"), 409, /Another scenario/)
	refused(() => desk.startShowcase(), 409, /still being processed/)
	assert.equal(step("legitimate").result, "running")
	await desk.whenSettled(20_000)
	refused(() => desk.runShowcaseStep("legitimate"), 409, /already run/)
	const c = desk.peek("INV-2026-1041")
	assert.equal(c.attempt, 1)
	assert.equal(c.runs.filter((r) => r.agent === "Extractor").length, 1, "one click, one run")
	assert.equal(desk.snapshot().cases.filter((k) => k.stage === "approved").length, 1, "and one approval")
	assert.equal(desk.dailyAutoApproved(), 141500)
})

test("a scenario that fails is reported as failed, never as confirmed, and can be run again", async () => {
	fresh({ fail: ["Auditor:INV-ES-55820", "Policy:INV-2026-1049"] })
	desk.startShowcase()
	assert.equal((await play("legitimate")).result, "confirmed")
	const failed = await play("beneficiary")
	assert.deepEqual([failed.result, failed.actual], ["failed", "PROCESSING_ERROR"])
	assert.equal(desk.peek("INV-ES-55820").draft, null)
	assert.equal(outcomeOf(desk.peek("INV-ES-55820")), "PROCESSING_ERROR")
	assert.equal((await play("challenge")).result, "failed", "a scenario that never reached a decision is not counted as an outcome")
	assert.equal(step("legitimate").result, "confirmed", "what completed before the failure stays completed")
	assert.equal(step("duplicate").result, "not_run")
	// the provider recovers: the same scenario is run again, as a second attempt of the same case
	desk.setModelRunner(scripted(), "scripted")
	const again = await play("beneficiary")
	assert.deepEqual([again.result, again.actual], ["confirmed", "BLOCKED"])
	assert.equal(desk.peek("INV-ES-55820").attempt, 2, "the failed attempt stays on record")
})

test("an outcome the scenario file does not expect is reported as unexpected", async () => {
	fresh()
	desk.setPolicy({ autoApproveLimit: 100_000 }) // 1,000.00: the legitimate invoice now needs a person
	desk.startShowcase()
	const s = await play("legitimate")
	assert.deepEqual([s.result, s.actual, s.expected], ["unexpected", "NEEDS_APPROVAL", ["AUTO_APPROVED"]])
})

test("the scenario result is what the workflow decided, not what a person did afterwards", async () => {
	fresh()
	desk.startShowcase()
	await play("challenge")
	desk.act("INV-2026-1049", "approve", { reason: "Vendor confirmed in writing that the invoice total is due" })
	assert.deepEqual([step("challenge").result, step("challenge").actual], ["confirmed", "NEEDS_APPROVAL"])
	const ch = desk.peek("INV-2026-1049").challenges!.find((k) => k.category === "document_contradiction")!
	assert.equal(ch.status, "accepted_by_reviewer", "an approved contradiction is accepted, not verified")
})

test("the demo leaves a person's own documents, decisions and verifications alone", async () => {
	fresh()
	// a document of the person's own, with a changed account that they verified against a callback record and then approved
	const text = DOCS["INV-2026-1041"]!.text.replace("DE89 3704 0044 0532 0130 00", "DE02 1203 0000 0000 2020 51").replaceAll("INV-2026-1041", "INV-2026-1058")
	const r = structuredClone(READINGS["INV-2026-1041"]!)
	r.fields!.iban = { value: "DE02120300000000202051", quote: "IBAN: DE02 1203 0000 0000 2020 51" }
	r.fields!.invoiceNumber = { value: "INV-2026-1058", quote: "Invoice number: INV-2026-1058" }
	r.fields!.reference = { value: "INV-2026-1058", quote: "Payment reference: INV-2026-1058" }
	desk.setModelRunner(scripted({ readings: { ...READINGS, "INV-2026-1058": r } }), "scripted")
	desk.addDocument("INV-2026-1058", text)
	await desk.whenSettled(20_000)
	desk.act("INV-2026-1058", "verify_beneficiary", { callbackRef: "CB-2026-1125-01" })
	desk.act("INV-2026-1058", "approve", { reason: "callback checked against the record" })
	const before = structuredClone(desk.peek("INV-2026-1058"))
	assert.equal(before.stage, "approved")

	desk.startShowcase()
	await play("legitimate"); await play("beneficiary")
	desk.startShowcase() // restart: the two demo cases go, the person's document stays
	const s = desk.snapshot()
	assert.deepEqual(s.cases.map((c) => c.id), ["INV-2026-1058"])
	assert.deepEqual(s.showcase!.steps.map((k) => k.result), SHOWCASE.map(() => "not_run"))
	const mine = desk.peek("INV-2026-1058")
	assert.equal(mine.stage, "approved")
	assert.deepEqual(mine.review, before.review, "the person's decisions are untouched")
	assert.deepEqual(desk.exportDraft("INV-2026-1058").amount, before.draft!.amount, "the approved draft still exports: the verification it rests on was not removed with the demo")
	assert.equal(desk.snapshot().dailyAutoApproved, 0, "nothing of the removed demo is still counted against the daily budget")
	// the reset the workspace has always had: demo documents only
	await play("legitimate")
	desk.resetDemo()
	assert.deepEqual(desk.snapshot().cases.map((c) => c.id), ["INV-2026-1058"])
	assert.equal(desk.snapshot().showcase, null)
})

test("a scenario does not take over a document a person added under the same id", async () => {
	fresh()
	desk.addDocument("INV-2026-1041", DOCS["INV-2026-1041"]!.text)
	await desk.whenSettled(20_000)
	desk.startShowcase()
	refused(() => desk.runShowcaseStep("legitimate"), 409, /already on the desk/)
	assert.equal(desk.peek("INV-2026-1041").origin, "user")
	assert.equal(step("legitimate").result, "not_run")
})

test("the recorded execution is served as stored: it is not on the desk and nothing can act on it", async () => {
	fresh()
	const rec = desk.recordingView()!
	assert.ok(rec, "the recording ships with the repository")
	assert.match(rec.recordedAt, /^2026-11-26T13:04/)
	assert.deepEqual(rec.models, { fast: "claude-haiku-4-5", careful: "claude-sonnet-5-5" })
	assert.deepEqual(rec.steps.map((s) => [s.key, s.result, s.actual]), [
		["legitimate", "confirmed", "AUTO_APPROVED"], ["beneficiary", "failed", "PROCESSING_ERROR"], ["challenge", "confirmed", "NEEDS_APPROVAL"], ["duplicate", "confirmed", "BLOCKED"], ["injection", "failed", "PROCESSING_ERROR"],
	], "two of the five did not finish in that run, and the recording says so")
	const live = rec.cases.find((c) => c.id === "INV-2026-1049")!
	assert.deepEqual(live.audit.result!.conflicts[0]!.values, ["1980.00", "1890.00"], "the live Auditor found both amounts on its own")
	assert.ok(live.runs.every((r) => /^claude-/.test(r.model) && r.tokens != null), "live models, with the token usage the provider reported")
	const v = live.runs.find((r) => r.agent === "Validator")!, a = live.runs.find((r) => r.agent === "Auditor")!
	assert.ok(Date.parse(v.startedAt) < Date.parse(a.finishedAt!) && Date.parse(a.startedAt) < Date.parse(v.finishedAt!), "the two checks overlap in the recorded timestamps")
	for (const c of rec.cases) assert.deepEqual(c.review, [], "no reviewer action is part of the recording")
	assert.doesNotMatch(JSON.stringify(rec), /request_id|sk-ant|api[_-]?key/i, "no provider identifiers or secrets")
	// the source text is the fixture, and only because it is the same document that was recorded
	assert.equal(desk.getRecordedDocumentText("INV-2026-1049"), DOCS["INV-2026-1049"]!.text)
	assert.equal(desk.getRecordedDocumentText("INV-7733"), null, "a document that is not in the recording is not served from it")
	// reading the recording changes nothing on the desk
	assert.equal(desk.snapshot().cases.length, 0)
	refused(() => desk.act("INV-2026-1049", "approve", { reason: "trying to approve a recorded case" }), 404)
	refused(() => desk.exportDraft("INV-2026-1041"), 404)
})

// ───────── over HTTP: the mode is reported as it is, and the recording has no write path ─────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PORT = 8600 + Math.floor(Math.random() * 300)
const BASE = `http://localhost:${PORT}`
let server: ChildProcess
const get = async (p: string) => { const r = await fetch(BASE + p); return { status: r.status, body: await r.json().catch(() => null) as any } }
const post = async (p: string, body?: unknown) => { const r = await fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) as any } }
async function boot(env: Record<string, string>) {
	server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, API_PORT: String(PORT), DESK_PERSIST: "off", LAB_PERSIST: "off", MOZAIK_CREDENTIALS_FILE: "/nonexistent/mozaik-credentials.json", MOZAIK_API_KEY: "", ...env } })
	for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)) }
	throw new Error("the server did not start")
}
const stop = () => new Promise<void>((r) => { if (!server || server.exitCode != null) return r(); server.once("exit", () => r()); server.kill() })
before(() => boot({ DESK_SCRIPTED: "1" }))
after(stop)

test("HTTP: a scripted server says it is scripted, runs the scenarios, and guards a double start", async () => {
	const health = (await get("/api/health")).body
	assert.equal(health.mode, "scripted")
	assert.equal((await get("/api/state")).body.modelMode, "scripted")
	assert.equal((await post("/api/showcase/run", { key: "legitimate" })).status, 409, "nothing runs before the demo is started")
	const [a, b] = await Promise.all([post("/api/showcase/start"), post("/api/showcase/start")])
	assert.deepEqual([a.status, b.status], [200, 200], "two starts with nothing running leave one clean demo")
	assert.equal((await get("/api/state")).body.showcase.mode, "scripted", "the demo is labelled with the mode it runs in")
	const [x, y] = await Promise.all([post("/api/showcase/run", { key: "challenge" }), post("/api/showcase/run", { key: "challenge" })])
	assert.deepEqual([x.status, y.status].sort(), [200, 409], "a double click starts the scenario once")
	let s: any
	for (let i = 0; i < 100; i++) { s = (await get("/api/state")).body; if (s.showcase.steps.find((k: any) => k.key === "challenge").result !== "running") break; await new Promise((r) => setTimeout(r, 50)) }
	const st = s.showcase.steps.find((k: any) => k.key === "challenge")
	assert.deepEqual([st.result, st.actual], ["confirmed", "NEEDS_APPROVAL"])
	const c = s.cases.find((k: any) => k.id === "INV-2026-1049")
	assert.equal(c.runs.filter((r: any) => r.agent === "Extractor").length, 1)
	assert.ok(c.runs.every((r: any) => r.tokens == null), "the scripted model reports no token usage, and none is invented")
	// the two amounts, each at its source line
	const doc = await (await fetch(`${BASE}/api/documents/INV-2026-1049`)).text()
	const ch = c.challenges.find((k: any) => k.category === "document_contradiction")
	for (const side of [ch.challenged, ch.observed]) {
		const e = c.ledger[side.ref]
		assert.ok(doc.split("\n")[e.doc.lineStart - 1].includes(e.doc.excerpt.trim().slice(0, 12)), `${side.value} is at line ${e.doc.lineStart} of the document`)
	}
	assert.equal((await post("/api/cases/INV-2026-1049/actions", { action: "approve", resolutions: [{ challengeId: ch.id, chosenRef: ch.observed.ref }] })).status, 422, "citing the line is not enough to approve a contradiction")
	// the recording: readable, with its own documents, and no way to write to it
	const rec = (await get("/api/recording")).body.recording
	assert.equal(rec.cases.length, 5)
	assert.equal((await fetch(`${BASE}/api/recording/documents/INV-7701-rappel`)).status, 200)
	assert.equal((await fetch(`${BASE}/api/recording/documents/INV-7733`)).status, 404)
	assert.equal((await post("/api/recording")).status, 404)
	assert.equal((await post("/api/cases/INV-7701-rappel/actions", { action: "approve", reason: "approving a recorded case" })).status, 404, "a recorded case is not on the desk")
})

test("HTTP: a live server without a key does not fall back to scripted responses", async () => {
	await stop()
	await boot({ DESK_SCRIPTED: "", ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "" })
	const health = (await get("/api/health")).body
	assert.deepEqual([health.mode, health.hasModelKey, health.hasLiveKey], ["live", false, false])
	assert.equal((await post("/api/showcase/start")).status, 200, "the demo can be opened")
	const run = await post("/api/showcase/run", { key: "legitimate" })
	assert.equal(run.status, 503, "but no scenario runs")
	assert.match(run.body.error, /No model API key/)
	const s = (await get("/api/state")).body
	assert.equal(s.modelMode, "live")
	assert.equal(s.cases.length, 0, "no case was produced by something else in its place")
	assert.equal(s.showcase.steps[0].result, "not_run")
})
