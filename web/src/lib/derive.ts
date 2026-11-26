/** Everything the UI derives from desk state. Pure functions over what the server recorded; nothing here invents a value. */
import type { AgentRun, Control, PaymentCase } from "./api"
import { cap, plain } from "./format"

export const AGENTS = ["Extractor", "Validator", "Auditor", "Investigator", "Policy"] as const
export type AgentName = (typeof AGENTS)[number]

export const isRunning = (c: PaymentCase) => ["received", "extracting", "checking", "investigating", "deciding"].includes(c.stage)
export const needsPerson = (c: PaymentCase) => c.stage === "awaiting_approval" || c.stage === "blocked"

export function titleOf(c: PaymentCase): string {
	const vendor = Object.values(c.ledger).find((e) => e.category === "vendor_record" && e.id.startsWith("V:"))
	if (vendor?.record?.fields.name) return vendor.record.fields.name
	const x = c.extraction.result
	if (x?.creditorName) return x.creditorName
	const same = Object.values(c.ledger).find((e) => e.id.startsWith("D:same:"))
	if (same?.record) return `Copy of ${same.record.recordId}`
	return x ? cap(x.documentKind) : c.id
}

/** The outcome a case shows, including the ones that are not dispositions. */
export function outcomeOf(c: PaymentCase): string {
	if (c.stage === "not_a_payment") return "NOT_A_PAYMENT"
	if (c.stage === "error") return "PROCESSING_ERROR"
	if (c.stage === "rejected") return "REJECTED"
	if (c.stage === "approved") return c.review.some((r) => r.action === "approve" && r.outcome === "applied") ? "APPROVED_BY_HUMAN" : "AUTO_APPROVED"
	if (c.stage === "blocked") return "BLOCKED"
	if (c.stage === "awaiting_approval") return "NEEDS_APPROVAL"
	return "PROCESSING"
}

// ───────── exceptions: the firewall controls that did not pass ─────────

export const flagged = (c: PaymentCase): Control[] =>
	c.controls.filter((k) => k.status === "fail" || k.status === "review").sort((a, b) => rank(b) - rank(a))
const rank = (k: Control) => (k.status === "fail" && k.severity === "block" ? 10 : k.status === "fail" ? 5 : k.id === "per_payment_limit" || k.id === "daily_limit" ? 1 : 3)
export const isBlocking = (k: Control) => k.status === "fail" && k.severity === "block"
/** An ordering key for the review queue, not a score shown to anyone. */
export const riskRank = (c: PaymentCase) => flagged(c).reduce((s, k) => s + rank(k), 0)

// ───────── agent loops ─────────

export type Loop = { agent: AgentName; caseId: string; title: string; start: number; end: number | null; errored: boolean; run: AgentRun }

/** One entry per agent loop, straight from the run records the server keeps (start, finish, status, model, tokens). */
export function loopsOf(cases: PaymentCase[]): Loop[] {
	const loops: Loop[] = []
	for (const c of cases) {
		const title = titleOf(c)
		for (const r of c.runs) if (r.agent !== "Solo") loops.push({ agent: r.agent, caseId: c.id, title, start: Date.parse(r.startedAt), end: r.finishedAt ? Date.parse(r.finishedAt) : null, errored: r.status === "error" || r.status === "timeout", run: r })
	}
	return loops
}

export type Concurrency = { loops: number; running: number; peak: number; wallMs: number; agentMs: number; speedup: number | null }

export function concurrencyOf(loops: Loop[], now: number): Concurrency {
	const edges: [number, number][] = []
	let agentMs = 0
	let running = 0
	for (const l of loops) {
		const end = l.end ?? now
		if (l.end == null) running++
		agentMs += Math.max(0, end - l.start)
		edges.push([l.start, 1], [end, -1])
	}
	edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
	let live = 0, peak = 0, wallMs = 0, since = 0
	for (const [t, d] of edges) {
		if (live > 0) wallMs += t - since
		live += d
		since = t
		if (live > peak) peak = live
	}
	return { loops: loops.length, running, peak, wallMs, agentMs, speedup: wallMs > 0 && loops.length > 1 ? agentMs / wallMs : null }
}

export function overlapMs(a: Loop | undefined, b: Loop | undefined, now: number): number {
	if (!a || !b) return 0
	return Math.max(0, Math.min(a.end ?? now, b.end ?? now) - Math.max(a.start, b.start))
}

/** Token usage as the provider reported it per loop. Loops without a report are counted apart, never as zero. */
export function usageOf(loops: Loop[]): { byAgent: Record<string, { tokens: number; reported: number; loops: number }>; tokens: number; reported: number; unreported: number } {
	const byAgent: Record<string, { tokens: number; reported: number; loops: number }> = {}
	let tokens = 0, reported = 0, unreported = 0
	for (const l of loops) {
		const a = (byAgent[l.agent] ??= { tokens: 0, reported: 0, loops: 0 })
		a.loops++
		if (l.run.tokens) { const n = l.run.tokens.input + l.run.tokens.output; a.tokens += n; a.reported++; tokens += n; reported++ } else if (l.end != null) unreported++
	}
	return { byAgent, tokens, reported, unreported }
}

// ───────── audit trail ─────────

export type ActorKind = "agent" | "firewall" | "human" | "desk"
export type AuditEvent = { at: string; caseId: string; title: string; actor: string; actorKind: ActorKind; kind: string; detail: string }

const actorKind = (actor: string): ActorKind =>
	(AGENTS as readonly string[]).includes(actor) ? "agent" : actor === "Firewall" ? "firewall" : actor === "Demo reviewer" ? "human" : "desk"

export function auditOf(cases: PaymentCase[]): AuditEvent[] {
	const out: AuditEvent[] = []
	for (const c of cases) {
		const title = titleOf(c)
		out.push({ at: c.receivedAt, caseId: c.id, title, actor: "Desk", actorKind: "desk", kind: "info", detail: `document received (${c.fileName}, content hash ${c.hash.slice(0, 12)}…)` })
		for (const e of c.timeline) {
			if (e.kind === "inference") continue
			out.push({ at: e.at, caseId: c.id, title, actor: e.agent, actorKind: actorKind(e.agent), kind: e.kind, detail: plain(e.detail) })
		}
	}
	return out.sort((a, b) => b.at.localeCompare(a.at))
}
