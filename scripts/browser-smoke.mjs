#!/usr/bin/env node
/**
 * Browser smoke test for the interactive showcase. No test framework and no extra dependency: it starts the scripted
 * server, opens a headless Chrome over the DevTools protocol and walks the demo the way a judge would.
 *
 *   npm run build && npm run test:browser
 *
 * Needs Node 22 or newer (built-in WebSocket) and a Chrome, Chromium or Edge binary. Set CHROME_PATH if it is not found.
 * Every wait is a condition on the page, with a timeout; there is no fixed sleep between steps.
 * Exit code: 0 all checks passed, 1 a check failed, 2 the suite could not run (and says why).
 */
import { spawn, execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const cannot = (why) => { console.error(`NOT RUN: ${why}`); process.exit(2) }
if (typeof WebSocket === "undefined") cannot("this needs Node 22 or newer (built-in WebSocket).")
if (!existsSync(join(ROOT, "web", "dist", "index.html"))) cannot("the UI is not built. Run `npm run build` first.")

function findChrome() {
	if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : cannot(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`)
	const fixed = [
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	]
	for (const p of fixed) if (existsSync(p)) return p
	for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) { try { return execFileSync("which", [name], { encoding: "utf8" }).trim() } catch { /* not on the path */ } }
	// a browser that Playwright downloaded earlier, if there is one
	for (const cache of [join(homedir(), "Library", "Caches", "ms-playwright"), join(homedir(), ".cache", "ms-playwright")]) {
		if (!existsSync(cache)) continue
		for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium")).sort().reverse()) {
			for (const sub of readdirSync(join(cache, dir))) {
				for (const bin of ["chrome-headless-shell", "chrome", join("Chromium.app", "Contents", "MacOS", "Chromium")]) { const p = join(cache, dir, sub, bin); if (existsSync(p)) return p }
			}
		}
	}
	return null
}
const CHROME = findChrome() ?? cannot("no Chrome, Chromium or Edge was found. Set CHROME_PATH to a browser binary.")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const children = []
// Anything that stops the suite itself (as opposed to a failing check) is reported as "not run", with the reason.
process.on("uncaughtException", (e) => cannot(e?.message ?? String(e)))
process.on("unhandledRejection", (e) => cannot(e?.message ?? String(e)))
/** Starts the scripted server on a free port. A port that is taken, or a server that exits, is tried again on another port. */
async function startServer(env = {}) {
	let why = ""
	for (let attempt = 0; attempt < 3; attempt++) {
		const port = 8900 + Math.floor(Math.random() * 600)
		const p = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, API_PORT: String(port), DESK_SCRIPTED: "1", DESK_PERSIST: "off", LAB_PERSIST: "off", MOZAIK_CREDENTIALS_FILE: "/nonexistent/mozaik-credentials.json", MOZAIK_API_KEY: "", ...env } })
		children.push(p)
		let err = ""
		p.stderr.on("data", (d) => { err = (err + d).slice(-600) })
		for (let i = 0; i < 300 && p.exitCode == null; i++) {
			// the answer has to come from the process started here, not from something else that happens to hold the port
			try { const r = await fetch(`http://localhost:${port}/api/health`); if (r.ok && (await r.json()).mode === "scripted" && p.exitCode == null) return `http://localhost:${port}` } catch { /* not up yet */ }
			await sleep(100)
		}
		why = err.trim().split("\n").pop() || `no answer on port ${port} within 30 seconds`
		try { p.kill() } catch { /* already gone */ }
	}
	throw new Error(`the scripted server did not start (${why})`)
}

const profile = mkdtempSync(join(tmpdir(), "payment-desk-smoke-"))
const debugPort = 9400 + Math.floor(Math.random() * 500)
const chrome = spawn(CHROME, [...(CHROME.includes("headless-shell") ? [] : ["--headless=new"]), `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--window-size=1440,900", "about:blank"], { stdio: "ignore" })
children.push(chrome)
const cleanup = () => { for (const c of children) { try { c.kill() } catch { /* already gone */ } } try { rmSync(profile, { recursive: true, force: true }) } catch { /* the profile directory is temporary either way */ } }
process.on("exit", cleanup)

let target
for (let i = 0; i < 60 && !target; i++) { await sleep(150); try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === "page") } catch { /* not up yet */ } }
if (!target) cannot(`the browser at ${CHROME} did not open a debugging port.`)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let seq = 0
const pending = new Map()
const pageErrors = []
ws.onmessage = (m) => {
	const d = JSON.parse(m.data)
	if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
	if (d.method === "Runtime.exceptionThrown") pageErrors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)
}
const send = (method, params = {}) => new Promise((res, rej) => { const n = ++seq; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => pending.delete(n) && rej(new Error(`${method} got no answer`)), 20_000) })
await send("Page.enable"); await send("Runtime.enable")
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

const HELPERS = `const $ = (s) => document.querySelector(s); const $$ = (s) => [...document.querySelectorAll(s)]; const txt = (s) => $(s)?.textContent.replace(/\\s+/g, " ").trim() ?? null; const control = (t) => $$("button, a").find((b) => !b.disabled && b.textContent.replace(/\\s+/g, " ").trim().startsWith(t));`
async function page(expr) {
	const r = await send("Runtime.evaluate", { expression: `(() => { ${HELPERS} return (${expr}) })()`, returnByValue: true, awaitPromise: true })
	if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split("\n")[0] ?? "the page threw")
	return r.result?.result?.value
}
/** Polls a condition on the page until it holds. The description is what the failure message says was expected. */
async function until(expr, what, ms = 8000) {
	const started = Date.now()
	for (;;) { const v = await page(expr); if (v) return v; if (Date.now() - started > ms) throw new Error(`expected ${what}`); await sleep(60) }
}
/** Clicks the first enabled button or link whose text starts with the label, once it is on the page. */
const click = (label) => until(`(() => { const b = control(${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`, `an enabled control that starts with "${label}"`)
const open = async (url) => { await send("Page.navigate", { url }); await until(`document.readyState === "complete" && $(".view") != null`, "the app to render") }

let failed = 0, n = 0
async function check(name, fn) {
	n++
	try { await fn(); console.log(`ok ${n} - ${name}`) } catch (e) { failed++; console.log(`not ok ${n} - ${name}\n  ${e.message}`) }
}

// ───────── the scripted showcase, start to finish ─────────
const base = await startServer()

await check("the application starts and says what it is for", async () => {
	await open(`${base}/#/overview`)
	await until(`txt(".onboard h2") === "Every payment verified. Every decision accountable."`, "the opening statement on the overview")
	await until(`txt(".nav-env")?.includes("Sandbox")`, "the sandbox indicator")
	await until(`txt(".banner.warn")?.startsWith("Scripted demo: real orchestration, predefined model responses.")`, "the scripted banner on the workspace")
})
await check("navigation between pages works", async () => {
	await click("Payments"); await until(`location.hash === "#/inbox" && document.title.startsWith("Payments")`, "the Payments page")
	await click("Overview"); await until(`location.hash === "#/overview"`, "the Overview page")
})
await check("there is one way into the demo, and the mode is labelled as scripted, never as live", async () => {
	await until(`$$(".bar-actions .btn-primary").length === 1 && txt(".bar-actions .btn-primary") === "Start demo"`, "one Start demo action in the top bar")
	await click("Start demo")
	await until(`txt(".sc-hero h1") === "Every payment verified. Every decision accountable."`, "the showcase opening")
	await until(`txt(".sc-mode.current .tag") === "Scripted demo" && txt(".sc-mode.current b") === "Real orchestration, predefined model responses"`, "the scripted mode stated on the opening")
	if (await page(`$$(".tag").some((t) => t.textContent.trim() === "Live AI")`)) throw new Error("a scripted server labelled something as Live AI")
})
await check("scenario 1: the legitimate invoice is verified, and the outcome is the enforced one", async () => {
	await click("Start demo")
	await until(`txt(".sc-head h1") === "A payment that should proceed"`, "scenario 1")
	await until(`txt(".sc-top .tag") === "Scripted demo" && txt(".sc-top-id .fine") === "Real orchestration, predefined model responses."`, "the mode stated in the header of every scenario")
	await until(`txt(".verdict .what") === "Payment verified"`, "the verdict Payment verified")
	await until(`txt(".sc-check .status") === "Expected outcome confirmed"`, "the outcome check against the scenario file")
	await until(`txt(".law-gate.enforce .law-note") === "Auto-approved" || $(".law-mode.replay") != null`, "the agent workspace drawn from this run")
	await until(`$$(".sc-evidence .kv > div").some((d) => /Validator and Auditor ran at the same time for \\d+ ms/.test(d.textContent))`, "the recorded overlap of the two independent checks")
})
await check("scenario 2: the changed account is blocked, with both accounts sourced", async () => {
	await click("Next: Changed account")
	await until(`txt(".verdict .what") === "Payment blocked"`, "the verdict Payment blocked")
	await until(`$$(".compare > div").length === 2 && $$(".compare .evchip").length === 2 && $$(".compare mark").length > 0`, "the trusted and the incoming account side by side, each with a reference, the difference marked")
	await until(`txt(".sc-note")?.startsWith("Unverified beneficiary change")`, "the wording Unverified beneficiary change")
})
await check("scenario 3: two amounts are on record as a cross-check and the payment is held", async () => {
	await click("Next: Agents disagree")
	await until(`txt(".verdict .what") === "Held for a person"`, "the verdict Held for a person")
	await until(`$$(".compare .v").map((v) => v.textContent.trim()).join("|") === "1980.00|1890.00"`, "both amounts, 1980.00 and 1890.00")
})
await check("a figure opens at its source line", async () => {
	await page(`$(".compare .evchip").click()`)
	await until(`$(".drawer[data-open=true] .ln.hl")?.textContent.includes("please pay EUR 1,980.00")`, "line 7 of the document highlighted in the evidence drawer")
	await page(`$(".drawer[data-open=true] [aria-label=Close]").click()`)
	await until(`$(".drawer[data-open=true]") == null`, "the drawer to close")
})
await check("the agent challenge is inspectable, with both sides and its status", async () => {
	await click("Inspect agent challenge")
	await until(`(() => { const x = txt(".drawer[data-open=true] .xcheck"); return x && x.includes("1980.00") && x.includes("1890.00") && x.includes("Needs a person") && x.includes("raised by the Auditor") })()`, "the cross-check with 1980.00 against 1890.00, raised by the Auditor, waiting for a person")
	await page(`$(".drawer[data-open=true] [aria-label=Close]").click()`)
})
await check("scenario 4 and the summary: every result comes from a case", async () => {
	await click("Next: Duplicate payment")
	await until(`txt(".verdict .what") === "Duplicate payment blocked"`, "the verdict Duplicate payment blocked")
	await until(`$$(".sc-evidence .kv > div").some((d) => d.textContent.includes("H-0001"))`, "the payment history record H-0001 cited")
	await click("See the summary")
	await until(`txt(".sc-head h1") === "Your financial decisions, verified."`, "the summary")
	const rows = await page(`$$(".grid-table .tr:not(.h)").map((r) => [...r.children].map((c) => c.textContent.trim()).join(" / "))`)
	const want = ["Legitimate invoice / Auto-approved / Auto-approved / Expected outcome confirmed", "Changed account / Blocked / Blocked / Expected outcome confirmed", "Agents disagree / Needs approval or Blocked / Needs approval / Expected outcome confirmed", "Duplicate payment / Blocked / Blocked / Expected outcome confirmed", "Prompt injection / Needs approval / none / Not executed (optional)"]
	if (JSON.stringify(rows) !== JSON.stringify(want)) throw new Error(`summary rows were ${JSON.stringify(rows)}`)
})
await check("the blocked payment has no approve action in the workspace", async () => {
	await open(`${base}/#/inbox/INV-ES-55820`)
	await until(`txt(".verdict .what") === "Blocked"`, "the payment shown as Blocked")
	if (await page(`control("Approve payment") != null || control("Resolve and approve") != null`)) throw new Error("a blocked payment offers an approve action")
})
await check("the execution proof opens in Agent Activity", async () => {
	await open(`${base}/#/activity/INV-2026-1049/details`)
	await until(`$$(".sec-title h2").some((h) => h.textContent === "Execution timeline") && $$(".grid-table .tr:not(.h)").length >= 5`, "the execution timeline and the loop table")
})
await check("leaving the demo returns to the workspace, and the way back says where the demo stands", async () => {
	await open(`${base}/#/showcase`)
	await click("Exit demo")
	await until(`location.hash === "#/overview" && txt(".bar-actions .btn-primary") === "Demo summary"`, "the overview with a Demo summary action")
	await until(`$$(".metric").length === 4`, "the workspace figures for the demo payments")
})
await check("the appearance switches between dark and light", async () => {
	const ink = `getComputedStyle(document.body).color`
	const before = await page(ink)
	await page(`$(".bar-actions [aria-label^='Switch to the']").click()`)
	await until(`${ink} !== ${JSON.stringify(before)} && ["light", "dark"].includes(document.documentElement.dataset.theme)`, "a different text colour and an explicit theme")
	await page(`$(".bar-actions [aria-label^='Switch to the']").click()`)
	await until(`${ink} === ${JSON.stringify(before)}`, "the first appearance again")
})
await check("the recorded execution is labelled as recorded and offers nothing to run", async () => {
	await open(`${base}/#/showcase/recorded`)
	await until(`txt(".sc-top .tag") === "Recorded execution" && txt(".sc-top-id .fine")?.includes("replay only")`, "the Recorded execution label")
	await until(`$$(".sc-step").some((s) => s.dataset.result === "failed")`, "the scenarios that did not finish in that run shown as such")
	if (await page(`control("Run this scenario") != null || control("Restart") != null`)) throw new Error("the recorded view offers to run something")
	await page(`$$(".sc-step")[2].click()`)
	await until(`txt(".verdict .what") === "Held for a person" && $$(".sc-runs .runs li").length === 5`, "the recorded outcome and its five agent loops")
	await until(`$$(".sc-runs .runs li").every((l) => /claude-/.test(l.textContent) && /tokens/.test(l.textContent))`, "live model names and reported token usage on every recorded loop")
})

// ───────── a provider that refuses every call (fault injection, labelled as such) ─────────
const broken = await startServer({ DESK_SCRIPTED_FAULT: "insufficient_credit" })
await check("a provider failure is shown as a failure: banner, failed scenario, nothing confirmed", async () => {
	await open(`${broken}/#/showcase`)
	await click("Start demo")
	await until(`txt(".verdict .what") === "This scenario did not finish"`, "the scenario reported as not finished")
	await until(`txt(".banner.bad")?.includes("The model provider is refusing calls: insufficient credit.")`, "the provider failure banner")
	await until(`txt(".sc-check .status") === "Execution failure" && $(".sc-step").dataset.result === "failed"`, "the scenario marked as an execution failure")
	await until(`txt(".verdict .errbox")?.includes("credit balance is too low")`, "the provider's own error text")
	if (await page(`control("Next:") != null && $$(".sc-step").some((s) => s.dataset.result === "confirmed")`)) throw new Error("something was marked confirmed")
	await until(`control("Run this scenario again") != null`, "a way to run the scenario again")
	const state = await (await fetch(`${broken}/api/state`)).json()
	if (state.cases.some((c) => c.stage === "approved" || c.draft)) throw new Error("a failed run left an approval or a draft")
})

await check("no uncaught error was thrown on any page", async () => { if (pageErrors.length) throw new Error(pageErrors.slice(0, 3).join(" | ")) })

ws.close()
console.log(`\n${n - failed} of ${n} browser checks passed${failed ? `, ${failed} failed` : ""}.`)
process.exit(failed ? 1 : 0)
