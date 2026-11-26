/**
 * End-to-end over HTTP: the real server process, started the way `npm run dev:scripted` starts it, driven only through
 * the API the UI uses. Scripted model, real Mozaik workflow. Covers the main user actions from intake to the audit report.
 */
import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { dirname, join } from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const PORT = 18000 + Math.floor(Math.random() * 2000)
const B = `http://127.0.0.1:${PORT}`
let server: ChildProcess

const get = async (path: string) => { const r = await fetch(B + path); return { status: r.status, body: await r.json() as any, headers: r.headers } }
const post = async (path: string, body?: unknown) => { const r = await fetch(B + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() as any } }
const until = async <T>(fn: () => Promise<T | null | false | undefined>, ms = 30_000): Promise<T> => {
	const end = Date.now() + ms
	for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for the server"); await new Promise((r) => setTimeout(r, 120)) }
}
const stageOf = (s: any, id: string) => s.cases.find((c: any) => c.id === id)?.stage

before(async () => {
	server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, API_PORT: String(PORT), DESK_SCRIPTED: "1", DESK_PERSIST: "off", LAB_PERSIST: "off", MOZAIK_CREDENTIALS_FILE: "/nonexistent/mozaik-credentials.json", MOZAIK_API_KEY: "" } })
	await until(async () => { try { return (await get("/api/health")).body.ok } catch { return false } })
})
after(() => { server?.kill("SIGKILL") })

test("HTTP: the whole workflow, from intake to a sandbox draft and the audit trail", async () => {
	const fresh = await get("/api/state")
	assert.equal(fresh.body.cases.length, 0)
	assert.equal(fresh.body.modelMode, "scripted", "the server says which model path it is on")

	assert.equal((await post("/api/run")).status, 200)
	const s = await until(async () => { const r = (await get("/api/state")).body; return r.cases.length === 16 && r.cases.every((c: any) => !["received", "extracting", "checking", "investigating", "deciding"].includes(c.stage)) ? r : null })
	for (const sc of s.scenarios) {
		const c = s.cases.find((k: any) => k.id === sc.docId)
		const outcome = c.stage === "approved" ? "AUTO_APPROVED" : c.stage === "awaiting_approval" ? "NEEDS_APPROVAL" : c.stage === "blocked" ? "BLOCKED" : c.stage === "not_a_payment" ? "NOT_A_PAYMENT" : "PROCESSING_ERROR"
		assert.ok(sc.expect.includes(outcome), `${sc.docId}: expected ${sc.expect.join(" or ")}, got ${outcome}`)
	}

	// 8. human approval when appropriate, 9. a sandbox draft, and the refusals around them
	assert.equal(stageOf(s, "INV-7733"), "awaiting_approval")
	assert.equal((await get("/api/cases/INV-7733/draft")).status, 409, "no draft before approval")
	const blocked = await post("/api/cases/INV-ES-55820/actions", { action: "approve", reason: "trying anyway" })
	assert.equal(blocked.status, 409)
	assert.match(blocked.body.error, /blocked payment cannot be approved/i)
	assert.equal((await post("/api/cases/INV-7733/actions", { action: "approve", reason: "checked against the contract" })).status, 200)
	assert.equal((await post("/api/cases/INV-7733/actions", { action: "approve" })).status, 409, "not approved twice")
	const draft = await get("/api/cases/INV-7733/draft")
	assert.equal(draft.status, 200)
	assert.equal(draft.body.sandbox, true)
	assert.equal(draft.body.amount.minor, 674000)
	assert.match(draft.headers.get("content-disposition") ?? "", /attachment/)
	assert.equal((await post("/api/cases/INV-PX-3001/actions", { action: "reject", reason: "vendor not onboarded" })).status, 200)
	assert.equal((await post("/api/cases/INV-ES-55820/actions", { action: "verify_beneficiary", callbackRef: "CB-0000" })).status, 422, "a made-up callback reference is refused")
	assert.equal((await post("/api/cases/INV-7733/actions", { action: "launch" })).status, 400)

	// 10. the audit trail keeps every decision and every refusal
	const end = (await get("/api/state")).body
	const approved = end.cases.find((c: any) => c.id === "INV-7733")
	assert.deepEqual(approved.review.map((r: any) => `${r.action}:${r.outcome}`), ["approve:applied", "approve:refused"])
	assert.ok(end.cases.find((c: any) => c.id === "INV-ES-55820").review.some((r: any) => r.outcome === "refused"))
	assert.ok(approved.integrity?.ok, "the approved payment's evidence verifies")
	const source = await fetch(`${B}/api/documents/INV-7733`)
	assert.equal(source.status, 200)
	assert.match(await source.text(), /NET À PAYER/)
	assert.equal((await get("/api/nope")).status, 404)

	// adding a document by hand, and the same document again
	const text = "From: billing@nordlicht-logistik.example\nINVOICE\nInvoice number: X-1\nTOTAL EUR 10.00\nIBAN: DE89 3704 0044 0532 0130 00\n"
	assert.equal((await post("/api/documents", { name: "x", text: "short" })).status, 400)
	assert.equal((await post("/api/documents", { name: "pasted-1", text })).status, 200)
	const copy = await post("/api/documents", { name: "pasted-2", text })
	assert.equal(copy.body.stage, "blocked", "the same text under another name is stopped at intake")
})

test("HTTP: a stress scenario runs in isolation and exports an audit report", async () => {
	// let the document added by hand in the previous test finish, so any later change would be the lab's doing
	const settled = await until(async () => { const r = (await get("/api/state")).body; return r.cases.every((c: any) => !["received", "extracting", "checking", "investigating", "deciding"].includes(c.stage)) ? r : null })
	const inbox = JSON.stringify(settled.cases.map((c: any) => [c.id, c.version]))
	const lab = (await get("/api/lab")).body
	assert.equal(lab.scenarios.length, 12)
	assert.equal(lab.benchmark, null, "no benchmark figures exist before a benchmark has run")
	assert.equal((await post("/api/lab/runs", { kind: "suite", mode: "live" })).status >= 400, true, "a live run is never started without confirmation")
	const run = await post("/api/lab/runs", { kind: "suite", mode: "scripted" })
	assert.equal(run.status, 200)
	assert.equal((await post("/api/lab/runs", { kind: "suite", mode: "scripted" })).status, 409)
	const done = await until(async () => { const o = (await get("/api/lab")).body; return o.active ? null : o }, 60_000)
	const items = done.runs[0].items
	assert.equal(items.length, 12)
	assert.deepEqual(items.filter((i: any) => i.status !== "pass").map((i: any) => `${i.scenarioId}:${i.status}:${i.error}`), [])
	const detail = (await get(`/api/lab/runs/${run.body.id}/items/${encodeURIComponent("S08:multi")}`)).body
	assert.equal(detail.cases.length, 3)
	assert.ok(detail.result.peakParallel >= 2)
	const report = await get(`/api/lab/runs/${run.body.id}/report?item=${encodeURIComponent("S02:multi")}`)
	assert.match(report.body.notice, /SYNTHETIC DATA, SANDBOX OUTPUT/)
	assert.equal(report.body.executions[0].cases[0].deterministicEnforcement.inForce, "BLOCKED")
	assert.equal(JSON.stringify((await get("/api/state")).body.cases.map((c: any) => [c.id, c.version])), inbox, "the payment inbox was not touched by the lab")
})
