/**
 * A very small PDF writer, used to produce the synthetic PDF invoices in server/data/documents/pdf and the odd documents
 * the tests need (an image-only page, an encrypted file, too many pages). It writes text with the standard Helvetica
 * fonts, rectangles and rules, and nothing else. The output is deterministic: no dates, no random ids.
 * It is not a general PDF library and is never used to read a PDF.
 */

export type Item =
	| { t: "text"; x: number; y: number; s: string; size?: number; bold?: boolean; align?: "left" | "right"; gray?: number }
	| { t: "rect"; x: number; y: number; w: number; h: number; gray: number }
	| { t: "rule"; x: number; y: number; w: number; gray?: number }
export type PdfOptions = { title?: string; producer?: string; rotate?: 0 | 90; encrypt?: boolean }

export const PAGE = { w: 595, h: 842 }

// Characters outside Latin-1 that WinAnsiEncoding can still write.
const WIN: Record<string, number> = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "Š": 0x8a, "š": 0x9a, "Ž": 0x8e, "ž": 0x9e }
function bytesOf(s: string): number[] {
	const out: number[] = []
	for (const ch of s) {
		const code = ch.codePointAt(0)!
		const b = WIN[ch] ?? (code <= 0xff ? code : 0x3f) // anything else becomes "?": the fixtures do not use it
		if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c)
		out.push(b)
	}
	return out
}
// Helvetica advance widths for the characters that are right-aligned in the fixtures (digits and punctuation), in 1/1000 em.
const WIDTH: Record<string, number> = { " ": 278, ",": 278, ".": 278, "-": 333, ":": 278, "%": 889 }
const widthOf = (s: string, size: number, bold: boolean) => [...s].reduce((w, ch) => w + (/\d/.test(ch) ? 556 : WIDTH[ch] ?? (bold ? 611 : 556)), 0) * size / 1000

function content(items: Item[]): Buffer {
	const parts: Buffer[] = []
	const put = (s: string) => parts.push(Buffer.from(s, "latin1"))
	for (const it of items) {
		if (it.t === "rect") put(`${it.gray} g\n${it.x} ${PAGE.h - it.y - it.h} ${it.w} ${it.h} re f\n`)
		else if (it.t === "rule") put(`${it.gray ?? 0.75} G\n0.5 w\n${it.x} ${PAGE.h - it.y} m ${it.x + it.w} ${PAGE.h - it.y} l S\n`)
		else {
			const size = it.size ?? 10
			const x = it.align === "right" ? it.x - widthOf(it.s, size, !!it.bold) : it.x
			put(`${it.gray ?? 0.1} g\nBT /${it.bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${PAGE.h - it.y} Td (`)
			parts.push(Buffer.from(bytesOf(it.s)))
			put(`) Tj ET\n`)
		}
	}
	return Buffer.concat(parts)
}

/** One PDF from a list of pages, each a list of items positioned from the top-left corner in points. */
export function makePdf(pages: Item[][], opt: PdfOptions = {}): Buffer {
	const objects: Buffer[] = []
	const add = (body: string | Buffer) => { objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body); return objects.length }
	const catalog = add("") // 1, filled in below
	const tree = add("")    // 2
	const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
	const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
	const kids: number[] = []
	for (const items of pages) {
		const stream = content(items)
		const c = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "latin1"), stream, Buffer.from("\nendstream", "latin1")]))
		kids.push(add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}]${opt.rotate ? ` /Rotate ${opt.rotate}` : ""} /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`))
	}
	objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${tree} 0 R >>`, "latin1")
	objects[tree - 1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`, "latin1")
	const esc = (s: string) => Buffer.from(bytesOf(s)).toString("latin1")
	const info = add(`<< /Title (${esc(opt.title ?? "Synthetic document")}) /Producer (${esc(opt.producer ?? "Payment Desk synthetic fixture")}) >>`)
	// An encryption dictionary with placeholder keys: enough for a reader to ask for a password, which is all the tests need.
	const enc = opt.encrypt ? add(`<< /Filter /Standard /V 1 /R 2 /O <${"28".repeat(32)}> /U <${"4e".repeat(32)}> /P -44 >>`) : 0

	const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")]
	const offsets: number[] = []
	let at = chunks[0]!.length
	objects.forEach((body, i) => {
		offsets.push(at)
		const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")])
		chunks.push(b); at += b.length
	})
	const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("")
	const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R${enc ? ` /Encrypt ${enc} 0 R /ID [<${"ab".repeat(16)}> <${"ab".repeat(16)}>]` : ""} >>\nstartxref\n${at}\n%%EOF\n`
	chunks.push(Buffer.from(xref + trailer, "latin1"))
	return Buffer.concat(chunks)
}

// ───────── an invoice layout ─────────

export type InvoiceSpec = {
	/** A covering note on its own first page, as when an invoice arrives attached to an email. */
	cover?: { from: string; to: string; subject: string; body: string[] }
	vendor: { name: string; lines: string[] }
	title: string
	meta: [string, string][]
	columns: [string, string, string, string]
	rows: [string, string, string, string][]
	totals: [string, string, boolean?][]
	payment: string[]
	notes?: string[]
	footer?: string
}

/** A plain, readable invoice on A4: letterhead, title, details, a line-item table, totals and payment details. */
export function invoicePdf(spec: InvoiceSpec, opt: PdfOptions = {}): Buffer {
	const pages: Item[][] = []
	const L = 56, R = PAGE.w - 56
	const footer = (p: Item[]) => p.push({ t: "rule", x: L, y: 790, w: R - L }, { t: "text", x: L, y: 806, s: spec.footer ?? "Synthetic document for the Payment Desk sandbox. Not a real invoice.", size: 8, gray: 0.5 })
	if (spec.cover) {
		const p: Item[] = []
		let y = 84
		for (const [k, v] of [["From:", spec.cover.from], ["To:", spec.cover.to], ["Subject:", spec.cover.subject]] as const) { p.push({ t: "text", x: L, y, s: k, size: 10, gray: 0.45 }, { t: "text", x: L + 58, y, s: v, size: 10 }); y += 17 }
		p.push({ t: "rule", x: L, y: y + 4, w: R - L })
		y += 34
		for (const line of spec.cover.body) { if (line) p.push({ t: "text", x: L, y, s: line, size: 11 }); y += 19 }
		footer(p)
		pages.push(p)
	}
	const p: Item[] = []
	p.push({ t: "rect", x: 0, y: 0, w: PAGE.w, h: 6, gray: 0.2 })
	p.push({ t: "text", x: L, y: 74, s: spec.vendor.name, size: 15, bold: true })
	let y = 92
	for (const line of spec.vendor.lines) { p.push({ t: "text", x: L, y, s: line, size: 9, gray: 0.35 }); y += 13 }
	p.push({ t: "text", x: R, y: 74, s: spec.title, size: 15, bold: true, align: "right" })
	y = Math.max(y, 150) + 14
	for (const [k, v] of spec.meta) { p.push({ t: "text", x: L, y, s: k, size: 10, gray: 0.35 }, { t: "text", x: L + 118, y, s: v, size: 10 }); y += 16 }
	y += 22
	p.push({ t: "rect", x: L, y: y - 13, w: R - L, h: 20, gray: 0.93 })
	const cols = [L + 8, 372, 448, R - 8]
	p.push({ t: "text", x: cols[0]!, y, s: spec.columns[0], size: 9, bold: true }, { t: "text", x: cols[1]!, y, s: spec.columns[1], size: 9, bold: true, align: "right" }, { t: "text", x: cols[2]!, y, s: spec.columns[2], size: 9, bold: true, align: "right" }, { t: "text", x: cols[3]!, y, s: spec.columns[3], size: 9, bold: true, align: "right" })
	y += 24
	for (const row of spec.rows) {
		p.push({ t: "text", x: cols[0]!, y, s: row[0], size: 10 }, { t: "text", x: cols[1]!, y, s: row[1], size: 10, align: "right" }, { t: "text", x: cols[2]!, y, s: row[2], size: 10, align: "right" }, { t: "text", x: cols[3]!, y, s: row[3], size: 10, align: "right" })
		p.push({ t: "rule", x: L, y: y + 7, w: R - L, gray: 0.88 })
		y += 21
	}
	y += 10
	for (const [k, v, strong] of spec.totals) {
		if (strong) p.push({ t: "rule", x: 330, y: y - 13, w: R - 330, gray: 0.3 })
		p.push({ t: "text", x: 338, y, s: k, size: strong ? 11 : 10, bold: !!strong })
		if (v) p.push({ t: "text", x: cols[3]!, y, s: v, size: strong ? 11 : 10, bold: !!strong, align: "right" })
		y += strong ? 22 : 17
	}
	y += 18
	for (const line of spec.notes ?? []) { p.push({ t: "text", x: L, y, s: line, size: 10, bold: /^[A-ZÁÉÍÓÚ ]+:/.test(line) }); y += 16 }
	if (spec.notes?.length) y += 8
	for (const line of spec.payment) { p.push({ t: "text", x: L, y, s: line, size: 10 }); y += 16 }
	footer(p)
	pages.push(p)
	return makePdf(pages, opt)
}
