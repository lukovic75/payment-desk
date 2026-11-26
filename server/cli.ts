/** Headless run: processes the inbox, prints what each agent found, exits. `npm run cli` */
import { isSettled, runDesk, snapshot, subscribe, MODELS } from "./desk.js"

if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
	console.error("No model API key found. Copy .env.example to .env and set ANTHROPIC_API_KEY (or OPENAI_API_KEY / GEMINI_API_KEY).")
	process.exit(1)
}

const t0 = Date.now()
const ms = () => `${String(Date.now() - t0).padStart(6)} ms`
subscribe((e) => {
	if (e.type === "timeline") {
		const p = e.payload as { caseId: string; agent: string; kind: string; detail: string }
		if (p.kind !== "inference") console.log(`${ms()}  ${p.caseId.padEnd(22)} ${p.agent.padEnd(11)} ${p.detail.split("\n")[0]}`)
	}
})

console.log(`Payment Desk · models: fast=${MODELS.fast} careful=${MODELS.careful}\n`)
runDesk()

const timer = setInterval(() => {
	if (!isSettled()) return
	clearInterval(timer)
	const s = snapshot()
	console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`)
	console.log("case".padEnd(24) + "stage".padEnd(19) + "amount".padStart(11) + "  creditor / route")
	for (const c of s.cases) {
		const x = c.extraction.result
		const amt = x?.amount != null ? `${x.amount.toFixed(2)} ${x.currency ?? ""}` : "-"
		const d = c.decision.result
		console.log(c.id.padEnd(24) + c.stage.padEnd(19) + amt.padStart(11) + "  " + (x?.creditorName ?? x?.documentKind ?? "-") + (d ? ` → ${d.route}${d.overriddenFrom ? ` (guard raised from ${d.overriddenFrom})` : ""}: ${[...d.guardReasons, ...d.reasons].join("; ") || "within policy"}` : "") + (c.extraction.error ?? c.validation.error ?? c.audit.error ?? c.decision.error ? `  ERROR: ${c.extraction.error ?? c.validation.error ?? c.audit.error ?? c.decision.error}` : ""))
	}
	process.exit(0)
}, 500)
