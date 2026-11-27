/** HTTP API + Server-Sent Events for the Payment Desk UI. No framework: node:http is enough. */
import "dotenv/config"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { extname, join, normalize, dirname, sep } from "node:path"
import { fileURLToPath } from "node:url"
import * as lab from "./lab/manager.js"
import { randomUUID } from "node:crypto"
import { DeskError, MODELS, act, addDocument, exportDraft, findSame, flush, getDocumentFile, getDocumentSource, getDocumentText, getRecordedDocumentText, pdfFixtureBytes, pdfFixtures, prepare, recordingView, resetDemo, runDemo, runShowcaseStep, setModelRunner, snapshot, startShowcase, subscribe, type Action } from "./desk.js"
import { contentHash, loadDocuments } from "./data.js"
import type { DocumentSource } from "./domain.js"
import { DocumentError, LIMITS, parsePdf, sniff } from "./pdf.js"

const PORT = Number(process.env.API_PORT ?? 8787)
// A local sandbox with no sign-in: it listens on this machine only. HOST=0.0.0.0 exposes it to the network, including the
// endpoints that spend model credit; do that only behind something that controls access.
const HOST = process.env.HOST ?? "127.0.0.1"
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])
const hostnameOf = (v: string | undefined): string => { try { return new URL(/^[a-z]+:\/\//i.test(v ?? "") ? v! : `http://${v}`).hostname } catch { return "" } }

/**
 * Two cheap protections for a server that trusts whoever reaches it. The Host header has to be this machine (so a web
 * page cannot reach it through a hostname it controls), and a request that changes something has to come from a page
 * on this machine (so another site open in the same browser cannot start a run that spends provider credit).
 */
function guard(req: IncomingMessage) {
	const host = hostnameOf(req.headers.host)
	if (LOOPBACK.has(HOST) && !LOOPBACK.has(host)) throw new DeskError(403, "This server answers only on this machine.")
	const origin = req.headers.origin
	if (req.method !== "GET" && origin && !LOOPBACK.has(hostnameOf(origin)) && hostnameOf(origin) !== host) throw new DeskError(403, "Requests from another site are not accepted.")
}
const here = dirname(fileURLToPath(import.meta.url))
const WEB_DIST = join(here, "..", "web", "dist")
// Development only: run the UI against the test-fixture model instead of a live one. The UI says so in a banner.
const SCRIPTED = process.env.DESK_SCRIPTED === "1"
if (SCRIPTED) {
	const [{ scriptedModel }, { READINGS: TEXT_READINGS }, { SHOWCASE_RESPONSES: BASE }, { PDF_READINGS, PDF_RESPONSES }] = await Promise.all([import("./test/scripted.js"), import("./test/fixtures.js"), import("./test/showcase-responses.js"), import("./test/pdf-fixtures.js")])
	const READINGS = { ...TEXT_READINGS, ...PDF_READINGS }
	const SHOWCASE_RESPONSES = { audits: { ...BASE.audits, ...PDF_RESPONSES.audits }, validations: { ...BASE.validations, ...PDF_RESPONSES.validations }, investigations: { ...BASE.investigations, ...PDF_RESPONSES.investigations }, policies: { ...BASE.policies, ...PDF_RESPONSES.policies } }
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
const ACTIONS: Action[] = ["approve", "reject", "request_verification", "verify_beneficiary", "verify_amount", "reprocess"]

// A loop that dies must not take the desk down with it; the case's own timeout turns it into a processing error.
process.on("unhandledRejection", (err) => console.error("unhandled rejection in an agent loop:", err))

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers })
	res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage, limit = 200_000): Promise<any> {
	const chunks: Buffer[] = []
	let size = 0
	for await (const c of req) {
		size += (c as Buffer).length
		if (size > limit) throw new DeskError(413, "The request is too large.")
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

// ───────── document intake: validate and parse first, process only when a person says so ─────────

/**
 * A document that has been validated and parsed and is waiting for "Process document". Nothing here has reached an agent.
 * Held in memory for a short while; the list is bounded, so an upload can never grow the server without limit.
 */
type Pending = { token: string; fileName: string; format: "pdf" | "text"; text: string; size: number; textHash: string; at: number; pdf: { bytes: Buffer; source: Omit<DocumentSource, "fileName"> } | null; fixture: string | null }
const pending = new Map<string, Pending>()
const PENDING_MAX = 24
const PENDING_MS = 20 * 60_000
/**
 * The scripted model has fixed answers for the synthetic fixtures and for nothing else. A fixture is recognised by the
 * hash of its text, never by its name, so an arbitrary document cannot borrow a fixture's answers.
 */
const FIXTURES: Map<string, string> = SCRIPTED ? new Map([...loadDocuments().map((d) => [d.hash, d.id] as const), ...pdfFixtures().map((f) => [f.textHash, f.docId] as const)]) : new Map()
const NEEDS_LIVE = "The document was parsed successfully. Live AI access is required to interpret this invoice because it is not a registered scripted fixture."

async function inspect(body: any) {
	const fileName = (typeof body.name === "string" ? body.name : "").replace(/[\\/\u0000-\u001f]+/g, "_").slice(0, 120) || "document"
	let text: string, size: number, pdf: Pending["pdf"] = null
	if (typeof body.pdf === "string") {
		if (body.pdf.length > Math.ceil(LIMITS.pdfBytes / 3) * 4 + 16) throw new DeskError(413, `This PDF is larger than the supported limit of ${LIMITS.pdfBytes / 1000} kB.`)
		const bytes = Buffer.from(body.pdf, "base64")
		const parsed = await parsePdf(bytes)
		text = parsed.text; size = bytes.length; pdf = { bytes, source: parsed.source }
	} else if (typeof body.text === "string") {
		text = body.text; size = Buffer.byteLength(text)
		const kind = sniff(Buffer.from(text.slice(0, 4096)))
		if (kind === "pdf") throw new DeskError(415, "This is a PDF that was sent as text. Choose the file itself so that its pages can be read.")
		if (kind === "binary" || /\u0000/.test(text)) throw new DeskError(415, "This file is not a text document or a PDF. Text files and text-based PDFs are supported.")
		if (text.trim().length < 20) throw new DeskError(400, "This document has almost no text. Paste or choose a document with at least a few lines.")
		if (text.length > LIMITS.textChars) throw new DeskError(413, `This document is ${text.length} characters long. The supported limit is ${LIMITS.textChars}.`)
	} else throw new DeskError(400, "Send a document as `text` or as `pdf` (base64).")
	const now = Date.now()
	for (const [k, p] of pending) if (now - p.at > PENDING_MS) pending.delete(k)
	while (pending.size >= PENDING_MAX) pending.delete(pending.keys().next().value!)
	const textHash = contentHash(text)
	const p: Pending = { token: randomUUID(), fileName, format: pdf ? "pdf" : "text", text, size, textHash, at: now, pdf, fixture: FIXTURES.get(textHash) ?? null }
	pending.set(p.token, p)
	return describe(p)
}
function describe(p: Pending) {
	const interpretable = hasKey && (!SCRIPTED || p.fixture != null)
	return {
		token: p.token, fileName: p.fileName, format: p.format, size: p.size, chars: p.text.length, lines: p.text.split("\n").length,
		pages: p.pdf?.source.pages.length ?? null, fileHash: p.pdf?.source.fileHash ?? null, textHash: p.textHash, parser: p.pdf?.source.parser ?? null, warnings: p.pdf?.source.warnings ?? [],
		same: findSame(p.textHash, p.pdf?.source.fileHash ?? null),
		interpretable, note: interpretable ? null : !hasKey ? NO_KEY : NEEDS_LIVE,
	}
}
const taken = (token: unknown): Pending => {
	const p = typeof token === "string" ? pending.get(token) : undefined
	if (!p) throw new DeskError(404, "That document is no longer waiting. Add it again.")
	return p
}
const sendPdf = (res: ServerResponse, bytes: Buffer, fileName: string) => {
	// The file is served as an inert document: no sniffing, no scripts, no navigation, and never as an attachment of another type.
	res.writeHead(200, { "content-type": "application/pdf", "content-length": String(bytes.length), "content-disposition": `inline; filename="${fileName.replace(/[^A-Za-z0-9 ._()-]+/g, "_")}"`, "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "cache-control": "no-store" })
	res.end(bytes)
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon" }

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
		if (path.startsWith("/api/")) guard(req)
		if (m === "GET" && path === "/api/health") return json(res, 200, { ok: true, hasModelKey: hasKey, hasLiveKey, mode: SCRIPTED ? "scripted" : "live", models: MODELS, limits: LIMITS })
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
		// Step one of intake: validate and parse. No agent runs and no model is called here, whatever the document is.
		if (m === "POST" && path === "/api/documents/inspect") return json(res, 200, await inspect(await readBody(req, Math.ceil(LIMITS.pdfBytes / 3) * 4 + 4096)))
		const waiting = path.match(/^\/api\/pending\/([^/]+)\/(file|text)$/)
		if (m === "GET" && waiting) {
			const p = taken(param(waiting[1]!))
			if (waiting[2] === "file") { if (!p.pdf) throw new DeskError(404, "This document is not a PDF."); return sendPdf(res, p.pdf.bytes, p.fileName) }
			return json(res, 200, { text: p.text, source: p.pdf ? { ...p.pdf.source, fileName: p.fileName, available: true } : { format: "text", fileName: p.fileName } })
		}
		if (m === "DELETE" && path.startsWith("/api/pending/")) { pending.delete(param(path.slice("/api/pending/".length))); return json(res, 200, { ok: true }) }
		if (m === "GET" && path === "/api/samples") return json(res, 200, pdfFixtures().filter((f) => f.sample).map((f) => ({ file: f.file, label: f.label, pages: f.pages, size: f.size })))
		const sample = path.match(/^\/api\/samples\/([^/]+)$/)
		if (m === "GET" && sample) {
			const f = pdfFixtures().find((k) => k.sample && k.file === param(sample[1]!))
			const bytes = f && pdfFixtureBytes(f.file)
			if (!f || !bytes) throw new DeskError(404, "There is no such sample.")
			return sendPdf(res, bytes, f.file)
		}
		// Step two: a person asks for a parsed document to be processed. Only now does the workflow start.
		if (m === "POST" && path === "/api/documents") {
			if (!hasKey) throw new DeskError(503, NO_KEY)
			const body = await readBody(req)
			if (typeof body.token === "string") {
				const p = taken(body.token)
				if (SCRIPTED && !p.fixture) throw new DeskError(409, NEEDS_LIVE)
				// On the scripted model a fixture runs under its own id, because that is what its predefined answers belong to.
				const c = addDocument(p.fixture ?? p.fileName, p.text, "user", undefined, p.pdf ? { fileName: p.fileName, bytes: p.pdf.bytes, source: p.pdf.source } : undefined)
				pending.delete(p.token)
				return json(res, 200, c)
			}
			return json(res, 200, addDocument(typeof body.name === "string" ? body.name : "", typeof body.text === "string" ? body.text : ""))
		}
		const original = path.match(/^\/api\/documents\/([^/]+)\/(source|file)$/)
		if (m === "GET" && original) {
			const id = param(original[1]!)
			if (original[2] === "source") {
				const s = getDocumentSource(id)
				if (!s) throw new DeskError(404, "There is no such document on the desk.")
				return json(res, 200, s)
			}
			const f = getDocumentFile(id)
			if (!f) throw new DeskError(404, "The original file of this document is not available.")
			return sendPdf(res, f.bytes, f.fileName)
		}
		const action = path.match(/^\/api\/cases\/([^/]+)\/actions$/)
		if (m === "POST" && action) {
			const body = await readBody(req)
			if (!ACTIONS.includes(body.action)) throw new DeskError(400, `Unknown action. Use one of: ${ACTIONS.join(", ")}.`)
			if (body.action === "reprocess" && !hasKey) throw new DeskError(503, NO_KEY)
			return json(res, 200, act(param(action[1]!), body.action, { reason: typeof body.reason === "string" ? body.reason : null, callbackRef: typeof body.callbackRef === "string" ? body.callbackRef : null, confirmationRef: typeof body.confirmationRef === "string" ? body.confirmationRef : null, resolutions: Array.isArray(body.resolutions) ? body.resolutions.filter((r: any) => r && typeof r.challengeId === "string" && typeof r.chosenRef === "string").slice(0, 12) : null }))
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
		if (err instanceof DocumentError) return json(res, err.status, { error: err.message, code: err.code })
		console.error(err)
		json(res, 500, { error: err instanceof Error ? err.message : String(err) })
	}
})

// Stopping the server saves what the agents have done so far; decisions by a person are already saved when they are made.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { flush(); process.exit(0) })

await prepare()
server.listen(PORT, HOST, () => {
	if (!LOOPBACK.has(HOST)) console.log(`Listening on ${HOST}: reachable from the network, with no sign-in. Anyone who can reach it can start runs.`)
	console.log(`Payment Desk API on http://localhost:${PORT}  (${SCRIPTED ? "scripted model: real orchestration, predefined model responses" : `model key: ${hasKey ? "found" : "MISSING: set ANTHROPIC_API_KEY in .env"}`})`)
	if (process.env.NODE_ENV === "production" || SCRIPTED) console.log(existsSync(WEB_DIST) ? `Open http://localhost:${PORT}/#/showcase` : "The UI is not built yet: run `npm run build`, or use `npm run dev`.")
})
