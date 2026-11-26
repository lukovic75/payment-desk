import { useEffect, useRef, useState } from "react"
import type { DeskSnapshot, PaymentCase, TimelineEntry } from "../../server/domain"

export type { DeskSnapshot, PaymentCase, TimelineEntry }
export type Tokens = Record<string, { input: number; output: number; calls: number }>
export type Health = { ok: boolean; hasModelKey: boolean; models: { fast: string; careful: string } }

export type Live = {
	snapshot: DeskSnapshot | null
	tokens: Tokens
	connected: boolean
	health: Health | null
}

/** One EventSource for the whole app. Snapshot first, then incremental case / timeline / token updates. */
export function useDesk(): Live {
	const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null)
	const [tokens, setTokens] = useState<Tokens>({})
	const [connected, setConnected] = useState(false)
	const [health, setHealth] = useState<Health | null>(null)
	const retry = useRef(0)

	useEffect(() => {
		fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth({ ok: false, hasModelKey: false, models: { fast: "", careful: "" } }))
	}, [])

	useEffect(() => {
		let es: EventSource | null = null
		let closed = false
		const open = () => {
			es = new EventSource("/api/events")
			es.addEventListener("open", () => { setConnected(true); retry.current = 0 })
			es.addEventListener("snapshot", (e) => setSnapshot(JSON.parse((e as MessageEvent).data)))
			es.addEventListener("desk.started", (e) => { setTokens({}); setSnapshot(JSON.parse((e as MessageEvent).data).payload) })
			es.addEventListener("case.updated", (e) => {
				const c: PaymentCase = JSON.parse((e as MessageEvent).data).payload
				setSnapshot((s) => s && { ...s, cases: s.cases.map((o) => (o.id === c.id ? { ...c, timeline: c.timeline.length >= o.timeline.length ? c.timeline : o.timeline } : o)), dailyAutoApproved: dailyAuto(s.cases.map((o) => (o.id === c.id ? c : o))) })
			})
			es.addEventListener("timeline", (e) => {
				const p = JSON.parse((e as MessageEvent).data).payload as TimelineEntry & { caseId: string }
				setSnapshot((s) => s && { ...s, cases: s.cases.map((o) => (o.id === p.caseId && !o.timeline.some((t) => t.at === p.at && t.detail === p.detail) ? { ...o, timeline: [...o.timeline, { at: p.at, agent: p.agent, kind: p.kind, detail: p.detail }] } : o)) })
			})
			es.addEventListener("tokens", (e) => setTokens(JSON.parse((e as MessageEvent).data).payload))
			es.onerror = () => {
				setConnected(false)
				es?.close()
				if (closed) return
				const wait = Math.min(8000, 500 * 2 ** retry.current++)
				setTimeout(open, wait)
			}
		}
		open()
		return () => { closed = true; es?.close() }
	}, [])

	return { snapshot, tokens, connected, health }
}

function dailyAuto(cases: PaymentCase[]): number {
	return cases.filter((c) => c.approval?.by === "policy" && c.approval.decision === "approved").reduce((s, c) => s + (c.extraction.result?.amount ?? 0), 0)
}

export async function startRun(): Promise<{ error?: string }> {
	const r = await fetch("/api/run", { method: "POST" })
	return r.ok ? {} : r.json()
}

export async function decide(id: string, decision: "approve" | "reject", note: string): Promise<PaymentCase> {
	const r = await fetch(`/api/cases/${encodeURIComponent(id)}/${decision}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ note }) })
	if (!r.ok) throw new Error((await r.json()).error ?? r.statusText)
	return r.json()
}

export async function fetchDocument(id: string): Promise<string> {
	const r = await fetch(`/api/documents/${encodeURIComponent(id)}`)
	if (!r.ok) throw new Error("document not found")
	return r.text()
}

export const money = (n: number | null | undefined, ccy?: string | null) =>
	n == null ? "" : `${new Intl.NumberFormat("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${ccy ?? ""}`.trim()
