/** HTTP API + Server-Sent Events for the Payment Desk UI. No framework: node:http is enough. */
import "dotenv/config"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { DeskError, MODELS, act, addDocument, exportDraft, getDocumentText, resetDemo, runDemo, setModelRunner, snapshot, subscribe, type Action } from "./desk.js"

const PORT = Number(process.env.API_PORT ?? 8787)
const here = dirname(fileURLToPath(import.meta.url))
const WEB_DIST = join(here, "..", "web", "dist")
// Development only: run the UI against the test-fixture model instead of a live one. The UI says so in a banner.
const SCRIPTED = process.env.DESK_SCRIPTED === "1"
if (SCRIPTED) {
	const [{ scriptedModel }, { READINGS }] = await Promise.all([import("./test/scripted.js"), import("./test/fixtures.js")])
	setModelRunner(scriptedModel({ readings: READINGS, policy: "AUTO_APPROVED" }), "scripted")
}
const hasKey = SCRIPTED || Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)
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
	try { return JSON.parse(raw) } catch { throw new DeskError(400, "The request body is not valid JSON.") }
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" }

function serveStatic(res: ServerResponse, urlPath: string): boolean {
	if (!existsSync(WEB_DIST)) return false
	let file = join(WEB_DIST, normalize(urlPath).replace(/^(\.\.[/\\])+/, ""))
	if (!file.startsWith(WEB_DIST)) return false
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
		if (m === "GET" && path === "/api/health") return json(res, 200, { ok: true, hasModelKey: hasKey, models: MODELS })
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
			return json(res, 200, act(decodeURIComponent(action[1]!), body.action, { reason: typeof body.reason === "string" ? body.reason : null, callbackRef: typeof body.callbackRef === "string" ? body.callbackRef : null }))
		}
		const draft = path.match(/^\/api\/cases\/([^/]+)\/draft$/)
		if (m === "GET" && draft) {
			const d = exportDraft(decodeURIComponent(draft[1]!))
			return json(res, 200, d, { "content-disposition": `attachment; filename="${d.draftId}.json"` })
		}
		const doc = path.match(/^\/api\/documents\/([^/]+)$/)
		if (m === "GET" && doc) {
			const text = getDocumentText(decodeURIComponent(doc[1]!))
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

server.listen(PORT, () => {
	console.log(`Payment Desk API on http://localhost:${PORT}  (model key: ${hasKey ? "found" : "MISSING: set ANTHROPIC_API_KEY in .env"})`)
})
