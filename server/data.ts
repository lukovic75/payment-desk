import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { Policy, SourceDocument, Vendor } from "./domain.js"

const here = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = join(here, "data")

export function loadVendors(): Vendor[] {
	return JSON.parse(readFileSync(join(DATA_DIR, "vendors.json"), "utf8"))
}

export function loadPolicy(): Policy {
	return JSON.parse(readFileSync(join(DATA_DIR, "policy.json"), "utf8"))
}

/** Every .txt in data/documents is one inbox item. The file name (without extension) is the case id. */
export function loadDocuments(): SourceDocument[] {
	const dir = join(DATA_DIR, "documents")
	const base = Date.parse("2026-11-26T08:00:00Z")
	return readdirSync(dir)
		.filter((f) => f.endsWith(".txt"))
		.sort()
		.map((fileName, i) => ({
			id: fileName.replace(/\.txt$/, ""),
			fileName,
			text: readFileSync(join(dir, fileName), "utf8"),
			receivedAt: new Date(base + i * 97_000).toISOString(),
		}))
}

/** Find the 1-based line of a quote inside the document; null when it is not there verbatim. */
export function findLine(text: string, quote: string): number | null {
	const needle = quote.trim()
	if (!needle) return null
	const lines = text.split("\n")
	const idx = lines.findIndex((l) => l.includes(needle))
	if (idx >= 0) return idx + 1
	const loose = needle.replace(/\s+/g, " ").toLowerCase()
	const idx2 = lines.findIndex((l) => l.replace(/\s+/g, " ").toLowerCase().includes(loose))
	return idx2 >= 0 ? idx2 + 1 : null
}
