/**
 * The controlled architecture fault-injection test, from the terminal or as a worker process of the server.
 *
 *   npm run experiment            a table
 *   npm run experiment -- --json  the full result
 *
 * No API key, no model, a few seconds. Exits with 1 when a declared expectation does not hold.
 */
export {}
process.env.DESK_PERSIST = "off"
process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
delete process.env.MOZAIK_API_KEY
for (const k of ["log", "warn", "error", "info"] as const) { const real = console[k].bind(console); console[k] = (...a: unknown[]) => { if (!String(a[0] ?? "").startsWith("mozaik cloud:")) real(...a) } }

const { runExperiment } = await import("./experiment.js")

try {
	const result = await runExperiment()
	const ok = result.rows.every((r) => r.pass)
	if (process.send) {
		process.send({ type: "result", result }, () => process.exit(0))
	} else if (process.argv.includes("--json")) {
		console.log(JSON.stringify(result, null, 2))
		process.exit(ok ? 0 : 1)
	} else {
		console.log(`\n${result.label}\nPolicy: ${result.policy} · ${result.rows.length} cases, each run twice · ${(result.durationMs / 1000).toFixed(1)} s\n`)
		for (const r of result.rows) {
			console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id} ${r.title}`)
			console.log(`      injected into ${r.agent}: ${r.injected}`)
			console.log(`      one agent:   ${r.single.outcome}${r.single.wrongAmountApproved ? `  (approved ${r.single.amount}, the document asks for another amount)` : ""}`)
			console.log(`      five agents: ${r.multi.outcome}${r.multi.challenges.length ? `  · challenges: ${r.multi.challenges.map((c) => `${c.id} by ${c.raisedBy}`).join(", ")}` : ""}${r.multi.investigator ? " · Investigator called" : ""}`)
			console.log(`      caught by:   ${r.caughtBy}\n`)
		}
		const s = result.summary
		console.log(`${s.injected} injected errors: ${s.caughtByCodeInBoth} stopped by code controls in both configurations, ${s.caughtOnlyBySecondReading} stopped only by the independent second reading, ${s.notCaught} not caught.`)
		console.log(`Wrong amounts approved automatically: ${s.baselineWrongApprovals} with one agent, ${s.multiWrongApprovals} with five.\n`)
		for (const l of result.limitations) console.log(`  - ${l}`)
		process.exit(ok ? 0 : 1)
	}
} catch (err) {
	const error = err instanceof Error ? err.message : String(err)
	if (process.send) process.send({ type: "failed", error }, () => process.exit(1))
	else { console.error(error); process.exit(1) }
}
