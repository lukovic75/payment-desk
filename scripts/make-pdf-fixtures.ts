/**
 * Writes the synthetic PDF invoices described in server/test/pdf-specs.ts into server/data/documents/pdf, parses each
 * one with the desk's own parser, and records its identity in manifest.json. Run with `npm run fixtures:pdf`.
 * The output is deterministic: running it again produces the same bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { contentHash } from "../server/data.js"
import { parsePdf } from "../server/pdf.js"
import { invoicePdf } from "../server/test/minipdf.js"
import { PDF_FIXTURES } from "../server/test/pdf-specs.js"

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "data", "documents", "pdf")
mkdirSync(dir, { recursive: true })
const manifest = []
for (const f of PDF_FIXTURES) {
	const bytes = invoicePdf(f.spec, { title: `${f.docId} (synthetic)` })
	writeFileSync(join(dir, f.file), bytes)
	const parsed = await parsePdf(bytes)
	manifest.push({ docId: f.docId, file: f.file, label: f.label ?? null, sample: !!f.sample, size: bytes.length, pages: parsed.source.pages.length, lines: parsed.source.lines.length, fileHash: parsed.source.fileHash, textHash: contentHash(parsed.text) })
	console.log(`${f.file}: ${bytes.length} bytes, ${parsed.source.pages.length} page(s), ${parsed.source.lines.length} lines, ${parsed.source.lines.filter((l) => !l.box).length} without a box`)
}
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
if (process.argv.includes("--print")) { const p = await parsePdf(invoicePdf(PDF_FIXTURES[2]!.spec, { title: `${PDF_FIXTURES[2]!.docId} (synthetic)` })); p.text.split("\n").forEach((t, i) => console.log(String(i + 1).padStart(3), `p${p.source.lines[i]!.page}`, JSON.stringify(p.source.lines[i]!.box), t)) }
