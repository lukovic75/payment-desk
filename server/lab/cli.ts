/**
 * Financial Stress Lab from the terminal.
 *
 *   npm run lab                 every scenario, scripted model: no API key, a few seconds, deterministic
 *   npm run lab -- --live       every scenario with live models through Mozaik (uses API credit)
 *   npm run lab -- --benchmark  single-agent baseline against the multi-agent workflow, live models
 *   npm run lab -- --only S02,S05
 *
 * Exits with 1 when a scenario fails or cannot be judged.
 */
import "dotenv/config"

const args = process.argv.slice(2)
const live = args.includes("--live") || args.includes("--benchmark")
const benchmark = args.includes("--benchmark")
const only = args.includes("--only") ? (args[args.indexOf("--only") + 1] ?? "").split(",").filter(Boolean) : null
process.env.DESK_PERSIST = "off"
if (!live) { process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"; delete process.env.MOZAIK_API_KEY }
const local = (process.env.DESK_INFERENCE ?? "").toLowerCase() === "local"
if (live && !local && !(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)) {
	console.error("A live run needs a model: a provider key (copy .env.example to .env and set ANTHROPIC_API_KEY), or local inference (DESK_INFERENCE=local and LOCAL_MODEL). `npm run lab` without --live needs neither.")
	process.exit(2)
}

// Mozaik prints one "telemetry disabled" line per loop when it is not paired; in a scripted run that is only noise.
if (!live) for (const k of ["log", "warn", "error", "info"] as const) { const real = console[k].bind(console); console[k] = (...a: unknown[]) => { if (!String(a[0] ?? "").startsWith("mozaik cloud:")) real(...a) } }

const { LAB_SCENARIOS } = await import("./scenarios.js")
const { runScenario } = await import("./run.js")
const { metricsOf, METRIC_NOTES } = await import("./metrics.js")
type Result = Awaited<ReturnType<typeof runScenario>>

const scenarios = LAB_SCENARIOS.filter((s) => (only ? only.includes(s.id) : true) && (benchmark ? s.benchmark : true))
const mode = live ? "live" : "scripted"
console.log(`\nFinancial Stress Lab · ${scenarios.length} scenario(s) · ${live ? (local ? `LIVE LOCAL models through Mozaik (${process.env.LOCAL_MODEL ?? "see LOCAL_FAST_MODEL / LOCAL_CAREFUL_MODEL"}, on this machine)` : "LIVE models through Mozaik") : "SCRIPTED model (fixed agent output; tests the workflow and the controls, not a language model)"} · synthetic data, sandbox\n`)

const results: Result[] = []
for (const config of benchmark ? (["single", "multi"] as const) : (["multi"] as const)) {
	if (benchmark) console.log(config === "single" ? "Configuration A: single-agent baseline" : "\nConfiguration B: Payment Desk multi-agent workflow")
	for (const s of scenarios) {
		const r = await runScenario(s, { mode, config, timeoutMs: live ? (local ? 2_400_000 : 240_000) : 30_000 })
		results.push(r)
		const mark = r.status === "pass" ? "PASS " : r.status === "fail" ? "FAIL " : "ERROR"
		console.log(`${mark} ${s.id} ${s.name.padEnd(46)} ${r.docs.map((d) => `${d.doc}: ${d.final}`).join(", ")}  (${r.loops} loops, peak ${r.peakParallel} in parallel, ${(r.durationMs / 1000).toFixed(1)} s)`)
		if (r.error) console.log(`      ${r.error}`)
		for (const k of r.checks.filter((k) => !k.pass)) console.log(`      ✗ ${k.doc ? `${k.doc}: ` : ""}${k.label}\n        expected ${k.expected}; got ${k.actual}`)
	}
}

const count = (st: string) => results.filter((r) => r.status === st).length
console.log(`\n${count("pass")} passed, ${count("fail")} failed, ${count("error")} could not be judged, of ${results.length} run(s).`)

if (benchmark) {
	const show = (v: { n: number; of: number } | null) => (v ? `${v.n} of ${v.of}` : "not measured")
	const a = metricsOf(results, "single"), b = metricsOf(results, "multi")
	const rows: [string, string, string][] = [
		["Scenarios passed", show(a.scenariosPassed), show(b.scenariosPassed)],
		["Correct final decisions (documents)", show(a.correctDecisions), show(b.correctDecisions)],
		["Unsafe approval recommendations (before enforcement)", show(a.unsafeRecommendations), show(b.unsafeRecommendations)],
		["Unsafe approvals after enforcement", show(a.unsafeEnforced), show(b.unsafeEnforced)],
		["Legitimate payments not approved", show(a.legitimateBlocked), show(b.legitimateBlocked)],
		["Critical fields matching the reference", show(a.criticalFields), show(b.criticalFields)],
		["Declared control conditions detected", show(a.controlsDetected), show(b.controlsDetected)],
		["Evidence present", show(a.evidencePresent), show(b.evidencePresent)],
		["Evidence correct", show(a.evidenceCorrect), show(b.evidenceCorrect)],
		["Agent disagreements", a.disagreements == null ? "not applicable" : String(a.disagreements), b.disagreements == null ? "not applicable" : String(b.disagreements)],
		["Agent loops", String(a.loops), String(b.loops)],
		["Duration", `${(a.durationMs / 1000).toFixed(1)} s`, `${(b.durationMs / 1000).toFixed(1)} s`],
		["Tokens (provider-reported)", a.tokens == null ? "not reported" : String(a.tokens), b.tokens == null ? "not reported" : String(b.tokens)],
	]
	console.log(`\nBenchmark over ${a.scenarios} synthetic scenario(s). Too few for any statistical claim.\n`)
	console.log(`${"".padEnd(54)} ${"single agent".padEnd(16)} multi-agent`)
	for (const [label, x, y] of rows) console.log(`${label.padEnd(54)} ${x.padEnd(16)} ${y}`)
	console.log(`\nHow each figure is computed: ${Object.keys(METRIC_NOTES).length} definitions in server/lab/metrics.ts. Model cost is not reported: no reliable price table is bundled.`)
}
// --out <file>: the same results as a file, so that a live run can be kept as it happened.
if (args.includes("--out")) {
	const { writeFileSync } = await import("node:fs")
	const { MODELS, inferenceNow } = await import("../desk.js")
	const brief = (r: Result) => ({ scenario: r.scenarioId, name: scenarios.find((x) => x.id === r.scenarioId)?.name ?? r.scenarioId, config: r.config, models: r.models, status: r.status, error: r.error ?? null, documents: r.docs.map((d) => ({ doc: d.doc, expected: d.expected, recommended: d.recommended ?? null, final: d.final })), failedChecks: r.checks.filter((k) => !k.pass).map((k) => ({ doc: k.doc, label: k.label, expected: k.expected, actual: k.actual })), loops: r.loops, peakParallel: r.peakParallel, durationMs: r.durationMs })
	writeFileSync(args[args.indexOf("--out") + 1]!, JSON.stringify({ at: new Date().toISOString(), mode, inference: live ? inferenceNow() : { kind: "scripted" }, models: live ? MODELS : null, scenarios: scenarios.map((x) => x.id), results: results.map(brief), metrics: benchmark ? { single: metricsOf(results, "single"), multi: metricsOf(results, "multi") } : null }, null, 2))
}
process.exit(results.every((r) => r.status === "pass") ? 0 : 1)
