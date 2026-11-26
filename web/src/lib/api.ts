import { useEffect, useRef, useState } from "react"
import type { Checks, DeskSnapshot, PaymentCase, Policy, TimelineEntry, Vendor } from "../../../server/domain"

export type { Checks, DeskSnapshot, PaymentCase, Policy, TimelineEntry, Vendor }
export type Tokens = Record<string, { input: number; output: number; calls: number }>
export type Health = { ok: boolean; hasModelKey: boolean; models: { fast: string; careful: string } }
export type Link = { state: "connecting" | "live" | "reconnecting"; attempts: number }

export type Desk = {
	/** null until the first snapshot arrives. */
	snapshot: DeskSnapshot | null
	tokens: Tokens
	link: Link
	health: Health | null
}

/** One EventSource for the whole app: a snapshot first, then incremental case, timeline, token and runtime updates. */
export function useDesk(): Desk {
	const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null)
	const [tokens, setTokens] = useState<Tokens>({})
	const [link, setLink] = useState<Link>({ state: "connecting", attempts: 0 })
	const [health, setHealth] = useState<Health | null>(null)
	const attempts = useRef(0)

	useEffect(() => {
		let es: EventSource | null = null
		let closed = false
		let timer: ReturnType<typeof setTimeout> | undefined
		let lastSeen = Date.now()
		const data = (e: Event) => { lastSeen = Date.now(); return JSON.parse((e as MessageEvent).data) }
		const drop = () => {
			es?.close()
			if (closed) return
			attempts.current += 1
			setLink({ state: "reconnecting", attempts: attempts.current })
			clearTimeout(timer)
			timer = setTimeout(open, Math.min(8000, 500 * 2 ** Math.min(attempts.current, 4)))
		}
		const open = () => {
			es = new EventSource("/api/events")
			es.addEventListener("ping", () => { lastSeen = Date.now() })
			es.addEventListener("open", () => {
				lastSeen = Date.now()
				attempts.current = 0
				setLink({ state: "live", attempts: 0 })
				fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null))
			})
			es.addEventListener("snapshot", (e) => setSnapshot(data(e)))
			es.addEventListener("desk.started", (e) => { setTokens({}); setSnapshot(data(e).payload) })
			es.addEventListener("case.updated", (e) => {
				const c: PaymentCase = data(e).payload
				setSnapshot((s) => {
					if (!s) return s
					const exists = s.cases.some((o) => o.id === c.id)
					const cases = exists
						? s.cases.map((o) => (o.id === c.id ? { ...c, timeline: c.timeline.length >= o.timeline.length ? c.timeline : o.timeline } : o))
						: [...s.cases, c]
					return { ...s, cases, inboxWaiting: 0, dailyAutoApproved: dailyAuto(cases) }
				})
			})
			es.addEventListener("timeline", (e) => {
				const p = data(e).payload as TimelineEntry & { caseId: string }
				setSnapshot((s) => s && { ...s, cases: s.cases.map((o) => (o.id === p.caseId && !o.timeline.some((t) => t.at === p.at && t.agent === p.agent && t.detail === p.detail) ? { ...o, timeline: [...o.timeline, { at: p.at, agent: p.agent, kind: p.kind, detail: p.detail }] } : o)) })
			})
			es.addEventListener("tokens", (e) => setTokens(data(e).payload))
			es.addEventListener("mozaik", (e) => {
				const type = (data(e).payload as { type: string }).type
				setSnapshot((s) => s && { ...s, runtime: { ...s.runtime, events: { ...s.runtime.events, [type]: (s.runtime.events[type] ?? 0) + 1 } } })
			})
			es.onerror = drop
		}
		open()
		// The server sends a heartbeat every 10 s. Silence for 25 s means the stream is dead even if no error fired.
		const watchdog = setInterval(() => { if (es?.readyState === EventSource.OPEN && Date.now() - lastSeen > 25_000) drop() }, 5000)
		return () => { closed = true; clearTimeout(timer); clearInterval(watchdog); es?.close() }
	}, [])

	return { snapshot, tokens, link, health }
}

function dailyAuto(cases: PaymentCase[]): number {
	return cases.filter((c) => c.approval?.by === "policy" && c.approval.decision === "approved").reduce((s, c) => s + (c.extraction.result?.amount ?? 0), 0)
}

async function expectOk<T>(r: Response): Promise<T> {
	if (!r.ok) {
		let msg = `${r.status} ${r.statusText}`
		try { msg = (await r.json()).error ?? msg } catch { /* body was not JSON */ }
		throw new Error(msg)
	}
	return r.json()
}
const post = (url: string, body?: unknown) =>
	fetch(url, { method: "POST", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined })

export const startRun = async (): Promise<DeskSnapshot> => expectOk(await post("/api/run"))
export const decide = async (id: string, decision: "approve" | "reject", note: string): Promise<PaymentCase> => expectOk(await post(`/api/cases/${encodeURIComponent(id)}/${decision}`, { note }))
export const retryCase = async (id: string): Promise<PaymentCase> => expectOk(await post(`/api/cases/${encodeURIComponent(id)}/retry`))
export const addDocument = async (name: string, text: string): Promise<PaymentCase> => expectOk(await post("/api/documents", { name, text }))

export async function fetchDocument(id: string): Promise<string> {
	const r = await fetch(`/api/documents/${encodeURIComponent(id)}`)
	if (!r.ok) throw new Error(`The source document could not be loaded (${r.status}).`)
	return r.text()
}
