#!/usr/bin/env node
/**
 * Checks this machine against what Payment Desk needs, and says what each finding means.
 *
 *   npm run doctor
 *
 * Only the first group is required. A missing API key or a missing Ollama is not a problem: the scripted demo needs
 * neither. No credential value is ever printed, only whether one is set. Exit code 1 only when the scripted demo cannot run.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { createServer } from "node:net"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const rows = []
const add = (group, ok, what, note) => rows.push({ group, ok, what, note })

// ---- required for the no-key scripted demo
const [maj, min] = process.versions.node.split(".").map(Number)
const nodeOk = (maj === 20 && min >= 19) || (maj === 22 && min >= 12) || maj > 22
add("required", nodeOk, `Node.js ${process.versions.node}`, nodeOk ? "supported (20.19+ or 22.12+)" : "needs Node 20.19+ or 22.12+")
add("required", existsSync(join(ROOT, "node_modules", "@mozaik-ai", "core")), "dependencies installed", existsSync(join(ROOT, "node_modules", "@mozaik-ai", "core")) ? "node_modules has @mozaik-ai/core" : "run: npm ci")
const count = (dir, ext) => { try { return readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext)).length } catch { return 0 } }
const docs = count("server/data/documents", ".txt"), pdfs = count("server/data/documents/pdf", ".pdf")
add("required", docs >= 16 && pdfs >= 8, "synthetic dataset", `${docs} text documents, ${pdfs} PDFs in server/data/documents`)
const free = (port) => new Promise((res) => { const s = createServer(); s.once("error", () => res(false)); s.once("listening", () => s.close(() => res(true))); s.listen(port, "127.0.0.1") })
const p8799 = await free(8799)
add("required", true, "port 8799 (npm run demo)", p8799 ? "free" : "in use: stop what is running there, or the demo is already running")

// ---- optional
add("optional", true, "UI build", existsSync(join(ROOT, "web", "dist", "index.html")) ? "web/dist exists" : "not built yet: npm run demo builds it")
add("optional", true, "Node 22+ for the browser checks", maj >= 22 ? "yes" : "no: npm run test:browser needs Node 22 or newer")
let ollama = "not reachable on http://127.0.0.1:11434: only needed for real local AI (npm run demo:local)"
try {
	const r = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1500) })
	if (r.ok) { const names = ((await r.json()).models ?? []).map((m) => m.name); ollama = names.length ? `running, ${names.length} model(s): ${names.slice(0, 6).join(", ")}${names.includes("qwen2.5:7b-instruct-12k") ? "" : ". The README's model alias qwen2.5:7b-instruct-12k is not there yet"}` : "running, no model pulled yet" }
} catch { /* not running: optional */ }
add("optional", true, "Ollama (real local AI)", ollama)
let env = {}
try { env = Object.fromEntries(readFileSync(join(ROOT, ".env"), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])) } catch { /* no .env: fine */ }
const has = (k) => Boolean(process.env[k] || env[k])
const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"].filter(has)
add("optional", true, "hosted model key (npm run dev)", keys.length ? `set: ${keys.join(", ")} (values not shown)` : "none set: not needed for the scripted demo or for local AI")

for (const g of ["required", "optional"]) {
	console.log(`\n${g === "required" ? "Required for the no-key demo" : "Optional"}`)
	for (const r of rows.filter((x) => x.group === g)) console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.what.padEnd(34)} ${r.note}`)
}
const bad = rows.filter((r) => r.group === "required" && !r.ok)
console.log(bad.length ? `\nNot ready: ${bad.map((b) => b.what).join("; ")}.` : "\nReady. Start with: npm run demo   then open http://localhost:8799")
process.exit(bad.length ? 1 : 0)
