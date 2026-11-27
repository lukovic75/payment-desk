/**
 * Reads the text layer of one PDF, in its own thread so that a hostile or broken file can be stopped by a timeout
 * without taking the desk down. Plain JavaScript on purpose: it runs the same way under tsx, the test runner and CI.
 *
 * Nothing in the document is executed: no scripts, no fonts from the system, no XFA, no fetching. Only page geometry and
 * text items are read. The result is the text line by line with the page and the box each line occupies.
 */
import { parentPort, workerData } from "node:worker_threads"
import { getDocument, Util, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs"

const { bytes, maxPages } = workerData
const fail = (code, message) => parentPort.postMessage({ ok: false, code, message })
const round = (n) => Math.round(n * 100) / 100

try {
	const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false, stopAtErrors: false, verbosity: VerbosityLevel.ERRORS })
	let doc
	try { doc = await task.promise }
	catch (err) {
		if (err?.name === "PasswordException") fail("encrypted", "This PDF is encrypted or password-protected. Protected documents are not supported.")
		else fail("invalid", "This file could not be parsed as a valid PDF.")
		process.exit(0)
	}
	if (doc.numPages > maxPages) { fail("too_many_pages", `This document has ${doc.numPages} pages. The supported limit is ${maxPages}.`); process.exit(0) }

	const pages = []
	const lines = []
	const warnings = []
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n)
		const viewport = page.getViewport({ scale: 1 })
		pages.push({ n, w: round(viewport.width), h: round(viewport.height), rotate: page.rotate })
		const content = await page.getTextContent({ includeMarkedContent: false })
		// Every text item in viewport space at scale 1: origin top-left, y down, the page's own rotation already applied.
		const items = []
		let skewed = 0
		for (const it of content.items) {
			if (typeof it.str !== "string" || it.str.trim() === "") continue
			const tx = Util.transform(viewport.transform, it.transform)
			const size = Math.hypot(tx[2], tx[3])
			const angle = Math.atan2(tx[1], tx[0])
			if (Math.abs(angle) > 0.01) { skewed++ }
			items.push({ s: it.str, x: tx[4], y: tx[5], w: it.width, size, straight: Math.abs(angle) <= 0.01 })
		}
		if (skewed) warnings.push(`Page ${n} has ${skewed} piece${skewed === 1 ? "" : "s"} of text that is not horizontal; its position is given by page only.`)
		// Lines: items on the same baseline, left to right. Baselines within a third of the text height are one line.
		items.sort((a, b) => a.y - b.y || a.x - b.x)
		const rows = []
		for (const it of items) {
			const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(1.5, it.size * 0.33))
			if (row) row.items.push(it)
			else rows.push({ y: it.y, items: [it] })
		}
		rows.sort((a, b) => a.y - b.y)
		let k = 0
		for (const row of rows) {
			row.items.sort((a, b) => a.x - b.x)
			let text = ""
			let end = null
			for (const it of row.items) {
				// a visible gap between two items is a space; items that touch are one word
				if (end != null && it.x - end > it.size * 0.18 && !text.endsWith(" ") && !it.s.startsWith(" ")) text += " "
				text += it.s
				end = it.x + it.w
			}
			text = text.replace(/\s+$/g, "")
			if (!text) continue
			k++
			const straight = row.items.every((i) => i.straight)
			const x0 = Math.min(...row.items.map((i) => i.x)), x1 = Math.max(...row.items.map((i) => i.x + i.w))
			const top = Math.min(...row.items.map((i) => i.y - i.size * 0.82)), bottom = Math.max(...row.items.map((i) => i.y + i.size * 0.24))
			// a box is given only when it is known: horizontal text with a measured width, inside the page
			const known = straight && row.items.every((i) => i.w > 0) && x0 >= -1 && x1 <= viewport.width + 1 && top >= -1 && bottom <= viewport.height + 1
			lines.push({ page: n, line: k, text, box: known ? [round(x0), round(top), round(x1), round(bottom)] : null })
		}
		page.cleanup()
	}
	await task.destroy()
	parentPort.postMessage({ ok: true, pages, lines, warnings })
} catch (err) {
	fail("invalid", "This file could not be parsed as a valid PDF.")
}
process.exit(0)
