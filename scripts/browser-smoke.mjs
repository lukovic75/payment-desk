#!/usr/bin/env node
/**
 * Browser smoke test for the interactive showcase and for PDF intake. No test framework and no extra dependency: it
 * starts the scripted server, opens a headless Chrome over the DevTools protocol and walks the demo the way a judge would.
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
const cleanup = () => { for (const c of children) { try { c.kill() } catch { /* already gone */ } } try { rmSync(profile, { recursive: true, force: true }) } catch { /* the profile directory is temporary either way */ } }
process.on("exit", cleanup)

/** Starts the browser and waits for its debugging port. A browser that is slow to come up is given one more start on another port. */
let target
for (let attempt = 0; attempt < 2 && !target; attempt++) {
	const debugPort = 9400 + Math.floor(Math.random() * 500)
	const chrome = spawn(CHROME, [...(CHROME.includes("headless-shell") ? [] : ["--headless=new"]), `--remote-debugging-port=${debugPort}`, `--user-data-dir=${join(profile, String(attempt))}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--window-size=1440,900", "about:blank"], { stdio: "ignore" })
	children.push(chrome)
	for (let i = 0; i < 100 && !target && chrome.exitCode == null; i++) { await sleep(150); try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === "page") } catch { /* not up yet */ } }
	if (!target) { try { chrome.kill() } catch { /* already gone */ } }
}
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

await check("the application starts and says what it is for, to whom, with one headline", async () => {
	await open(`${base}/#/overview`)
	await until(`txt(".page-head h1") === "AI investigates. Code decides." && txt(".page-kicker") === "Accounts payable workspace"`, "the product statement and who it is for")
	await until(`$$(".view h1, .view h2").filter((h) => h.getBoundingClientRect().height > 0).length === 1`, "one headline on the empty overview, not two")
	await until(`txt(".nav-env")?.includes("Sandbox")`, "the sandbox indicator")
})
await check("an empty desk shows one way into the demo and labelled examples, and counts none of them", async () => {
	const entries = await page(`$$("a, button").filter((b) => b.getBoundingClientRect().height > 0 && /^(Start demo|Continue demo|Demo summary)$/.test(b.textContent.replace(/\\s+/g, " ").trim())).length`)
	if (entries !== 1) throw new Error(`${entries} demo entry points are visible on the empty overview`)
	await until(`$$(".view .btn-primary").length === 1 && txt(".view .btn-primary") === "Start demo" && control("Add document") != null`, "one primary action and one secondary one")
	await until(`txt(".onboard-preview figcaption")?.includes("Illustrative examples") && $$(".onboard-preview li").length === 3 && txt(".onboard-preview")?.includes("examples, not payments")`, "three outcomes shown as labelled examples")
	if (await page(`$$(".metric").length`)) throw new Error("financial figures are shown for a desk with nothing on it")
	const state = await (await fetch(`${base}/api/state`)).json()
	if (state.cases.length !== 0 || state.dailyAutoApproved !== 0) throw new Error("the examples reached the desk state")
})
await check("the execution mode is always on screen, calmly, with its explanation one press away", async () => {
	if (await page(`$(".banner.warn") != null`)) throw new Error("a warning banner is shown for an ordinary scripted run")
	await until(`txt(".mode-chip b") === "Scripted demo" && txt(".mode-chip")?.includes("predefined AI responses")`, "the mode in the top bar")
	await page(`$(".mode-chip").click()`)
	await until(`txt(".mode-pop")?.includes("not live AI") && $(".mode-chip").getAttribute("aria-expanded") === "true"`, "the full explanation")
	await page(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`)
	await until(`$(".mode-pop") == null`, "the explanation to close on Escape")
})
await check("the sidebar is grouped by intent and every place says what it is for", async () => {
	const labels = await page(`$$(".nav .nav-groups .nav-label, .nav .nav-groups .nav-item").map((e) => e.textContent.replace(/\\s+/g, " ").trim())`)
	const want = ["Workspace", "Overview", "Payments", "Review queue", "Intelligence", "Agent activity", "Payment risks", "Verification", "Evidence & audit", "Stress lab"]
	if (JSON.stringify(labels) !== JSON.stringify(want)) throw new Error(`the sidebar reads ${JSON.stringify(labels)}`)
	if (!(await page(`$$(".nav .nav-groups .nav-item").every((a) => (a.getAttribute("aria-description") ?? "").length > 12 && a.dataset.about === a.getAttribute("aria-description"))`))) throw new Error("a navigation item has no description")
	// the old addresses still open the same places
	for (const [hash, title] of [["#/firewall", "Payment risks"], ["#/lab", "Stress lab"], ["#/audit", "Evidence & audit"], ["#/activity", "Agent activity"], ["#/queue", "Review queue"]]) { await open(`${base}/${hash}`); await until(`document.title.startsWith(${JSON.stringify(title)})`, `${hash} to open ${title}`) }
	await open(`${base}/#/overview`)
})
await check("navigation between pages works", async () => {
	await click("Payments"); await until(`location.hash === "#/inbox" && document.title.startsWith("Payments")`, "the Payments page")
	await click("Overview"); await until(`location.hash === "#/overview"`, "the Overview page")
})
await check("there is one way into the demo, and the mode is labelled as scripted, never as live", async () => {
	await until(`$$(".btn-primary").filter((b) => b.getBoundingClientRect().height > 0).length === 1 && txt(".view .btn-primary") === "Start demo"`, "one Start demo action on the empty overview, in the page")
	await click("Start demo")
	await until(`txt(".sc-hero h1") === "AI investigates. Code decides."`, "the showcase opening")
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
/** The marker over a cited line: inside the page, with a size, and over a canvas that has something drawn on it. */
const MARKED = (scope) => `(() => { const h = $("${scope} .pdf-hl"), s = $("${scope} .pdf-sheet"), c = $("${scope} .pdf canvas"); if (!h || !s || !c || $("${scope} .pdf-frame")?.dataset.state !== "ready") return false; const a = h.getBoundingClientRect(), b = s.getBoundingClientRect(); if (!(a.width > 20 && a.height > 3 && a.left >= b.left && a.right <= b.right + 1 && a.top >= b.top && a.bottom <= b.bottom + 1)) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let ink = 0; for (let i = 0; i < d.length; i += 64) if (d[i] < 160) ink++; return ink > 20 })()`
await check("the same figures open on their page of the original PDF, each marked where the parser found it", async () => {
	await until(`txt(".sc-evidence")?.includes("INV-2026-1049.pdf") || $$(".panel-head .right").some((r) => r.textContent.includes("INV-2026-1049.pdf · PDF, 2 pages"))`, "the scenario document named as a two-page PDF")
	await until(`$$(".compare .k").map((k) => k.textContent.trim()).join("|") === "Page 1, line 5 of the PDF|Page 2, line 12 of the PDF"`, "each amount labelled with its page and line")
	await page(`$$(".compare .evchip")[0].click()`)
	await until(`$(".drawer[data-open=true]")?.hasAttribute("data-wide") && txt(".drawer[data-open=true] .pdf-page") === "Page 1 of 2"`, "the evidence drawer on page 1 of 2")
	await until(MARKED(".drawer[data-open=true]"), "the page drawn and the line marked inside it", 15_000)
	await page(`$(".drawer[data-open=true] [aria-label=Close]").click()`)
	await until(`$(".drawer[data-open=true]") == null`, "the drawer to close")
	await page(`$$(".compare .evchip")[1].click()`)
	await until(`txt(".drawer[data-open=true] .pdf-page") === "Page 2 of 2" && $(".drawer[data-open=true] .ln.hl")?.textContent.includes("TOTAL EUR 1,890.00")`, "page 2 of 2 and the total line quoted")
	await until(MARKED(".drawer[data-open=true]"), "the total marked on page 2", 15_000)
	await page(`$(".drawer[data-open=true] [aria-label='Previous page']").click()`)
	await until(`txt(".drawer[data-open=true] .pdf-page") === "Page 1 of 2" && $(".drawer[data-open=true] .pdf-frame")?.dataset.state === "ready" && $(".drawer[data-open=true] .pdf-hl") == null`, "no marker on a page the evidence is not on")
	await page(`$(".drawer[data-open=true] [aria-label=Close]").click()`)
	await until(`$(".drawer[data-open=true]") == null`, "the drawer to close")
})
await check("leaving the showcase and coming back returns to the scenario that was on screen, and runs nothing", async () => {
	const before = await (await fetch(`${base}/api/state`)).json()
	await click("Payments")
	await until(`location.hash === "#/inbox"`, "another page")
	await page(`$$(".bar-actions a").find((a) => /Continue demo|Demo summary/.test(a.textContent)).click()`)
	await until(`location.hash === "#/showcase" && txt(".sc-head h1") === "Two agents find two different amounts" && txt(".verdict .what") === "Held for a person"`, "scenario 3 again, not the next one that has not run")
	if (await page(`control("Run this scenario") != null`)) throw new Error("the showcase came back on a scenario that has not run")
	await send("Page.reload")
	await until(`document.readyState === "complete" && txt(".sc-head h1") === "Two agents find two different amounts"`, "the same scenario after a reload")
	const after = await (await fetch(`${base}/api/state`)).json()
	const runs = (s) => s.cases.map((c) => `${c.id}:${c.runs.length}:${c.version}`).sort().join(",")
	if (runs(before) !== runs(after)) throw new Error("navigating away and back changed a case or started a run")
	if (JSON.stringify(before.showcase.steps.map((x) => x.result)) !== JSON.stringify(after.showcase.steps.map((x) => x.result))) throw new Error("navigating changed a scenario result")
})
await check("the agent challenge is inspectable, with both sides and its status", async () => {
	await click("Inspect agent challenge")
	await until(`(() => { const x = txt(".drawer[data-open=true] .xcheck"); return x && x.includes("1980.00") && x.includes("1890.00") && x.includes("Needs a person") && x.includes("raised by the Auditor") })()`, "the cross-check with 1980.00 against 1890.00, raised by the Auditor, waiting for a person")
	await page(`$(".drawer[data-open=true] [aria-label=Close]").click()`)
})
/** Types into a controlled input the way a person would: the value, then the event the framework listens for. */
const fill = (selector, value) => until(`(() => { const el = $(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true })()`, `the field ${selector}`)
await check("the held payment is resolved with a vendor confirmation: a wrong record is refused, the right one is matched, a person approves", async () => {
	if (await page(`control("Resolve and approve") != null`)) throw new Error("an approval is offered before anything is resolved")
	await fill(".sc-act input[placeholder^='VC']", "VC-2026-1126-03")
	await click("Verify payable amount")
	await until(`txt(".sc-act .errbox")?.includes("on record as unverified")`, "the unverified record refused, with the reason")
	await fill(".sc-act input[placeholder^='VC']", "VC-2026-1126-02")
	await click("Verify payable amount")
	await until(`txt(".sc-act .errbox")?.includes("is not a confirmation on record for invoice INV-2026-1049")`, "another vendor's record refused")
	await fill(".sc-act input[placeholder^='VC']", "VC-2026-1126-01")
	await click("Verify payable amount")
	await until(`txt(".sc-resolve-state")?.includes("matches this vendor, this invoice and the amount this payment would pay")`, "the confirmation matched")
	await until(`$$(".sc-evidence .kv > div").some((d) => d.textContent.includes("Matched to a vendor confirmation on record"))`, "the cross-check shown as matched to a record")
	await until(`txt(".sc-check .status") === "Expected outcome confirmed"`, "the scenario result unchanged: it is what the workflow decided")
	await click("Approve payment")
	await until(`txt(".sc-resolve-state")?.includes("Approved by a person on vendor confirmation") && /Sandbox draft PD-/.test(txt(".sc-resolve-state"))`, "the approval, citing the confirmation, with a sandbox draft")
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
await check("the agent inspector names what its loops ran on: the scripted fixture, not a configured model", async () => {
	await open(`${base}/#/activity/INV-2026-1049`)
	await page(`$$(".view [role=tab], .view button").find((b) => b.textContent.trim() === "Workspace")?.click()`)
	await until(`$$(".law-stage g.orb").length === 5`, "the five agents in the workspace")
	await page(`$$(".law-stage g.orb").find((g) => /Auditor/.test(g.getAttribute("aria-label") || "")).dispatchEvent(new MouseEvent("click", { bubbles: true }))`)
	await until(`(() => { const t = txt(".drawer[data-open=true]"); return t && t.includes("Auditor") && /Model\\s*scripted fixture/.test(t) && t.includes("none: predefined responses, no model was called") })()`, "the inspector showing the scripted fixture and no token usage")
	if (await page(`/claude-|gemini-|gpt-/.test(txt(".drawer[data-open=true]") ?? "")`)) throw new Error("the inspector names a model that did not run")
	await page(`$(".drawer[data-open=true] [aria-label=Close]").click()`)
})
await check("two amounts in one document: the workspace offers a vendor confirmation and a rejection, not an approval on a statement", async () => {
	await open(`${base}/#/inbox`)
	await page(`$$(".bar-actions .btn").find((b) => (b.getAttribute("aria-label") || b.textContent).includes("ocument")).click()`)
	await until(`txt("dialog[open] h2") === "Add documents"`, "the Add documents dialog")
	await click("Conflicting amounts, two pages")
	await until(`$$("dialog[open] .queue-row").some((r) => /Ready/.test(r.textContent))`, "the two-page sample parsed", 15_000)
	await page(`$("dialog[open] .btn-primary").click()`)
	await until(`location.hash === "#/inbox/INV-2026-1064" && $("dialog[open]") == null`, "the payment opened", 20_000)
	await until(`txt(".verdict")?.includes("The only way to release this payment")`, "the rule stated in the review form", 15_000)
	if (await page(`control("Resolve and approve") != null || control("Approve payment") != null`)) throw new Error("an approval is offered for a document that states two payable amounts")
	await until(`control("Reject") != null && $$(".verdict button").some((b) => b.textContent.trim() === "Verify payable amount")`, "a rejection and a confirmation field")
	const r = await (await fetch(`${base}/api/cases/INV-2026-1064/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "approve", reason: "the vendor told me on the phone which amount is right" }) })).json()
	if (!/two payable amounts/.test(r.error ?? "")) throw new Error(`a written statement was not refused by the server: ${JSON.stringify(r).slice(0, 160)}`)
})
await check("leaving the demo returns to the workspace, and the way back says where the demo stands", async () => {
	await open(`${base}/#/showcase`)
	await click("Exit demo")
	await until(`location.hash === "#/overview" && $$(".bar-actions a").some((a) => a.textContent.trim() === "Demo summary")`, "the overview with a Demo summary action")
	await until(`$$(".view h1").length === 1 && /need(s)? your decision|Nothing is waiting for you/.test(txt(".page-head h1"))`, "one headline that says what there is to do")
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

// ───────── document intake: PDFs are parsed here, shown as they are, and processed only when asked ─────────
const openIntake = async () => {
	await page(`$$(".bar-actions .btn").find((b) => (b.getAttribute("aria-label") || b.textContent).includes("ocument")).click()`)
	await until(`txt("dialog[open] h2") === "Add documents"`, "the Add documents dialog")
}
const queue = `$$("dialog[open] .queue-row").map((r) => r.textContent.replace(/\\s+/g, " ").trim())`
const onDesk = async (id) => (await (await fetch(`${base}/api/state`)).json()).cases.some((c) => c.id === id)
await check("Add documents: a sample PDF is validated and parsed, previewed as the original, and nothing runs until Process", async () => {
	await open(`${base}/#/inbox`)
	await openIntake()
	await until(`txt("dialog[open] .drop-copy")?.includes("there is no OCR")`, "the supported formats and the absence of OCR stated")
	await click("Valid invoice")
	await until(`${queue}.length === 1 && /^INV-2026-1062\\.pdf\\s*PDF · \\d+ kB · 1 page · \\d+ lines of text\\s*Ready/.test(${queue}[0])`, "the sample in the queue as a parsed one-page PDF, ready", 15_000)
	if (await onDesk("INV-2026-1062")) throw new Error("the document was processed before anyone asked")
	await page(`$("dialog[open] .queue-row .queue-act .btn").click()`)
	await until(`txt("dialog[open] .pdf-page") === "Page 1 of 1" && $("dialog[open] .pdf-frame")?.dataset.state === "ready"`, "the original page in the preview", 15_000)
})
await check("a file that is not a document is refused, and one that is not a registered fixture is parsed but not interpreted", async () => {
	await page(`(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0])], "setup.exe", { type: "application/octet-stream" })); dt.items.add(new File(["%PDF-1.4\\nnot a document"], "broken.pdf", { type: "application/pdf" })); dt.items.add(new File(["Invoice 77 from Somebody Ltd\\nTotal EUR 12.00\\nIBAN: GB00 TEST"], "note.txt", { type: "text/plain" })); const i = $("dialog[open] input[type=file]"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); return true })()`)
	await until(`${queue}.some((r) => r.startsWith("setup.exe") && r.includes("Not accepted") && r.includes("not a text document or a PDF"))`, "the executable refused, with the reason", 15_000)
	await until(`${queue}.some((r) => r.startsWith("broken.pdf") && r.includes("Not accepted") && r.includes("could not be parsed as a valid PDF"))`, "the broken PDF refused, with the reason", 15_000)
	await until(`${queue}.some((r) => r.startsWith("note.txt") && r.includes("Parsed, not processable here") && r.includes("Live AI access is required to interpret this invoice because it is not a registered scripted fixture."))`, "the unregistered document parsed and honestly not interpreted", 15_000)
	await until(`txt("dialog[open] .btn-primary") === "Process document" && !$("dialog[open] .btn-primary").disabled`, "one document offered for processing, not four")
})
await check("processing the sample PDF runs the workflow, and its evidence opens on the page", async () => {
	await page(`$("dialog[open] .btn-primary").click()`)
	await until(`${queue}.some((r) => r.startsWith("INV-2026-1062.pdf") && r.includes("Approved") && r.endsWith("Open"))`, "the sample processed and approved by the controls", 20_000)
	if (await onDesk("note") || (await (await fetch(`${base}/api/state`)).json()).cases.some((c) => /setup|broken|note/.test(c.fileName ?? ""))) throw new Error("a refused or uninterpreted file became a payment")
	await page(`$$("dialog[open] .queue-row").find((r) => r.textContent.includes("INV-2026-1062")).querySelector(".queue-act .btn").click()`)
	await until(`location.hash === "#/inbox/INV-2026-1062" && $("dialog[open]") == null`, "the payment opened in the workspace")
	await page(`$$("[role=tab]").find((b) => b.textContent.startsWith("Evidence")).click()`)
	await until(`$$(".doc-switch .seg button").map((b) => b.textContent.trim()).join("|") === "Original PDF|Extracted text" && $(".ev-doc .pdf-frame")?.dataset.state === "ready"`, "the original PDF beside the evidence ledger", 15_000)
	await page(`$$(".ledger-row").find((b) => b.textContent.startsWith("Gross amount as read by the Extractor")).click()`)
	await until(`/^page 1, line \\d+$/.test(txt(".ev-doc .block-h .right") ?? "")`, "the cited page and line named")
	await until(MARKED(".ev-doc"), "the gross amount marked on the page", 15_000)
	await page(`$$(".doc-switch .seg button")[1].click()`)
	await until(`$(".ev-doc .pdf") == null && $(".ev-doc .ln.hl")?.textContent.includes("1,005.00")`, "the same line in the extracted text")
})
await check("the same PDF again is reported as a duplicate before it is processed", async () => {
	await openIntake()
	await click("Valid invoice")
	await until(`${queue}.some((r) => r.includes("Duplicate detected") && r.includes("The same file is already on the desk as INV-2026-1062"))`, "the duplicate named, with the payment it repeats", 15_000)
	await page(`$("dialog[open] [aria-label=Close]").click()`)
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
