import { useEffect, useRef, useState } from "react"
import type { AgentRun, Control, DeskSnapshot, EvidenceEntry, PaymentCase, Policy, ReviewEntry, Scenario, TimelineEntry, Vendor } from "../../../server/domain"

export type { AgentRun, Control, DeskSnapshot, EvidenceEntry, PaymentCase, Policy, ReviewEntry, Scenario, TimelineEntry, Vendor }
export type Tokens = Record<string, { input: number; output: number; calls: number }>
export type Health = { ok: boolean; hasModelKey: boolean; models: { fast: string; careful: string } }
export type Link = { state: "connecting" | "live" | "reconnecting"; attempts: number }
export type Action = "approve" | "reject" | "request_verification" | "verify_beneficiary" | "reprocess"

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
					const old = s.cases.find((o) => o.id === c.id)
					if (old && old.version > c.version && old.attempt >= c.attempt) return s
					const cases = old ? s.cases.map((o) => (o.id === c.id ? c : o)) : [...s.cases, c]
					return { ...s, cases, inboxWaiting: cases.some((k) => k.origin === "demo") ? 0 : s.inboxWaiting }
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

export const runDemo = async (): Promise<DeskSnapshot> => expectOk(await post("/api/run"))
export const resetDemo = async (): Promise<DeskSnapshot> => expectOk(await post("/api/reset"))
export const act = async (id: string, action: Action, input: { reason?: string; callbackRef?: string } = {}): Promise<PaymentCase> =>
	expectOk(await post(`/api/cases/${encodeURIComponent(id)}/actions`, { action, ...input }))
export const addDocument = async (name: string, text: string): Promise<PaymentCase> => expectOk(await post("/api/documents", { name, text }))
export const draftUrl = (id: string) => `/api/cases/${encodeURIComponent(id)}/draft`

export async function fetchDocument(id: string): Promise<string> {
	const r = await fetch(`/api/documents/${encodeURIComponent(id)}`)
	if (!r.ok) throw new Error(`The source document could not be loaded (${r.status}).`)
	return r.text()
}
