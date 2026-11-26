const nf = new Intl.NumberFormat("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf0 = new Intl.NumberFormat("en-IE")

export const amount = (n: number | null | undefined) => (n == null ? "" : nf.format(n))
export const money = (n: number | null | undefined, ccy?: string | null) => (n == null ? "" : `${nf.format(n)}${ccy ? ` ${ccy}` : ""}`)
export const count = (n: number) => nf0.format(n)
export const iban = (raw: string | null | undefined) => (raw ? raw.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim() : "")

export const clock = (iso: string, ms = false) => {
	const d = new Date(iso)
	const t = d.toLocaleTimeString("en-GB", { hour12: false })
	return ms ? `${t}.${String(d.getMilliseconds()).padStart(3, "0")}` : t
}

export const duration = (ms: number) => {
	if (ms < 1000) return `${Math.round(ms)} ms`
	const s = ms / 1000
	if (s < 60) return `${s.toFixed(1)} s`
	return `${Math.floor(s / 60)} m ${Math.round(s % 60)} s`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Formats an agent-extracted ISO date. Returns the raw string when it is not a clean YYYY-MM-DD. */
export function day(isoDate: string | null | undefined): string {
	if (!isoDate) return ""
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
	if (!m) return isoDate
	return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** Whole days from today to the date (negative when past). null when the date is not parseable. */
export function daysUntil(isoDate: string | null | undefined, today = new Date()): number | null {
	if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
	const due = new Date(`${isoDate}T00:00:00`)
	const base = new Date(today.getFullYear(), today.getMonth(), today.getDate())
	return Math.round((due.getTime() - base.getTime()) / 86_400_000)
}

export function dueLabel(isoDate: string | null | undefined): { text: string; overdue: boolean } | null {
	const d = daysUntil(isoDate)
	if (d == null) return isoDate ? { text: `due ${isoDate}`, overdue: false } : null
	if (d < 0) return { text: `overdue ${-d} d`, overdue: true }
	if (d === 0) return { text: "due today", overdue: false }
	return { text: `due in ${d} d`, overdue: false }
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/** Agents answer in Markdown; the log shows their words as plain text. */
export const plain = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "").replace(/\s*\n+\s*/g, " ").trim()
