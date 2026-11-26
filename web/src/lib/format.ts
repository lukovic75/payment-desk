/** Amounts arrive as integer minor units and are only turned into text here. */
export function amount(minor: number | null | undefined): string {
	if (minor == null) return ""
	const sign = minor < 0 ? "-" : ""
	const abs = Math.abs(minor)
	return `${sign}${String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(abs % 100).padStart(2, "0")}`
}
export const money = (minor: number | null | undefined, ccy?: string | null) => (minor == null ? "" : `${amount(minor)}${ccy ? ` ${ccy}` : ""}`)

/** Totals per currency. Currencies are listed side by side, never added. */
export function totals(items: ({ minor: number; currency: string } | null | undefined)[]): { currency: string; minor: number }[] {
	const out = new Map<string, number>()
	for (const i of items) if (i) out.set(i.currency, (out.get(i.currency) ?? 0) + i.minor)
	return [...out].map(([currency, minor]) => ({ currency, minor }))
}
export const totalsText = (items: ({ minor: number; currency: string } | null | undefined)[]) => totals(items).map((t) => money(t.minor, t.currency)).join(" · ")

export const count = (n: number) => new Intl.NumberFormat("en-IE").format(n)
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
	return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : isoDate
}

export function dueLabel(isoDate: string | null | undefined, today = new Date()): { text: string; overdue: boolean } | null {
	if (!isoDate) return null
	if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return { text: `due ${isoDate}`, overdue: false }
	const d = Math.round((new Date(`${isoDate}T00:00:00`).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000)
	if (d < 0) return { text: `overdue ${-d} d`, overdue: true }
	return { text: d === 0 ? "due today" : `due in ${d} d`, overdue: false }
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
export const words = (s: string) => s.replace(/_/g, " ").toLowerCase()
export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches
/** Agents answer in Markdown; the log shows their words as plain text. */
export const plain = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "").replace(/\s*\n+\s*/g, " ").trim()
