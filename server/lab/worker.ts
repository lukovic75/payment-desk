/**
 * One stress scenario in its own process: its own Mozaik runtime, its own desk state, no persistence.
 * That is the isolation. Nothing a scenario does can reach the payment inbox, the approval totals or the saved state of the app.
 */
import "dotenv/config"
import type { Configuration } from "../domain.js"
import type { LabMode } from "./run.js"

type Job = { scenarioId: string; mode: LabMode; config: Configuration; timeoutMs: number }
const job = JSON.parse(process.argv[2] ?? "{}") as Job
process.env.DESK_PERSIST = "off"
if (job.mode === "scripted") {
	// Scripted runs are not sent to Mozaik Cloud, even on a paired machine.
	process.env.MOZAIK_CREDENTIALS_FILE = "/nonexistent/mozaik-credentials.json"
	delete process.env.MOZAIK_API_KEY
	for (const k of ["log", "warn", "error", "info"] as const) { const real = console[k].bind(console); console[k] = (...a: unknown[]) => { if (!String(a[0] ?? "").startsWith("mozaik cloud:")) real(...a) } }
}
process.on("unhandledRejection", (err) => console.error("lab worker: unhandled rejection in an agent loop:", err))

const { scenarioById } = await import("./scenarios.js")
const { runScenario } = await import("./run.js")
const scenario = scenarioById(job.scenarioId)
if (!scenario) { process.send?.({ type: "failed", error: `unknown scenario ${job.scenarioId}` }); process.exit(1) }

try {
	const result = await runScenario(scenario, { mode: job.mode, config: job.config, timeoutMs: job.timeoutMs, onProgress: (cases) => process.send?.({ type: "progress", cases }) })
	process.send?.({ type: "result", result }, () => process.exit(0))
} catch (err) {
	process.send?.({ type: "failed", error: err instanceof Error ? err.message : String(err) }, () => process.exit(1))
}
