/** HTTP API + Server-Sent Events for the Payment Desk UI. No framework: node:http is enough. */
import "dotenv/config"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize, dirname, sep } from "node:path"
import { fileURLToPath } from "node:url"
import * as lab from "./lab/manager.js"
import { DeskError, MODELS, act, addDocument, exportDraft, flush, getDocumentText, getRecordedDocumentText, recordingView, resetDemo, runDemo, runShowcaseStep, setModelRunner, snapshot, startShowcase, subscribe, type Action } from "./desk.js"

const PORT = Number(process.env.API_PORT ?? 8787)
const here = dirname(fileURLToPath(import.meta.url))
const WEB_DIST = join(here, "..", "web", "dist")
// Development only: run the UI against the test-fixture model instead of a live one. The UI says so in a banner.
const SCRIPTED = process.env.DESK_SCRIPTED === "1"
if (SCRIPTED) {
	const [{ scriptedModel }, { READINGS }, { SHOWCASE_RESPONSES }] = await Promise.all([import("./test/scripted.js"), import("./test/fixtures.js"), import("./test/showcase-responses.js")])
	// Predefined answers for the showcase documents; every other document keeps the bare test fixture. A short fixed latency
	// per call, so that recorded start and finish times are distinct and the Validator and the Auditor visibly overlap.
	// DESK_SCRIPTED_FAULT=insufficient_credit makes every scripted call fail the way a provider without credit does. For the
	// browser checks of the failure path only; the error text says it was injected and that no provider was called.
	const failWith = process.env.DESK_SCRIPTED_FAULT === "insufficient_credit" ? '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the API."}} [injected by DESK_SCRIPTED_FAULT for a test; no provider was called]' : undefined
	setModelRunner(scriptedModel({ readings: READINGS, policy: "AUTO_APPROVED", latencyMs: Number(process.env.DESK_SCRIPTED_LATENCY_MS ?? 40), ...SHOWCASE_RESPONSES, failWith }), "scripted")
}
const hasKey = SCRIPTED || Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)
/** A live Stress Lab run needs a real key even when this server itself runs on the scripted model. */
const hasLiveKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)
const NO_KEY = "No model API key. Copy .env.example to .env and set ANTHROPIC_API_KEY, then restart."
const ACTIONS: Action[] = ["approve", "reject", "request_verification", "verify_beneficiary", "reprocess"]

// A loop that dies must not take the desk down with it; the case's own timeout turns it into a processing error.
process.on("unhandledRejection", (err) => console.error("unhandled rejection in an agent loop:", err))

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers })
	res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<any> {
	const chunks: Buffer[] = []
	let size = 0
	for await (const c of req) {
		size += (c as Buffer).length
		if (size > 200_000) throw new DeskError(413, "The request is too large.")
		chunks.push(c as Buffer)
	}
	const raw = Buffer.concat(chunks).toString("utf8")
	if (!raw) return {}
	let body: unknown
	try { body = JSON.parse(raw) } catch { throw new DeskError(400, "The request body is not valid JSON.") }
	if (body === null || typeof body !== "object" || Array.isArray(body)) throw new DeskError(400, "The request body must be a JSON object.")
	return body
}

/** An identifier taken from the path. A percent-escape that does not decode is the caller's mistake, not a server error. */
function param(raw: string): string {
	try { return decodeURIComponent(raw) } catch { throw new DeskError(400, "The address contains an invalid escape sequence.") }
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" }

function serveStatic(res: ServerResponse, urlPath: string): boolean {
	if (!existsSync(WEB_DIST)) return false
	let file = join(WEB_DIST, normalize(urlPath).replace(/^(\.\.[/\\])+/, ""))
	if (file !== WEB_DIST && !file.startsWith(WEB_DIST + sep)) return false
	if (!existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIST, "index.html")
	if (!existsSync(file)) return false
	res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
	res.end(readFileSync(file))
	return true
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost")
	const path = url.pathname
	const m = req.method
	try {
		if (m === "GET" && path === "/api/health") return json(res, 200, { ok: true, hasModelKey: hasKey, hasLiveKey, mode: SCRIPTED ? "scripted" : "live", models: MODELS })
		if (m === "GET" && path === "/api/state") return json(res, 200, snapshot())
		if (m === "GET" && path === "/api/events") {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" })
			res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
			const unsubscribe = subscribe((e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`))
			// A named heartbeat, so the client can tell a silent dead connection from a quiet desk.
			const ping = setInterval(() => res.write(`event: ping\ndata: ${Date.now()}\n\n`), 10_000)
			req.on("close", () => { unsubscribe(); clearInterval(ping) })
			return
		}
		if (m === "POST" && path === "/api/run") {
			if (!hasKey) throw new DeskError(503, NO_KEY)
			return json(res, 200, runDemo())
		}
		if (m === "POST" && path === "/api/reset") return json(res, 200, resetDemo())
		// The guided demo. Starting it calls no model; running a scenario does, so that needs a key (or the scripted model).
		if (m === "POST" && path === "/api/showcase/start") return json(res, 200, startShowcase())
		if (m === "POST" && path === "/api/showcase/run") {
			if (!hasKey) throw new DeskError(503, NO_KEY)
			const body = await readBody(req)
			return json(res, 200, runShowcaseStep(typeof body.key === "string" ? body.key : ""))
		}
		// A stored execution of an earlier live run. GET only: there is nothing to start, approve or change.
		if (m === "GET" && path === "/api/recording") return json(res, 200, { recording: recordingView() })
		const recDoc = path.match(/^\/api\/recording\/documents\/([^/]+)$/)
		if (m === "GET" && recDoc) {
			const text = getRecordedDocumentText(param(recDoc[1]!))
			if (text == null) throw new DeskError(404, "There is no such document in the recording.")
			res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
			return res.end(text)
		}
		if (m === "POST" && path === "/api/documents") {
			if (!hasKey) throw new DeskError(503, NO_KEY)
			const body = await readBody(req)
			return json(res, 200, addDocument(typeof body.name === "string" ? body.name : "", typeof body.text === "string" ? body.text : ""))
		}
		const action = path.match(/^\/api\/cases\/([^/]+)\/actions$/)
		if (m === "POST" && action) {
			const body = await readBody(req)
			if (!ACTIONS.includes(body.action)) throw new DeskError(400, `Unknown action. Use one of: ${ACTIONS.join(", ")}.`)
			if (body.action === "reprocess" && !hasKey) throw new DeskError(503, NO_KEY)
			return json(res, 200, act(param(action[1]!), body.action, { reason: typeof body.reason === "string" ? body.reason : null, callbackRef: typeof body.callbackRef === "string" ? body.callbackRef : null, resolutions: Array.isArray(body.resolutions) ? body.resolutions.filter((r: any) => r && typeof r.challengeId === "string" && typeof r.chosenRef === "string").slice(0, 12) : null }))
		}
		const draft = path.match(/^\/api\/cases\/([^/]+)\/draft$/)
		if (m === "GET" && draft) {
			const d = exportDraft(param(draft[1]!))
			return json(res, 200, d, { "content-disposition": `attachment; filename="${d.draftId}.json"` })
		}
		// Financial Stress Lab: every execution runs in its own worker process and never touches the state served above.
		if (m === "GET" && path === "/api/lab") return json(res, 200, lab.overview(hasLiveKey))
		if (m === "POST" && path === "/api/lab/runs") return json(res, 200, lab.startRun(await readBody(req), hasLiveKey))
		if (m === "POST" && path === "/api/lab/cancel") return json(res, 200, { cancelled: lab.cancelRun()?.id ?? null })
		const labItem = path.match(/^\/api\/lab\/runs\/([^/]+)\/items\/([^/]+)$/)
		if (m === "GET" && labItem) return json(res, 200, lab.detail(param(labItem[1]!), param(labItem[2]!)))
		const labReport = path.match(/^\/api\/lab\/runs\/([^/]+)\/report$/)
		if (m === "GET" && labReport) {
			const id = param(labReport[1]!)
			const item = url.searchParams.get("item")
			return json(res, 200, lab.report(id, item), { "content-disposition": `attachment; filename="stress-lab-${id}${item ? `-${item.replace(":", "-")}` : ""}.json"` })
		}
		const doc = path.match(/^\/api\/documents\/([^/]+)$/)
		if (m === "GET" && doc) {
			const text = getDocumentText(param(doc[1]!))
			if (text == null) throw new DeskError(404, "There is no such document on the desk.")
			res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
			return res.end(text)
		}
		if (path.startsWith("/api/")) throw new DeskError(404, "Not found.")
		if (m === "GET" && serveStatic(res, path)) return
		json(res, 404, { error: "UI not built. Run `npm run dev` (dev) or `npm run build` first." })
	} catch (err) {
		if (err instanceof DeskError) return json(res, err.status, { error: err.message })
		console.error(err)
		json(res, 500, { error: err instanceof Error ? err.message : String(err) })
	}
})

// Stopping the server saves what the agents have done so far; decisions by a person are already saved when they are made.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { flush(); process.exit(0) })

server.listen(PORT, () => {
	console.log(`Payment Desk API on http://localhost:${PORT}  (${SCRIPTED ? "scripted model: real orchestration, predefined model responses" : `model key: ${hasKey ? "found" : "MISSING: set ANTHROPIC_API_KEY in .env"}`})`)
	if (process.env.NODE_ENV === "production" || SCRIPTED) console.log(existsSync(WEB_DIST) ? `Open http://localhost:${PORT}/#/showcase` : "The UI is not built yet: run `npm run build`, or use `npm run dev`.")
})
