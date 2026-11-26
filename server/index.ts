/** HTTP API + Server-Sent Events for the Payment Desk UI. No framework: node:http is enough. */
import "dotenv/config"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { addDocument, getDocumentText, recordHumanDecision, runDesk, snapshot, subscribe, MODELS } from "./desk.js"

const PORT = Number(process.env.API_PORT ?? 8787)
const here = dirname(fileURLToPath(import.meta.url))
const WEB_DIST = join(here, "..", "web", "dist")
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY)

const json = (res: ServerResponse, status: number, body: unknown) => {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
	res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<any> {
	const chunks: Buffer[] = []
	for await (const c of req) chunks.push(c as Buffer)
	const raw = Buffer.concat(chunks).toString("utf8")
	return raw ? JSON.parse(raw) : {}
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".ico": "image/x-icon" }

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
	try {
		if (req.method === "GET" && path === "/api/health") return json(res, 200, { ok: true, hasModelKey: hasKey, models: MODELS })
		if (req.method === "GET" && path === "/api/state") return json(res, 200, snapshot())
		if (req.method === "GET" && path === "/api/events") {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" })
			res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`)
			const unsubscribe = subscribe((e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`))
			const ping = setInterval(() => res.write(": ping\n\n"), 15_000)
			req.on("close", () => { unsubscribe(); clearInterval(ping) })
			return
		}
		if (req.method === "POST" && path === "/api/run") {
			if (!hasKey) return json(res, 503, { error: "No model API key. Copy .env.example to .env and set ANTHROPIC_API_KEY, then restart." })
			return json(res, 200, runDesk())
		}
		if (req.method === "POST" && path === "/api/documents") {
			if (!hasKey) return json(res, 503, { error: "No model API key. Copy .env.example to .env and set ANTHROPIC_API_KEY, then restart." })
			const body = await readBody(req)
			const text = typeof body.text === "string" ? body.text.trim() : ""
			if (text.length < 20) return json(res, 400, { error: "Paste the text of a document first (at least a few lines)." })
			if (text.length > 20_000) return json(res, 400, { error: "That document is too long for the demo (max 20,000 characters)." })
			return json(res, 200, addDocument(typeof body.name === "string" ? body.name : "", text))
		}
		const decision = path.match(/^\/api\/cases\/([^/]+)\/(approve|reject)$/)
		if (req.method === "POST" && decision) {
			const body = await readBody(req)
			const c = recordHumanDecision(decodeURIComponent(decision[1]!), decision[2] === "approve" ? "approved" : "rejected", typeof body.note === "string" && body.note.trim() ? body.note.trim() : null)
			return json(res, 200, c)
		}
		const doc = path.match(/^\/api\/documents\/([^/]+)$/)
		if (req.method === "GET" && doc) {
			const text = getDocumentText(decodeURIComponent(doc[1]!))
			if (text == null) return json(res, 404, { error: "unknown document" })
			res.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
			return res.end(text)
		}
		if (path.startsWith("/api/")) return json(res, 404, { error: "not found" })
		if (req.method === "GET" && serveStatic(res, path)) return
		json(res, 404, { error: "UI not built. Run `npm run dev` (dev) or `npm run build` first." })
	} catch (err) {
		json(res, 400, { error: err instanceof Error ? err.message : String(err) })
	}
})

server.listen(PORT, () => {
	console.log(`Payment Desk API on http://localhost:${PORT}  (model key: ${hasKey ? "found" : "MISSING — set ANTHROPIC_API_KEY in .env"})`)
})
