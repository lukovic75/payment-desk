/**
 * Document intake for PDF: validate the file, read its text layer in an isolated thread, and return the text the rest of
 * the desk works on together with a source map (which page and which box each line of that text comes from).
 *
 * This is deterministic preparation, not interpretation. No model is involved, nothing is sent anywhere, and nothing in
 * the document is executed. A PDF with no text layer is refused: there is no OCR here, and no text is ever invented.
 */
import { createHash } from "node:crypto"
import { Worker } from "node:worker_threads"
import type { DocumentSource } from "./domain.js"

/** Conservative limits for a local sandbox. A file is checked against the first two before any parsing starts. */
export const LIMITS = {
	/** Largest PDF accepted, in bytes. */
	pdfBytes: 2_000_000,
	/** Most pages a PDF may have. */
	pages: 10,
	/** Most characters of extracted (or pasted) text the agents are given. The same limit plain text has always had. */
	textChars: 20_000,
	/** A parse that takes longer is stopped. */
	parseMs: 8_000,
	/** Most documents in one upload batch. */
	batch: 8,
	/** PDFs parsed at the same time. */
	concurrent: 2,
}
export const PARSER = "pdfjs-dist 5.4.624 (text layer)"

export type DocumentErrorCode = "empty" | "unsupported" | "too_large" | "invalid" | "encrypted" | "too_many_pages" | "no_text" | "too_long" | "timeout"
export class DocumentError extends Error {
	constructor(public code: DocumentErrorCode, message: string, public status = 422) { super(message) }
}

export const fileHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const kB = (n: number) => `${Math.max(1, Math.round(n / 1000))} kB`

/** What the bytes are, judged by their content. A file name or a declared type is never enough. */
export function sniff(bytes: Uint8Array): "pdf" | "text" | "binary" {
	if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-") return "pdf"
	const head = bytes.subarray(0, Math.min(bytes.length, 4096))
	for (const b of head) if (b === 0 || (b < 9) || (b > 13 && b < 32 && b !== 27)) return "binary"
	return "text"
}

let running = 0
const waiting: (() => void)[] = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
	if (running >= LIMITS.concurrent) await new Promise<void>((r) => waiting.push(r))
	running++
	try { return await fn() } finally { running--; waiting.shift()?.() }
}

export type ParsedPdf = { text: string; source: Omit<DocumentSource, "fileName"> }

/** Validates and parses one PDF. Throws a DocumentError that says, in plain words, why a file was not accepted. */
export async function parsePdf(input: Uint8Array): Promise<ParsedPdf> {
	const bytes = Buffer.from(input)
	if (bytes.length === 0) throw new DocumentError("empty", "The file is empty.", 400)
	if (bytes.length > LIMITS.pdfBytes) throw new DocumentError("too_large", `This PDF is ${kB(bytes.length)}. The supported limit is ${kB(LIMITS.pdfBytes)}.`, 413)
	if (sniff(bytes) !== "pdf") throw new DocumentError("unsupported", "This file is not a PDF: it does not start with a PDF signature. Text files and text-based PDFs are supported.", 415)
	const raw = await slot(() => new Promise<any>((resolve, reject) => {
		// A copy goes to the thread, so the original bytes stay untouched for hashing and storage.
		const worker = new Worker(new URL("./pdf-worker.mjs", import.meta.url), { workerData: { bytes: new Uint8Array(bytes), maxPages: LIMITS.pages }, stdout: true, stderr: true })
		let done = false
		const finish = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); fn() }
		const timer = setTimeout(() => finish(() => { void worker.terminate(); reject(new DocumentError("timeout", `This PDF took longer than ${LIMITS.parseMs / 1000} seconds to parse and was stopped.`)) }), LIMITS.parseMs)
		worker.once("message", (m) => finish(() => resolve(m)))
		worker.once("error", () => finish(() => reject(new DocumentError("invalid", "This file could not be parsed as a valid PDF."))))
		worker.once("exit", () => finish(() => reject(new DocumentError("invalid", "This file could not be parsed as a valid PDF."))))
	}))
	if (!raw?.ok) throw new DocumentError(raw?.code ?? "invalid", raw?.message ?? "This file could not be parsed as a valid PDF.")
	const lines = raw.lines as { page: number; line: number; text: string; box: [number, number, number, number] | null }[]
	const text = lines.map((l) => l.text).join("\n")
	if (text.replace(/\s+/g, "").length < 20) throw new DocumentError("no_text", "This PDF does not contain extractable text. Scanned documents are not supported yet: there is no OCR in this build.")
	if (text.length > LIMITS.textChars) throw new DocumentError("too_long", `The text of this PDF is ${text.length} characters. The supported limit is ${LIMITS.textChars}.`, 413)
	return {
		text,
		source: {
			format: "pdf", mime: "application/pdf", size: bytes.length, fileHash: fileHash(bytes), parser: PARSER,
			pages: raw.pages, warnings: raw.warnings ?? [],
			// one entry per line of `text`, in the same order: line n of the text is lines[n - 1]
			lines: lines.map((l) => ({ page: l.page, line: l.line, box: l.box })),
		},
	}
}
