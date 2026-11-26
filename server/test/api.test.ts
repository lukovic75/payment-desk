/**
 * The API under hostile and careless use: bad input, wrong state, requests that race, a run started twice, a restart.
 * The real server process, scripted model, real Mozaik workflow. Nothing here goes through the UI, because a rule that
 * only the UI enforces is not a rule.
 */
import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PORT = 20000 + Math.floor(Math.random() * 2000)
const B = `http://127.0.0.1:${PORT}`
const TMP = mkdtempSync(join(tmpdir(), "payment-desk-"))
const STATE = join(TMP, "state.json")
let server: ChildProcess

const start = async (persist: boolean) => {
	server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, API_PORT: String(PORT), DESK_SCRIPTED: "1", DESK_PERSIST: persist ? "on" : "off", DESK_STATE_FILE: STATE, LAB_PERSIST: "off", MOZAIK_CREDENTIALS_FILE: "/nonexistent/mozaik-credentials" } })
	await until(async () => { try { return (await get("/api/health")).body.ok } catch { return false } })
}
const stop = async () => { server?.kill("SIGKILL"); await new Promise((r) => setTimeout(r, 250)) }
const raw = (path: string, init?: RequestInit) => fetch(B + path, init)
const get = async (path: string) => { const r = await raw(path); return { status: r.status, body: await r.json() as any, headers: r.headers } }
const post = async (path: string, body?: unknown) => { const r = await raw(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() as any } }
const send = async (path: string, body: string) => { const r = await raw(path, { method: "POST", headers: { "content-type": "application/json" }, body }); return { status: r.status, body: await r.json() as any } }
const until = async <T>(fn: () => Promise<T | null | false | undefined>, ms = 30_000): Promise<T> => {
	const end = Date.now() + ms
	for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 100)) }
}
const RUNNING = ["received", "extracting", "checking", "investigating", "deciding"]
const settled = () => until(async () => { const s = (await get("/api/state")).body; return s.cases.length > 0 && s.cases.every((c: any) => !RUNNING.includes(c.stage)) && s })
const caseOf = async (id: string) => (await get("/api/state")).body.cases.find((c: any) => c.id === id)
const outcome = (c: any) => (c.stage === "approved" ? "AUTO_APPROVED" : c.stage === "awaiting_approval" ? "NEEDS_APPROVAL" : c.stage === "blocked" ? "BLOCKED" : c.stage === "not_a_payment" ? "NOT_A_PAYMENT" : "PROCESSING_ERROR")

before(() => start(true))
after(async () => { await stop(); rmSync(TMP, { recursive: true, force: true }) })

test("API: malformed requests are refused with a clear 4xx, never a 500", async () => {
	for (const [label, body] of [["null", "null"], ["a number", "7"], ["a string", '"approve"'], ["an array", "[]"]] as const) {
		const r = await send("/api/cases/INV-2026-1041/actions", body)
		assert.equal(r.status, 400, `a body that is ${label}`)
		assert.ok(r.body.error)
	}
	assert.equal((await send("/api/cases/INV-2026-1041/actions", "{not json")).status, 400)
	assert.equal((await post("/api/cases/INV-2026-1041/actions", { action: "launch_missiles" })).status, 400)
	assert.equal((await post("/api/cases/NOPE/actions", { action: "approve" })).status, 404)
	assert.equal((await get("/api/cases/NOPE/draft")).status, 404)
	assert.equal((await get("/api/cases/%E0%A4%A/draft")).status, 400, "a malformed percent-escape is a bad request")
	assert.equal((await send("/api/cases/%E0%A4%A/actions", "{}")).status, 400)
	assert.equal((await get("/api/documents/%E0%A4%A")).status, 400)
	assert.equal((await get("/api/documents/NOPE")).status, 404)
	assert.equal((await get("/api/run")).status, 404, "a GET cannot start a run")
	assert.equal((await get("/api/nope")).status, 404)
	const big = await send("/api/documents", JSON.stringify({ name: "big", text: "x".repeat(260_000) }))
	assert.equal(big.status, 413)
})

test("API: document intake fails safely on bad uploads and never invents a payment", async () => {
	assert.equal((await post("/api/documents", { name: "empty", text: "" })).status, 400)
	assert.equal((await post("/api/documents", { name: "short", text: "pay me" })).status, 400)
	assert.equal((await post("/api/documents", { name: "notext", text: 12345 })).status, 400)
	assert.equal((await post("/api/documents", { name: "binary", text: `%PDF-1.7\u0000\u0000 ${"x".repeat(60)}` })).status, 415)
	assert.equal((await post("/api/documents", { name: "long", text: "INVOICE\n".repeat(3000) })).status, 413)
	// a hostile file name becomes a safe identifier; the text is stored as text
	const evil = await post("/api/documents", { name: "../../etc/passwd<script>alert(1)</script>.txt", text: "<img src=x onerror=alert(1)> This is a note with no payment in it, just words and more words." })
	assert.equal(evil.status, 200)
	assert.match(evil.body.id, /^[A-Za-z0-9_-]{1,34}$/)
	const long = await post("/api/documents", { name: "n".repeat(400), text: "Ünïcödé ✓ 支付 — a note that asks for nothing and states no amount at all." })
	assert.equal(long.status, 200)
	assert.ok(long.body.id.length <= 34)
	await settled()
	for (const id of [evil.body.id, long.body.id]) {
		const c = await caseOf(id)
		assert.notEqual(c.stage, "approved", `${id} is not approved`)
		assert.equal(c.draft, null)
		assert.equal((await get(`/api/cases/${id}/draft`)).status, 409)
	}
	const text = await (await raw(`/api/documents/${evil.body.id}`)).text()
	assert.match(text, /<img src=x/, "the document comes back as it was sent")
	assert.match((await raw(`/api/documents/${evil.body.id}`)).headers.get("content-type") ?? "", /^text\/plain/, "and is served as plain text, never as HTML")
})

test("API: nothing outside the built UI is served, and no secret appears in any response", async () => {
	for (const path of ["/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "/../../.env", "/..%5c..%5c.env", "/assets/../../.env"]) {
		const r = await raw(path)
		const body = await r.text()
		assert.ok(!/"@mozaik-ai\/core"|ANTHROPIC_API_KEY=/.test(body), `${path} does not leak a file from outside web/dist`)
	}
	const key = process.env.ANTHROPIC_API_KEY
	if (key) for (const path of ["/api/health", "/api/state", "/api/lab"]) assert.ok(!(await (await raw(path)).text()).includes(key), `${path} does not contain the model key`)
})

/** Follows the event stream the way the UI does and keeps the view the UI would hold. */
function follow() {
	const ctl = new AbortController()
	const view: { cases: Map<string, any>; dailyAutoApproved: number | null } = { cases: new Map(), dailyAutoApproved: null }
	const done = (async () => {
		const r = await fetch(`${B}/api/events`, { signal: ctl.signal })
		const reader = r.body!.getReader()
		const dec = new TextDecoder()
		let buf = ""
		try {
			for (;;) {
				const { value, done } = await reader.read()
				if (done) break
				buf += dec.decode(value, { stream: true })
				let i: number
				while ((i = buf.indexOf("\n\n")) >= 0) {
					const block = buf.slice(0, i); buf = buf.slice(i + 2)
					const type = /^event: (.*)$/m.exec(block)?.[1], raw = /^data: (.*)$/m.exec(block)?.[1]
					if (!type || !raw || type === "ping") continue
					const d = JSON.parse(raw)
					if (type === "snapshot") { view.cases = new Map(d.cases.map((c: any) => [c.id, c])); view.dailyAutoApproved = d.dailyAutoApproved }
					else if (type === "desk.started") { view.cases = new Map(d.payload.cases.map((c: any) => [c.id, c])); view.dailyAutoApproved = d.payload.dailyAutoApproved }
					else if (type === "case.updated") { const old = view.cases.get(d.payload.id); if (!old || old.version <= d.payload.version || old.attempt < d.payload.attempt) view.cases.set(d.payload.id, d.payload) }
					else if (type === "totals") view.dailyAutoApproved = d.payload.dailyAutoApproved
				}
			}
		} catch { /* aborted */ }
	})()
	return { view, stop: async () => { ctl.abort(); await done } }
}

test("API: a run started twice in a row gives each document one clean result", async () => {
	const live = follow()
	await new Promise((r) => setTimeout(r, 150))
	const first = await post("/api/run")
	assert.equal(first.status, 200)
	const second = await post("/api/run")
	assert.equal(second.status, 409, "a run in progress is not restarted underneath itself")
	assert.match(second.body.error, /still/i)
	const s = await settled()
	for (const sc of s.scenarios) {
		const c = s.cases.find((k: any) => k.id === sc.docId)
		assert.ok(sc.expect.includes(outcome(c)), `${sc.docId}: expected ${sc.expect.join(" or ")}, got ${outcome(c)}`)
		const perAgent = new Map<string, number>()
		for (const r of c.runs) perAgent.set(r.agent, (perAgent.get(r.agent) ?? 0) + 1)
		for (const [agent, n] of perAgent) assert.equal(n, 1, `${sc.docId}: ${agent} ran ${n} times in one attempt`)
	}
	// the figure the overview shows is exactly the sum of what was approved automatically, in the policy currency
	const auto = s.cases.filter((c: any) => c.stage === "approved" && c.exposure?.currency === s.policy.currency).reduce((n: number, c: any) => n + c.exposure.minor, 0)
	assert.equal(s.dailyAutoApproved, auto)
	assert.ok(s.dailyAutoApproved <= s.policy.dailyAutoApproveBudget)
	// A page that was open the whole time holds exactly what the server holds: no figure waits for a reload.
	await new Promise((r) => setTimeout(r, 300))
	await live.stop()
	const now = (await get("/api/state")).body
	assert.equal(live.view.dailyAutoApproved, now.dailyAutoApproved, "the approved total reaches an open page")
	for (const c of now.cases) {
		const seen = live.view.cases.get(c.id)
		assert.ok(seen, `${c.id} reached the open page`)
		assert.equal(seen.stage, c.stage, `${c.id}: state`)
		assert.deepEqual(seen.exposure, c.exposure, `${c.id}: amount`)
		assert.equal(seen.controls.length, c.controls.length, `${c.id}: controls`)
		assert.equal(Object.keys(seen.ledger).length, Object.keys(c.ledger).length, `${c.id}: evidence`)
	}
})

test("API: conflicting amounts cannot be approved without a resolution, and the resolution is tied to the evidence", async () => {
	const c = await caseOf("INV-2026-1049")
	assert.equal(c.stage, "awaiting_approval")
	const conflict = c.controls.find((k: any) => k.id === "stated_amounts")
	assert.equal(conflict.status, "review", "the two amounts are detected")
	for (const ref of conflict.refs) assert.ok(c.ledger[ref], `${ref} is in the evidence ledger`)
	const lines = conflict.refs.map((r: string) => c.ledger[r]).filter((e: any) => e.category === "source_document")
	assert.ok(lines.length >= 2, "each amount has its own source reference")
	for (const e of lines) assert.ok(e.doc.located && e.doc.supportsValue !== false, `${e.id} points at a real line that contains its value`)
	assert.equal(new Set(lines.map((e: any) => e.doc.normalized)).size, 2, "and the two lines state two different amounts")
	assert.ok(c.runs.some((r: any) => r.agent === "Investigator"), "the exception reached the Investigator")
	assert.equal((await get("/api/cases/INV-2026-1049/draft")).status, 409, "no draft while it is unresolved")
	for (const reason of [undefined, "", "ok", "approved", "   yes   "]) {
		const r = await post("/api/cases/INV-2026-1049/actions", { action: "approve", reason })
		assert.equal(r.status, 422, `"${reason}" is not a resolution`)
	}
	assert.equal((await caseOf("INV-2026-1049")).stage, "awaiting_approval")
	const ok = await post("/api/cases/INV-2026-1049/actions", { action: "approve", reason: "Vendor confirmed by phone that 1,890.00 is the amount due" })
	assert.equal(ok.status, 200)
	const entry = ok.body.review.at(-1)
	assert.equal(entry.outcome, "applied")
	assert.match(entry.reason, /confirmed by phone/)
	for (const ref of conflict.refs) assert.ok(entry.refs.includes(ref), `the resolution cites ${ref}`)
	assert.equal(ok.body.review.filter((r: any) => r.outcome === "refused").length, 5, "every refused attempt is on the record")
	assert.equal((await get("/api/cases/INV-2026-1049/draft")).status, 200)
})

test("API: requests that race settle one way, once", async () => {
	// five approvals of one payment at the same instant: one is applied
	const five = await Promise.all(Array.from({ length: 5 }, () => post("/api/cases/INV-7733/actions", { action: "approve", reason: "checked against the contract" })))
	assert.deepEqual(five.map((r) => r.status).sort(), [200, 409, 409, 409, 409])
	const a = await caseOf("INV-7733")
	assert.equal(a.review.filter((r: any) => r.action === "approve" && r.outcome === "applied").length, 1)
	// approve and reject at the same instant: exactly one wins and the state agrees with it
	const id = "INV-ADR-0102"
	assert.equal((await caseOf(id)).stage, "awaiting_approval")
	const [x, y] = await Promise.all([post(`/api/cases/${id}/actions`, { action: "approve", reason: "one payment, split by mistake, confirmed with the vendor" }), post(`/api/cases/${id}/actions`, { action: "reject", reason: "duplicate of 0103" })])
	assert.deepEqual([x.status, y.status].sort(), [200, 409])
	const b = await caseOf(id)
	const applied = b.review.filter((r: any) => r.outcome === "applied" && (r.action === "approve" || r.action === "reject"))
	assert.equal(applied.length, 1)
	assert.equal(b.stage, applied[0].action === "approve" ? "approved" : "rejected")
	assert.equal(b.draft != null, b.stage === "approved", "a draft exists exactly when it is approved")
})

test("API: a decision cannot be undone by reprocessing, and only an approved payment has a draft", async () => {
	assert.equal((await post("/api/cases/INV-7733/actions", { action: "reprocess" })).status, 409, "approved")
	assert.equal((await post("/api/cases/INV-PX-3001/actions", { action: "reject", reason: "vendor not onboarded" })).status, 200)
	assert.equal((await post("/api/cases/INV-PX-3001/actions", { action: "reprocess" })).status, 409, "rejected by a person")
	assert.equal((await post("/api/cases/INV-PX-3001/actions", { action: "approve", reason: "changed my mind about it" })).status, 409)
	assert.equal((await post("/api/cases/MSG-newsletter/actions", { action: "approve", reason: "not even a payment" })).status, 409)
	for (const id of ["INV-PX-3001", "INV-ES-55820", "INV-ADR-0103", "MSG-newsletter"]) assert.equal((await get(`/api/cases/${id}/draft`)).status, 409, `${id} has no draft`)
	const draft = (await get("/api/cases/INV-7733/draft")).body
	assert.equal(draft.sandbox, true)
	assert.equal(draft.amount.minor, (await caseOf("INV-7733")).exposure.minor)
})

test("API: stress lab requests are validated", async () => {
	assert.equal((await post("/api/lab/runs", { kind: "scenario", mode: "scripted", scenarioIds: ["S99"] })).status, 404)
	assert.equal((await post("/api/lab/runs", { kind: "scenario", mode: "scripted" })).status, 400, "one scenario, or the suite")
	assert.equal((await post("/api/lab/runs", { kind: "benchmark", mode: "scripted" })).status, 400)
	assert.ok([400, 503].includes((await post("/api/lab/runs", { kind: "suite", mode: "live" })).status), "a live run is never started without confirmation")
	assert.equal((await get("/api/lab/runs/lab_nope/report")).status, 404)
	assert.equal((await get("/api/lab/runs/lab_nope/items/S01:multi")).status, 404)
	assert.equal((await send("/api/lab/runs", "null")).status, 400)
})

test("API: a decision is on disk the moment it is made, and survives the server being killed", async () => {
	// no waiting here on purpose: the last decision was made milliseconds ago and the server is about to be killed without warning
	const before = (await get("/api/state")).body
	const saved = JSON.parse(readFileSync(STATE, "utf8"))
	assert.ok(JSON.stringify(saved).includes("INV-7733"), "the state file holds the cases")
	await stop()
	await start(true)
	const after = (await get("/api/state")).body
	assert.equal(after.cases.length, before.cases.length)
	for (const id of ["INV-7733", "INV-2026-1049", "INV-PX-3001"]) {
		const a = before.cases.find((c: any) => c.id === id), b = after.cases.find((c: any) => c.id === id)
		assert.equal(b.stage, a.stage, `${id} keeps its state`)
		assert.deepEqual(b.review, a.review, `${id} keeps its review history`)
		assert.equal(Object.keys(b.ledger).length, Object.keys(a.ledger).length, `${id} keeps its evidence`)
		assert.deepEqual(b.runs, a.runs, `${id} keeps its execution records`)
	}
	assert.equal(after.dailyAutoApproved, before.dailyAutoApproved)
	assert.equal((await get("/api/cases/INV-7733/draft")).status, 200, "the draft is still there")
	assert.equal((await post("/api/cases/INV-7733/actions", { action: "approve", reason: "again after the restart" })).status, 409, "and it is still not approved twice")
})
