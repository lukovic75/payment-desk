/**
 * Headless live run: sends the synthetic scenario documents through the real Mozaik workflow with a real model,
 * prints each agent step, then checks every outcome against server/data/scenarios.json.  `npm run cli`
 * This costs model tokens. The automated tests (`npm test`) use a scripted model and cost nothing.
 */
import "dotenv/config"

process.env.DESK_PERSIST = "off"
const { MODELS, runDemo, snapshot, subscribe, whenSettled } = await import("./desk.js")
const { outcomeOf } = await import("./domain.js")
const { formatMinor } = await import("./money.js")

if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
	console.error("No model API key found. Copy .env.example to .env and set ANTHROPIC_API_KEY (or OPENAI_API_KEY / GEMINI_API_KEY).")
	process.exit(1)
}
process.on("unhandledRejection", (err) => console.error("unhandled rejection in an agent loop:", err))

const t0 = Date.now()
const ms = () => `${String(Date.now() - t0).padStart(6)} ms`
subscribe((e) => {
	if (e.type !== "timeline") return
	const p = e.payload as { caseId: string; agent: string; kind: string; detail: string }
	if (p.kind !== "inference") console.log(`${ms()}  ${p.caseId.padEnd(18)} ${p.agent.padEnd(13)} ${p.detail.split("\n")[0]!.slice(0, 150)}`)
})

console.log(`Payment Desk live run · fast=${MODELS.fast} careful=${MODELS.careful}\n`)
runDemo()
await whenSettled(300_000)

const s = snapshot()
console.log(`\nSettled in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`)
console.log("case".padEnd(18) + "outcome".padEnd(19) + "expected".padEnd(28) + "amount".padStart(14) + "  failing or review controls")
let ok = 0
for (const sc of s.scenarios) {
	const c = s.cases.find((k) => k.id === sc.docId)
	const got = c ? outcomeOf(c) : "MISSING"
	const pass = sc.expect.includes(got)
	if (pass) ok++
	const flagged = c ? c.controls.filter((k) => k.status === "fail" || k.status === "review").map((k) => k.id).join(", ") : ""
	console.log(`${pass ? "✓" : "✗"} ${sc.docId.padEnd(16)}${got.padEnd(19)}${sc.expect.join(" | ").padEnd(28)}${(c?.exposure ? formatMinor(c.exposure.minor, c.exposure.currency) : "-").padStart(14)}  ${flagged}`)
}
const loops = s.cases.flatMap((c) => c.runs)
const tokens = loops.reduce((n, r) => n + (r.tokens ? r.tokens.input + r.tokens.output : 0), 0)
console.log(`\n${ok}/${s.scenarios.length} scenarios as expected · ${loops.length} agent loops · ${tokens.toLocaleString()} tokens reported by the provider`)
process.exit(ok === s.scenarios.length ? 0 : 2)
