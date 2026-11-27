/**
 * Local inference and execution-mode honesty, without a real model.
 *
 * A small OpenAI-compatible server stands in for Ollama. The desk server is the real one, started with
 * DESK_INFERENCE=local, and it reaches the stand-in over HTTP through Mozaik's own OpenAIChatCompletions endpoint, so the
 * request and response conversion under test is the one a real local model would go through. The stand-in answers with
 * the test fixture's tool calls. These tests show that the transport, the labels and the failure handling are right.
 * They show nothing about what a real local model answers.
 */
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { FunctionCallItem, ModelMessageItem } from "@mozaik-ai/core"
import { scriptedModel } from "./scripted.js"
import { READINGS } from "./fixtures.js"
import { jsonMessages, jsonToOutput, listLimitsOf, localConfig, localLabel, probeLocal, pruneNulls, strictSchema } from "../local.js"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DOC = (id: string) => readFileSync(join(ROOT, "server", "data", "documents", `${id}.txt`), "utf8")
const MODEL = "stand-in-7b"
const RUNNING = ["received", "extracting", "checking", "investigating", "deciding"]

// ───────── the stand-in provider ─────────
type Behaviour = "ok" | "bad_arguments" | "not_json" | "hang" | "no_tool"
const provider = { behaviour: "ok" as Behaviour, inFlight: 0, peak: 0, calls: 0, issued: new Set<string>(), strangers: 0, models: [] as string[], delayMs: 40, protocols: new Set<string>(), schemas: [] as any[] }
const script = scriptedModel({ readings: READINGS, policy: "AUTO_APPROVED", latencyMs: 1 })
const bodyOf = (req: IncomingMessage) => new Promise<any>((res) => { let s = ""; req.on("data", (d) => (s += d)); req.on("end", () => { try { res(JSON.parse(s)) } catch { res(null) } }) })
const fake: Server = createServer(async (req, res) => {
	const send = (code: number, body: unknown, raw = false) => { res.writeHead(code, { "content-type": raw ? "text/html" : "application/json" }); res.end(raw ? String(body) : JSON.stringify(body)) }
	if (req.method === "GET" && req.url === "/v1/models") return send(200, { object: "list", data: [{ id: MODEL, object: "model" }] })
	if (req.method !== "POST" || req.url !== "/v1/chat/completions") return send(404, { error: { message: "not found" } })
	const body = await bodyOf(req)
	provider.calls++; provider.inFlight++; provider.peak = Math.max(provider.peak, provider.inFlight); provider.models.push(body?.model)
	try {
		await new Promise((r) => setTimeout(r, provider.delayMs))
		if (provider.behaviour === "hang") return await new Promise(() => { /* never answers */ })
		if (provider.behaviour === "not_json") return send(200, "<html>upstream error</html>", true)
		// chat messages back into the shape the fixture reads; tool results must answer a call this server issued
		const items: any[] = []
		const constrained = body.response_format?.type === "json_schema"
		provider.protocols.add(constrained ? "json" : body.tools ? "native" : "plain")
		for (const m of body.messages as any[]) {
			if (m.role === "system") items.push({ type: "message", role: "developer", content: { text: m.content } })
			// in the json protocol a tool result comes back as a user message that names the tool
			else if (m.role === "user" && /^Result of \S+:\n/.test(m.content)) items.push({ type: "function_call_output", callId: "n/a", output: { text: m.content.replace(/^Result of \S+:\n/, "").replace(/\n\nContinue with your next tool call, as one JSON object\.$/, "") } })
			else if (m.role === "user") items.push({ type: "message", role: "user", content: { text: m.content } })
			else if (m.role === "tool") { if (!provider.issued.has(m.tool_call_id)) provider.strangers++; items.push({ type: "function_call_output", callId: m.tool_call_id, output: { text: m.content } }) }
		}
		const out = await script.run({ model: body.model, context: { getItems: () => items }, tools: body.tools } as never)
		const calls = out.items.filter((i): i is FunctionCallItem => i instanceof FunctionCallItem)
		const said = out.items.find((i): i is ModelMessageItem => i instanceof ModelMessageItem)
		for (const c of calls) provider.issued.add(c.callId)
		const message: any = { role: "assistant", content: (said as any)?.content?.text ?? null }
		if (provider.behaviour === "no_tool") message.content = "I think this invoice looks fine and should be approved."
		else if (constrained && calls.length) {
			// the answer a schema-constrained server gives: one JSON object, every optional field present as null
			if (provider.schemas.length < 12) provider.schemas.push(body.response_format.json_schema.schema)
			message.content = provider.behaviour === "bad_arguments" ? '{"tool": "' + calls[0]!.name + '", "arguments": {"fields": "none"}}' : JSON.stringify({ tool: calls[0]!.name, arguments: { ...JSON.parse(calls[0]!.args), note: null } })
		}
		else if (calls.length) message.tool_calls = calls.map((c) => ({ id: c.callId, type: "function", function: { name: c.name, arguments: provider.behaviour === "bad_arguments" ? '{"fields": ' : c.args } }))
		send(200, { id: "cmpl-test", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 321, completion_tokens: 45, total_tokens: 366 } })
	} finally { provider.inFlight-- }
})
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r))
const FAKE = `http://127.0.0.1:${(fake.address() as { port: number }).port}/v1`

// ───────── the real desk server, in local mode ─────────
let server: ChildProcess | undefined
let B = ""
const until = async <T>(fn: () => Promise<T | null | false | undefined>, ms = 30_000): Promise<T> => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 80)) } }
const get = async (path: string) => { const r = await fetch(B + path); return { status: r.status, body: (await r.json()) as any } }
const post = async (path: string, body?: unknown) => { const r = await fetch(B + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: (await r.json()) as any } }
const stop = async () => { server?.kill("SIGKILL"); server = undefined; await new Promise((r) => setTimeout(r, 200)) }
async function boot(env: Record<string, string>, expectUp = true): Promise<{ code: number | null; err: string }> {
	await stop()
	const port = 22000 + Math.floor(Math.random() * 2000)
	B = `http://127.0.0.1:${port}`
	let err = ""
	const clean = { ...process.env, ANTHROPIC_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", DESK_SCRIPTED: "", DESK_INFERENCE: "local", LOCAL_MODEL: MODEL, LOCAL_MODEL_BASE_URL: FAKE, API_PORT: String(port), DESK_PERSIST: "off", LAB_PERSIST: "off", MOZAIK_CREDENTIALS_FILE: "/nonexistent/mozaik-credentials.json", MOZAIK_API_KEY: "", DESK_RETRY_DELAY_MS: "10", AGENT_TIMEOUT_MS: "5000", ...env }
	const p = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], env: clean })
	p.stderr!.on("data", (d) => { err = (err + d).slice(-1200) })
	server = p
	if (!expectUp) { const code = await new Promise<number | null>((r) => p.on("exit", r)); server = undefined; return { code, err } }
	await until(async () => { try { return (await get("/api/health")).body.ok } catch { return false } })
	return { code: null, err }
}
const settle = (id: string) => until(async () => { const c = (await get("/api/state")).body.cases.find((k: any) => k.id === id); return c && !RUNNING.includes(c.stage) ? c : null })
after(async () => { await stop(); fake.close() })

test("configuration: local means local, a model has to be named, and the limits are bounded", () => {
	assert.equal(localConfig({}), null, "not selected, not configured")
	assert.equal(localConfig({ DESK_INFERENCE: "cloud", LOCAL_MODEL: "x" }), null)
	const c = localConfig({ DESK_INFERENCE: "local", LOCAL_MODEL: "qwen2.5:7b-instruct" })!
	assert.deepEqual([c.baseURL, c.fast, c.careful, c.maxConcurrency, c.provider, c.protocol], ["http://127.0.0.1:11434/v1", "qwen2.5:7b-instruct", "qwen2.5:7b-instruct", 1, "Ollama", "json"])
	assert.equal(localConfig({ DESK_INFERENCE: "local", LOCAL_MODEL: "x", LOCAL_TOOL_PROTOCOL: "native" })!.protocol, "native")
	assert.throws(() => localConfig({ DESK_INFERENCE: "local", LOCAL_MODEL: "x", LOCAL_TOOL_PROTOCOL: "xml" }), /json or native/)
	assert.throws(() => localConfig({ DESK_INFERENCE: "local" }), /needs a model/)
	assert.throws(() => localConfig({ DESK_INFERENCE: "local", LOCAL_MODEL: "x", LOCAL_MODEL_BASE_URL: "https://api.example.com/v1" }), /on this machine/, "a remote address is refused: a document is never sent elsewhere by a typo")
	assert.throws(() => localConfig({ DESK_INFERENCE: "local", LOCAL_MODEL: "x", LOCAL_MODEL_BASE_URL: "not a url" }), /not a URL/)
	assert.throws(() => localConfig({ DESK_INFERENCE: "local", LOCAL_MODEL: "x", LOCAL_MAX_CONCURRENCY: "0" }), /1 to 8/)
	assert.throws(() => localConfig({ DESK_INFERENCE: "local", LOCAL_MODEL: "x", LOCAL_MAX_CONCURRENCY: "40" }), /1 to 8/)
	assert.equal(localLabel("qwen2.5:7b-instruct", "Ollama"), "qwen2.5:7b-instruct · Ollama, this machine")
})

test("the probe says plainly when the server or the model is not there", async () => {
	const base = { fast: MODEL, careful: MODEL, maxConcurrency: 1, provider: "stand-in", protocol: "json" as const }
	assert.deepEqual(await probeLocal({ ...base, baseURL: FAKE }), { ok: true })
	const missing = await probeLocal({ ...base, baseURL: FAKE, careful: "not-downloaded:70b" })
	assert.ok(!missing.ok && /does not have not-downloaded:70b/.test(missing.error) && missing.error.includes(MODEL))
	const down = await probeLocal({ ...base, baseURL: "http://127.0.0.1:9/v1" })
	assert.ok(!down.ok && /No local model server answers/.test(down.error) && /Nothing is substituted/.test(down.error))
})

test("startup: an unreachable server or a missing model stops the desk with the reason, and nothing takes its place", async () => {
	const down = await boot({ LOCAL_MODEL_BASE_URL: "http://127.0.0.1:9/v1" }, false)
	assert.equal(down.code, 1)
	assert.match(down.err, /Local inference is selected .* cannot start\. No local model server answers/)
	const missing = await boot({ LOCAL_MODEL: "not-downloaded:70b" }, false)
	assert.equal(missing.code, 1)
	assert.match(missing.err, /does not have not-downloaded:70b/)
	const remote = await boot({ LOCAL_MODEL_BASE_URL: "https://api.example.com/v1" }, false)
	assert.notEqual(remote.code, 0)
	assert.match(remote.err, /on this machine/)
})

for (const protocol of ["json", "native"] as const) test(`a clean invoice through the local transport (${protocol} tool protocol): tool calls round-trip, usage is recorded, and every label says local`, async () => {
	Object.assign(provider, { behaviour: "ok", calls: 0, peak: 0, strangers: 0, models: [] })
	provider.protocols.clear()
	await boot({ LOCAL_TOOL_PROTOCOL: protocol })
	const health = (await get("/api/health")).body
	assert.deepEqual([health.mode, health.inference.kind, health.inference.provider, health.hasModelKey, health.hasLiveKey], ["live", "local", "local model server", true, true])
	assert.deepEqual(health.models, { fast: MODEL, careful: MODEL })
	const added = await post("/api/documents", { name: "INV-2026-1041", text: DOC("INV-2026-1041") })
	assert.equal(added.status, 200, "a live server takes a document on either route")
	const c = await settle(added.body.id)
	assert.equal(c.stage, "approved", "the same controls decide, whatever the transport")
	assert.ok(c.draft?.sandbox)
	assert.deepEqual(c.runs.map((r: any) => r.agent).sort(), ["Auditor", "Extractor", "Policy", "Validator"])
	for (const r of c.runs) {
		assert.equal(r.model, `${MODEL} · local model server, this machine`, "a loop is recorded with the model that ran it and where")
		assert.ok(r.tokens && r.tokens.input >= 321 && r.tokens.output >= 45, "the usage the server reported is kept")
	}
	assert.ok(provider.calls >= 5 && provider.models.every((m) => m === MODEL), "every call went to the configured local model")
	assert.equal(provider.strangers, 0, "each tool result answered a call id this provider issued")
	assert.deepEqual([...provider.protocols], [protocol], "every request used the configured tool protocol")
	assert.ok(c.validation.result?.vendorId === "V-001", "the Validator's second call saw the lookup result of its first")
	const snap = (await get("/api/state")).body
	assert.equal(snap.inference.kind, "local")
	assert.ok(snap.agents.every((a: any) => a.model === `${MODEL} · local model server, this machine`))
	assert.ok(!JSON.stringify(snap).includes("claude-"), "no cloud model name appears anywhere in a local run")
	assert.ok(!JSON.stringify(snap.cases).includes("scripted fixture"), "and nothing is labelled as scripted")
})

test("model requests are bounded: with a limit of one they never overlap, while the two agent loops still do", async () => {
	Object.assign(provider, { behaviour: "ok", calls: 0, peak: 0, delayMs: 120 })
	await boot({ LOCAL_MAX_CONCURRENCY: "1" })
	const one = await settle((await post("/api/documents", { name: "INV-2026-1041", text: DOC("INV-2026-1041") })).body.id)
	assert.equal(provider.peak, 1, "one request at a time reached the model server")
	const [aud, val] = ["Auditor", "Validator"].map((a) => one.runs.find((r: any) => r.agent === a))
	assert.ok(Date.parse(aud.startedAt) < Date.parse(val.finishedAt) && Date.parse(val.startedAt) < Date.parse(aud.finishedAt), "the Validator and the Auditor loops overlap in time")
	provider.peak = 0
	await boot({ LOCAL_MAX_CONCURRENCY: "2" })
	await settle((await post("/api/documents", { name: "INV-2026-1041", text: DOC("INV-2026-1041") })).body.id)
	assert.equal(provider.peak, 2, "with a limit of two, two requests do run together")
	provider.delayMs = 40
})

test("a local model that answers badly approves nothing: broken arguments, no tool call, a body that is not JSON", async () => {
	for (const behaviour of ["bad_arguments", "no_tool", "not_json"] as Behaviour[]) {
		provider.behaviour = behaviour
		await boot({})
		const c = await settle((await post("/api/documents", { name: "INV-2026-1041", text: DOC("INV-2026-1041") })).body.id)
		assert.notEqual(c.stage, "approved", `${behaviour}: not approved`)
		assert.equal(c.draft, null, `${behaviour}: no draft`)
		assert.equal((await get(`/api/cases/${c.id}/draft`)).status, 409)
		assert.ok(!c.runs.some((r: any) => r.model === "scripted fixture"), `${behaviour}: nothing was answered by the scripted model instead`)
	}
	provider.behaviour = "ok"
})

test("a local model that never answers ends as a timeout, not as a decision", async () => {
	provider.behaviour = "hang"
	await boot({ AGENT_TIMEOUT_MS: "700" })
	const c = await settle((await post("/api/documents", { name: "INV-2026-1041", text: DOC("INV-2026-1041") })).body.id)
	assert.equal(c.stage, "error")
	assert.equal(c.draft, null)
	assert.ok(c.runs.some((r: any) => r.status === "timeout"))
	provider.behaviour = "ok"
})

test("a local server that goes away mid-run fails the payment; no cloud provider and no scripted answer steps in", async () => {
	// a stand-in of its own, so that it can be closed while the desk is running
	const flaky: Server = createServer((req, res) => { if (req.url === "/v1/models") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: MODEL }] })) } else req.socket.destroy() })
	await new Promise<void>((r) => flaky.listen(0, "127.0.0.1", r))
	const before = provider.calls
	await boot({ LOCAL_MODEL_BASE_URL: `http://127.0.0.1:${(flaky.address() as { port: number }).port}/v1`, ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key" })
	const c = await settle((await post("/api/documents", { name: "INV-2026-1041", text: DOC("INV-2026-1041") })).body.id)
	flaky.close()
	assert.equal(c.stage, "error")
	assert.equal(c.draft, null)
	assert.ok(c.runs.every((r: any) => r.model.startsWith(MODEL)), "the failed loops are still recorded as local ones")
	assert.equal(provider.calls, before, "the other stand-in was never called")
	assert.equal((await get("/api/health")).body.inference.kind, "local", "a cloud key in the environment does not change the mode")
})

test("the scripted server names no model: the agents, the loops and the showcase file are labelled as what they are", async () => {
	await boot({ DESK_INFERENCE: "", DESK_SCRIPTED: "1", LOCAL_MODEL: "", FAST_MODEL: "claude-haiku-4-5", CAREFUL_MODEL: "claude-sonnet-5-5" })
	const snap0 = (await get("/api/state")).body
	assert.deepEqual([snap0.modelMode, snap0.inference.kind], ["scripted", "scripted"])
	assert.ok(snap0.agents.every((a: any) => a.model === "scripted fixture"), "the agent list does not show a configured model as if it had run")
	assert.equal((await post("/api/showcase/start")).status, 200)
	const steps = (await get("/api/state")).body.showcase.steps
	assert.equal(steps.find((s: any) => s.key === "challenge").fileName, "INV-2026-1049.pdf", "the two-page scenario is named as the PDF it runs on, before it has run")
	assert.equal(steps.find((s: any) => s.key === "legitimate").fileName, "INV-2026-1041.txt")
	assert.equal((await post("/api/showcase/run", { key: "challenge" })).status, 200)
	const c = await settle("INV-2026-1049")
	assert.equal(c.fileName, "INV-2026-1049.pdf")
	assert.ok(c.runs.length === 5 && c.runs.every((r: any) => r.model === "scripted fixture"))
	assert.equal((await get("/api/state")).body.showcase.steps.find((s: any) => s.key === "challenge").fileName, "INV-2026-1049.pdf")
})

test("both intake routes obey one rule on the scripted server: an unregistered document is refused before a case exists", async () => {
	await boot({ DESK_INFERENCE: "", DESK_SCRIPTED: "1", LOCAL_MODEL: "" })
	const unknown = "ALPENWERK TECHNIK AG\nInvoice AW-2026-0091\nTOTAL EUR 640.00\nIBAN: CH93 0076 2011 6238 5295 7\n"
	const before = (await get("/api/state")).body.cases.length
	const direct = await post("/api/documents", { name: "AW-2026-0091", text: unknown })
	assert.equal(direct.status, 409, "the one-call route does not start the workflow for it")
	assert.match(direct.body.error, /Live AI access is required/)
	const seen = await post("/api/documents/inspect", { name: "AW-2026-0091.txt", text: unknown })
	assert.equal(seen.body.interpretable, false)
	assert.equal((await post("/api/documents", { token: seen.body.token })).status, 409, "and neither does the two-step route")
	assert.equal((await get("/api/state")).body.cases.length, before, "no case, no failed case, nothing on the desk")
	// malformed input is still told what is wrong with it, not that it needs a model
	assert.equal((await post("/api/documents", { name: "x", text: "short" })).status, 400)
	assert.equal((await post("/api/documents", { name: "x", text: "INVOICE\n".repeat(3000) })).status, 413)
	// a registered document is taken on the one-call route too, under its own id, and decided by the same controls
	const known = await post("/api/documents", { name: "anything-at-all", text: DOC("INV-ES-55820") })
	assert.equal(known.status, 200)
	assert.equal(known.body.id, "INV-ES-55820")
	const c = await settle("INV-ES-55820")
	assert.equal(c.stage, "blocked")
	assert.equal((await post(`/api/cases/${c.id}/actions`, { action: "approve", reason: "sent on the other route, please approve" })).status, 409)
})

test("list limits reach the model twice: enforced by the server's schema and stated in plain words", () => {
	// The shape of the Investigator's result: in the stored local run it returned more than ten facts, twice, and its loop was closed.
	const tool = { type: "object", properties: { verifiedFacts: { type: "array", maxItems: 10, items: { type: "object", properties: { text: { type: "string", maxLength: 400 }, refs: { type: "array", maxItems: 12, items: { type: "string", maxLength: 60 } } }, required: ["text"] } }, unknowns: { default: [], type: "array", maxItems: 8, items: { type: "string" } }, note: { type: "string" } }, required: ["verifiedFacts"] }
	const strict = strictSchema(tool) as any
	assert.equal(strict.properties.verifiedFacts.maxItems, 10, "the limit is part of what the server enforces")
	assert.equal(strict.properties.verifiedFacts.items.properties.refs.anyOf[0].maxItems, 12)
	assert.equal(strict.properties.unknowns.anyOf[0].maxItems, 8)
	assert.equal(strict.properties.verifiedFacts.items.properties.text.maxLength, undefined, "text lengths are still left to the desk's own validation")
	const old = strictSchema(tool, false) as any
	assert.equal(old.properties.verifiedFacts.maxItems, undefined, "LOCAL_SCHEMA_LIMITS=off sends the earlier form")
	assert.deepEqual(listLimitsOf(tool), ["verifiedFacts: at most 10 items", "verifiedFacts[].refs: at most 12 items", "unknowns: at most 8 items"])
	const messages = jsonMessages({ tools: [{ name: "submit_investigation", description: "d", parameters: tool, strict: false }], context: { getItems: () => [] } } as never)
	assert.match(messages[0]!.content, /list limits, a longer list is refused: verifiedFacts: at most 10 items/)
	assert.equal(localConfig({ DESK_INFERENCE: "local", LOCAL_MODEL: "x" })!.listLimits, true)
	assert.equal(localConfig({ DESK_INFERENCE: "local", LOCAL_MODEL: "x", LOCAL_SCHEMA_LIMITS: "off" })!.listLimits, false)
})

test("the strict schema and its undoing: nothing optional is silently dropped, and a forced null is not passed on as a value", () => {
	const tool = { type: "object", properties: { gross: { type: "string" }, note: { type: "string", maxLength: 400 }, bic: { anyOf: [{ type: "object", properties: { value: { type: ["string", "null"] }, quote: { type: ["string", "null"] } }, required: ["value"], additionalProperties: false }, { type: "null" }] }, lines: { type: "array", items: { type: "object", properties: { label: { type: "string" }, amount: { type: "string" } }, required: ["label"] } } }, required: ["gross"] }
	const strict = strictSchema(tool) as any
	assert.deepEqual(strict.required, ["gross", "note", "bic", "lines"], "every property is required")
	assert.deepEqual(strict.properties.note, { anyOf: [{ type: "string" }, { type: "null" }] }, "an optional one may be null; the length annotation a grammar cannot enforce is gone")
	assert.deepEqual(strict.properties.bic.anyOf[0].required, ["value", "quote"])
	assert.deepEqual(strict.properties.lines.anyOf[0].items.required, ["label", "amount"])
	const answered = { gross: "10.00", note: null, bic: null, lines: [{ label: "a", amount: null }] }
	assert.deepEqual(pruneNulls(answered, tool), { gross: "10.00", bic: null, lines: [{ label: "a" }] }, "nulls go where the tool's schema has no null; a null it allows stays")
	const tools = [{ name: "submit", description: "d", parameters: tool, strict: false } as never]
	const call = jsonToOutput(JSON.stringify({ tool: "submit", arguments: answered }), tools, { prompt_tokens: 7, completion_tokens: 3 }, null)
	assert.ok(call.items[0] instanceof FunctionCallItem && (call.items[0] as FunctionCallItem).name === "submit")
	assert.deepEqual(JSON.parse((call.items[0] as FunctionCallItem).args), { gross: "10.00", bic: null, lines: [{ label: "a" }] })
	assert.deepEqual([call.tokenUsage?.inputTokens, call.tokenUsage?.outputTokens, call.tokenUsage?.totalTokens], [7, 3, 10])
	for (const text of ["not json at all", JSON.stringify({ tool: "another_tool", arguments: {} }), JSON.stringify({ tool: "submit" })]) {
		const out = jsonToOutput(text, tools, undefined, null)
		assert.ok(out.items.length === 1 && out.items[0] instanceof ModelMessageItem, "an answer that is not a call to an offered tool stays text: no tool is called on a guess")
	}
	assert.deepEqual(jsonToOutput("", tools, undefined, null).items, [])
})
