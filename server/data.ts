import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { AmountConfirmation, Callback, HistoricalPayment, Policy, PurchaseOrder, Scenario, SourceDocument, Vendor } from "./domain.js"
import { parseMoney } from "./money.js"

const here = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = join(here, "data")

const json = (file: string) => JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"))
const minor = (v: unknown, what: string) => {
	const m = parseMoney(String(v))
	if (m == null) throw new Error(`${what} is not an amount: ${JSON.stringify(v)}`)
	return m
}

export const loadVendors = (): Vendor[] => json("vendors.json")
export const loadCallbacks = (): Callback[] => json("callbacks.json")
export const loadScenarios = (): Scenario[] => json("scenarios.json")
export const loadConfirmations = (): AmountConfirmation[] => json("confirmations.json").map((k: any) => ({ ...k, payableAmount: minor(k.payableAmount, `confirmation ${k.ref}`) }))

export function loadPolicy(): Policy {
	const p = json("policy.json")
	return { ...p, autoApproveLimit: minor(p.autoApproveLimit, "policy.autoApproveLimit"), dailyAutoApproveBudget: minor(p.dailyAutoApproveBudget, "policy.dailyAutoApproveBudget") }
}
export const loadHistory = (): HistoricalPayment[] => json("history.json").map((h: any) => ({ ...h, gross: minor(h.gross, `history ${h.id}`) }))
export const loadPurchaseOrders = (): PurchaseOrder[] => json("purchase-orders.json").map((p: any) => ({ ...p, amount: minor(p.amount, `purchase order ${p.po}`) }))

/** The hash ignores whitespace and case, so a re-saved or renamed copy of a document is still the same document. */
export const contentHash = (text: string) => createHash("sha256").update(text.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex")

/** Every .txt in data/documents is one inbox item. The file name (without extension) is the case id. */
export function loadDocuments(): SourceDocument[] {
	const dir = join(DATA_DIR, "documents")
	const base = Date.parse("2026-11-26T08:00:00Z")
	return readdirSync(dir)
		.filter((f) => f.endsWith(".txt"))
		.sort()
		.map((fileName, i) => {
			const text = readFileSync(join(dir, fileName), "utf8")
			return { id: fileName.replace(/\.txt$/, ""), fileName, text, hash: contentHash(text), receivedAt: new Date(base + i * 97_000).toISOString() }
		})
}

export function countInboxFiles(): number {
	try { return readdirSync(join(DATA_DIR, "documents")).filter((f) => f.endsWith(".txt")).length } catch { return 0 }
}

/** Find the 1-based line range of a quote inside the document; null when it is not there. */
export function locate(text: string, quote: string): { start: number; end: number } | null {
	const needle = quote.trim()
	if (!needle) return null
	const lines = text.split("\n")
	const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase()
	const want = squash(needle)
	const one = lines.findIndex((l) => l.includes(needle))
	if (one >= 0) return { start: one + 1, end: one + 1 }
	const loose = lines.findIndex((l) => squash(l).includes(want))
	if (loose >= 0) return { start: loose + 1, end: loose + 1 }
	// a quote that runs over several lines
	for (let i = 0; i < lines.length; i++) {
		let joined = ""
		for (let j = i; j < Math.min(lines.length, i + 4); j++) {
			joined = squash(`${joined} ${lines[j]}`)
			if (joined.includes(want)) return { start: i + 1, end: j + 1 }
		}
	}
	return null
}
