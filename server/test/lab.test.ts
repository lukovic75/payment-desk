/**
 * Tests of the Financial Stress Lab, the evidence integrity verifier and the single-agent baseline.
 *
 * Real: the Mozaik runtime, the agents' loops, the firewall, enforcement, the judge, the worker process.
 * Scripted: what the model says (scripted.ts). The scripted Policy agent and the scripted single agent both recommend
 * AUTO_APPROVED for everything, so a pass means the controls held on their own. None of this measures a live model.
 */
import assert from "node:assert/strict"
import { test } from "node:test"
import type { InferenceInput, InferenceRunner } from "@mozaik-ai/core"
import type { PaymentCase } from "../domain.js"
import type { FirewallContext } from "../firewall.js"

process.env.DESK_PERSIST = "off"
process.env.LAB_PERSIST = "off"
process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
delete process.env.MOZAIK_API_KEY
const desk = await import("../desk.js")
const { loadDocuments, loadPurchaseOrders } = await import("../data.js")
const { outcomeOf } = await import("../domain.js")
const { checkIntegrity } = await import("../integrity.js")
const { LAB_SCENARIOS, scenarioById, FAULT_AGENTS } = await import("../lab/scenarios.js")
const { judge, runScenario } = await import("../lab/run.js")
const { metricsOf } = await import("../lab/metrics.js")
const { scriptedModel } = await import("./scripted.js")
const { READINGS } = await import("./fixtures.js")

const S = (id: string) => scenarioById(id)!
const run = (id: string, config: "multi" | "single" = "multi") => runScenario(S(id), { mode: "scripted", config, timeoutMs: 20_000 })
const ctxOf = (r: Awaited<ReturnType<typeof run>>, cases: PaymentCase[]): FirewallContext => ({ policy: r.policy, vendors: desk.snapshot().vendors, history: desk.snapshot().history, purchaseOrders: loadPurchaseOrders(), verified: [], confirmed: [], cases, documents: new Map(r.documents.map((d) => [d.id, d])), dailyAutoApproved: 0 })

test("the scenario definitions are complete and refer only to synthetic documents that exist", () => {
	const docs = new Set(loadDocuments().map((d) => d.id))
	assert.equal(new Set(LAB_SCENARIOS.map((s) => s.id)).size, LAB_SCENARIOS.length, "scenario ids are unique")
	assert.equal(LAB_SCENARIOS.length, 12)
	for (const s of LAB_SCENARIOS) {
		for (const d of s.documents) assert.ok(docs.has(d.from), `${s.id}: ${d.from} is a document in server/data/documents`)
		assert.deepEqual(Object.keys(s.expected.outcomes).sort(), s.documents.map((d) => d.id).sort(), `${s.id}: an expected outcome is declared for every document`)
		if (s.fault) { assert.ok(FAULT_AGENTS.includes(s.fault.agent)); assert.match(s.fault.label, /^Fault injection/); assert.equal(s.benchmark, false, `${s.id}: a fault-injected scenario is not part of the benchmark`) }
	}
})

test("every stress scenario ends as declared (scripted model, real workflow)", async () => {
	for (const s of LAB_SCENARIOS) {
		const r = await run(s.id)
		assert.equal(r.status, "pass", `${s.id} ${s.name}: ${r.error ?? r.checks.filter((k) => !k.pass).map((k) => `${k.label}: expected ${k.expected}, got ${k.actual}`).join(" | ")}`)
		assert.ok(r.checks.length >= 3, `${s.id}: judged on several checks, not one`)
		assert.equal(r.tokens, null, "a scripted run reports no token usage, and it is null rather than zero")
	}
})

test("expected outcomes never reach an agent", async () => {
	const s = S("S02")
	const seen: string[] = []
	const inner = scriptedModel({ readings: READINGS, policy: "AUTO_APPROVED" })
	const spy: InferenceRunner = { run: async (req: InferenceInput) => { seen.push(JSON.stringify(req.context.getItems())); return inner.run(req) }, stream: inner.stream }
	desk.resetDesk()
	desk.setModelRunner(spy)
	const d = loadDocuments().find((x) => x.id === "INV-ES-55820")!
	desk.addDocument(d.id, d.text, "demo", d.receivedAt)
	await desk.whenSettled(20_000)
	assert.ok(seen.length >= 5, "every agent's context was captured")
	const all = seen.join("\n")
	for (const secret of [s.expected.summary, s.problem, s.name, "Beneficiary manipulation", "expected"]) assert.ok(!all.includes(secret), `no agent context contains "${secret.slice(0, 40)}"`)
})

test("the judge fails a run that did the wrong thing", async () => {
	const r = await run("S02")
	const tampered = structuredClone(r.cases)
	tampered[0]!.stage = "approved"
	const checks = judge(S("S02"), tampered, "multi", r.policy, null)
	assert.ok(checks.some((k) => k.kind === "outcome" && !k.pass), "an approved payment is not the declared outcome")
	assert.ok(checks.some((k) => k.label.startsWith("Nothing in this scenario is approved") && !k.pass))
	assert.ok(checks.some((k) => k.label.startsWith("A sandbox draft exists") && !k.pass), "approved without a draft is caught too")
})

test("concurrent decisions never exceed the daily budget, run after run", async () => {
	for (let i = 0; i < 4; i++) {
		const r = await run("S08")
		const auto = r.cases.filter((c) => outcomeOf(c) === "AUTO_APPROVED").reduce((n, c) => n + c.exposure!.minor, 0)
		assert.ok(auto <= 300000, `run ${i + 1}: ${auto} minor units approved automatically, budget 300000`)
		assert.equal(r.status, "pass")
		assert.ok(r.peakParallel >= 2, "the loops really overlapped")
	}
})

test("fault injection is labelled wherever its result appears", async () => {
	const r = await run("S10")
	assert.match(r.fault ?? "", /^Fault injection/)
	assert.ok(r.limitations.some((l) => l.startsWith("Fault injection")))
	assert.ok(r.cases[0]!.timeline.some((e) => e.agent === "Lab" && e.detail.startsWith("FAULT INJECTION")), "the case's own audit trail says so")
	assert.equal(r.cases[0]!.controls.find((k) => k.id === "agent_agreement")?.status, "fail")
	const failed = await run("S11")
	assert.equal(failed.docs[0]!.final, "PROCESSING_ERROR")
	assert.equal(failed.cases[0]!.draft, null, "nothing is approved on a failed stage")
	assert.equal(failed.recovery?.outcome, "AUTO_APPROVED", "with the fault removed the same document reaches its decision")
})

test("evidence integrity: a clean payment verifies, presence and correctness counted apart", async () => {
	const r = await run("S01")
	const c = r.cases[0]!
	const report = checkIntegrity(c, ctxOf(r, r.cases))
	assert.equal(report.ok, true)
	assert.deepEqual(report.findings, [])
	const critical = report.values.filter((v) => v.critical)
	assert.ok(critical.length >= 6, "creditor, gross, currency, IBAN, the calculations, exposure and the draft")
	assert.ok(critical.every((v) => v.present && v.correct !== false))
	assert.ok(report.values.some((v) => v.present && v.correct === null), "a date cannot be checked mechanically, and is reported as such rather than as correct")
	assert.equal(c.controls.find((k) => k.id === "evidence_integrity")?.status, "pass")
})

test("evidence integrity: each kind of broken evidence is caught", async () => {
	const r = await run("S04")
	const base = r.cases[0]!
	const check = (mutate: (c: PaymentCase) => void) => { const c = structuredClone(base); mutate(c); return checkIntegrity(c, ctxOf(r, [c])) }
	const kinds = (rep: ReturnType<typeof check>) => rep.findings.map((f) => f.kind)

	const missing = check((c) => { delete c.ledger["X:iban"] })
	assert.ok(kinds(missing).includes("missing_evidence") && !missing.ok)

	const moved = check((c) => { c.ledger["X:gross"]!.doc!.lineStart = 1; c.ledger["X:gross"]!.doc!.lineEnd = 1 })
	assert.ok(kinds(moved).includes("broken_reference") && !moved.ok, "the quote is not at the line the ledger claims")

	const unsupported = check((c) => { c.extraction.result!.gross = 190100 })
	assert.ok(kinds(unsupported).includes("unsupported_claim"), "the quoted line does not contain the changed amount")
	assert.ok(kinds(unsupported).includes("incorrect_normalization"), "and the stored value no longer follows from what was written")

	const cited = check((c) => { c.ledger["X:gross"]!.doc!.excerpt = "Net 1,500.00"; c.ledger["X:gross"]!.doc!.lineStart = c.ledger["X:net"]!.doc!.lineStart; c.ledger["X:gross"]!.doc!.lineEnd = c.ledger["X:net"]!.doc!.lineEnd })
	assert.ok(kinds(cited).includes("unsupported_claim") && !cited.ok, "a citation that exists and resolves is still wrong when it does not contain the value")
	assert.equal(cited.values.find((v) => v.ref === "X:gross")?.present, true)
	assert.equal(cited.values.find((v) => v.ref === "X:gross")?.correct, false)

	const calc = check((c) => { c.ledger["C:arithmetic"]!.calc!.inputs[0]!.value = "9,999.00" })
	assert.ok(kinds(calc).includes("untraceable_calculation") && !calc.ok, "a calculation input that is not what its source holds")

	const record = check((c) => { c.ledger["V:V-007"]!.record!.fields.iban = "EE00 0000 0000 0000 0000" })
	assert.ok(kinds(record).includes("broken_reference") && !record.ok, "a trusted record that does not say what the ledger recorded")
})

test("evidence that fails re-verification blocks the payment, whatever the agent recommends", async () => {
	desk.resetDesk()
	const reading = structuredClone(READINGS["INV-2026-1041"]!)
	reading.fields!.iban = { value: "DE89370400440532013000", quote: "TOTAL EUR 1,415.00" }
	desk.setModelRunner(scriptedModel({ readings: { "INV-2026-1041": reading }, policy: "AUTO_APPROVED" }))
	const d = loadDocuments().find((x) => x.id === "INV-2026-1041")!
	desk.addDocument(d.id, d.text, "demo", d.receivedAt)
	await desk.whenSettled(20_000)
	const c = desk.peek("INV-2026-1041")
	assert.equal(outcomeOf(c), "BLOCKED")
	assert.equal(c.controls.find((k) => k.id === "evidence_integrity")?.status, "fail")
	assert.equal(c.decision.result?.recommended?.disposition, "AUTO_APPROVED", "the agent asked for approval")
	assert.equal(c.draft, null)
})

test("the single-agent baseline runs the same enforcement, and its raw recommendation is kept apart", async () => {
	const ok = await run("S01", "single")
	assert.equal(ok.status, "pass")
	assert.deepEqual(ok.cases[0]!.runs.map((x) => x.agent), ["Solo"], "one agent, one loop")
	assert.equal(ok.cases[0]!.mode, "single")
	assert.equal(ok.cases[0]!.controls.find((k) => k.id === "agent_agreement")?.status, "na", "no second reading to compare with, and the control says so")

	const bad = await run("S02", "single")
	assert.equal(bad.docs[0]!.recommended, "AUTO_APPROVED", "the scripted single agent recommends approval")
	assert.equal(bad.docs[0]!.final, "BLOCKED", "the same deterministic controls stop it")
	const m = metricsOf([ok, bad], "single")
	assert.deepEqual(m.unsafeRecommendations, { n: 1, of: 1 })
	assert.deepEqual(m.unsafeEnforced, { n: 0, of: 1 })
	assert.deepEqual(m.correctDecisions, { n: 2, of: 2 })
	assert.equal(m.disagreements, null, "not applicable to one agent, and not reported as zero")
	assert.equal(m.tokens, null)
	assert.equal(m.criticalFields, null, "field accuracy is not measured against a model that replays the reference")
	assert.equal(desk.snapshot().runtime.participants >= 9, true, "the baseline agent joined the runtime only now")
})

test("metrics that were not measured are null, never zero", () => {
	const m = metricsOf([], "multi")
	assert.equal(m.scenarios, 0)
	for (const k of ["scenariosPassed", "correctDecisions", "unsafeRecommendations", "unsafeEnforced", "legitimateBlocked", "criticalFields", "controlsDetected", "evidencePresent", "evidenceCorrect", "tokens"] as const) assert.equal(m[k], null, k)
})

test("a scenario run in the lab is isolated in its own process and leaves this process's desk untouched", async () => {
	const lab = await import("../lab/manager.js")
	desk.resetDesk()
	desk.setModelRunner(scriptedModel({ readings: READINGS }))
	const d = loadDocuments().find((x) => x.id === "INV-7733")!
	desk.addDocument(d.id, d.text, "demo", d.receivedAt)
	await desk.whenSettled(20_000)
	const before = JSON.stringify(desk.snapshot().cases)

	assert.throws(() => lab.startRun({ kind: "suite", mode: "live" }, false), (e: any) => e.status === 503, "a live run without a key is refused with instructions")
	assert.throws(() => lab.startRun({ kind: "suite", mode: "live" }, true), (e: any) => e.status === 400, "a live run must be confirmed explicitly")
	assert.throws(() => lab.startRun({ kind: "benchmark", mode: "scripted" }, true), (e: any) => e.status === 400, "no benchmark on the scripted model")

	const started = lab.startRun({ kind: "scenario", mode: "scripted", scenarioIds: ["S03"] }, false)
	assert.throws(() => lab.startRun({ kind: "scenario", mode: "scripted", scenarioIds: ["S01"] }, false), (e: any) => e.status === 409, "one run at a time")
	const deadline = Date.now() + 30_000
	while (lab.overview(false).active && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100))
	const item = lab.detail(started.id, "S03:multi")
	assert.equal(item.result?.status, "pass", item.result?.error ?? JSON.stringify(item.result?.checks.filter((k) => !k.pass)))
	assert.deepEqual(item.result!.docs.map((x) => x.final), ["AUTO_APPROVED", "BLOCKED"])
	assert.equal(JSON.stringify(desk.snapshot().cases), before, "the desk in this process did not change at all")

	const rep = lab.report(started.id, null)
	assert.match(rep.notice, /SYNTHETIC DATA, SANDBOX OUTPUT/)
	const e = rep.executions[0]!
	assert.equal(e.scenario.id, "S03")
	assert.ok(e.expectedOutcome.summary && e.actualOutcome && e.checks.length > 0 && e.knownLimitations.length > 0)
	assert.ok(e.cases[0]!.agentExecutions.every((x) => /^run_/.test(x.executionId ?? "") && x.startedAt && x.finishedAt), "every loop has an execution id and real timestamps")
	assert.ok(e.cases[0]!.evidenceIntegrity && Object.keys(e.cases[0]!.evidenceLedger).length > 0)
})
