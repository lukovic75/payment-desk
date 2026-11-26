/**
 * Money handling. Amounts are parsed from text straight into integer minor units and stay integers:
 * no value passes through a float, so sums and comparisons are exact.
 */
import type { Minor } from "./domain.js"

/**
 * Parses one written amount ("2.422,54", "1,415.00", "6 740,00", "2744", "EUR 310.00") into minor units.
 * The last separator is the decimal mark when one or two digits follow it and it occurs once;
 * every other separator is a thousands mark. Returns null when the text holds no amount.
 */
export function parseMoney(raw: string | number | null | undefined): Minor | null {
	if (raw == null) return null
	let s = String(raw).trim().replace(/[\s  ']/g, "")
	const negative = /^-|^\(.*\)$/.test(s)
	s = s.replace(/[^\d.,]/g, "")
	if (!/\d/.test(s)) return null
	s = s.replace(/^[.,]+|[.,]+$/g, "")
	const last = Math.max(s.lastIndexOf("."), s.lastIndexOf(","))
	let whole = s
	let frac = ""
	if (last >= 0) {
		const digitsAfter = s.length - last - 1
		const mark = s[last]!
		const occurrences = s.split(mark).length - 1
		if ((digitsAfter === 1 || digitsAfter === 2) && occurrences === 1) {
			whole = s.slice(0, last)
			frac = s.slice(last + 1)
		}
	}
	whole = whole.replace(/[.,]/g, "")
	if (!/^\d+$/.test(whole || "0") || whole.length > 13) return null
	const minor = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0") || "0")
	return negative ? -minor : minor
}

/** Every number written in a piece of text, read as an amount. Used to check that a quote contains the value it is cited for. */
export function amountsIn(text: string): Minor[] {
	const out: Minor[] = []
	for (const token of text.match(/\d[\d.,']*\d|\d/g) ?? []) {
		const m = parseMoney(token)
		if (m != null) out.push(m)
	}
	return out
}

/** Only tokens that are written as money (two decimals). Used where a date or a quantity must not be mistaken for an amount. */
export function strictAmountsIn(text: string): Minor[] {
	const out: Minor[] = []
	for (const token of text.match(/(?<![\d.,])(?:\d{1,3}(?:[.,' ]\d{3})+|\d+)[.,]\d{2}(?![.,]?\d)/g) ?? []) {
		const m = parseMoney(token)
		if (m != null) out.push(m)
	}
	return out
}

export function formatMinor(minor: Minor, currency?: string | null): string {
	const sign = minor < 0 ? "-" : ""
	const abs = Math.abs(minor)
	const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
	const text = `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`
	return currency ? `${text} ${currency}` : text
}

export const normalizeCurrency = (raw: string | null | undefined): string | null => {
	if (!raw) return null
	const s = raw.trim().toUpperCase()
	if (s === "€") return "EUR"
	if (s === "$") return "USD"
	if (s === "£") return "GBP"
	return /^[A-Z]{3}$/.test(s) ? s : null
}

/** Sums amounts per currency. Different currencies are never added together. */
export function sumByCurrency(items: { minor: Minor; currency: string }[]): Record<string, Minor> {
	const out: Record<string, Minor> = {}
	for (const i of items) out[i.currency] = (out[i.currency] ?? 0) + i.minor
	return out
}
