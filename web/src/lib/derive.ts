/** Everything the UI derives from desk state. Pure functions over real events; nothing here invents a value. */
import type { PaymentCase } from "./api"
import { cap, plain } from "./format"

export const AGENTS = ["Extractor", "Validator", "Auditor", "Policy"] as const
export type AgentName = (typeof AGENTS)[number]

export const isRunning = (c: PaymentCase) => ["received", "extracting", "checking", "deciding"].includes(c.stage)

export function titleOf(c: PaymentCase): string {
	const x = c.extraction.result
	return c.checks?.vendorName ?? x?.creditorName ?? (x ? cap(x.documentKind) : c.id)
}

// ───────── exceptions ─────────

export type Exception = {
	code: string
	label: string
	detail: string
	severity: "block" | "review"
	/** Who established it: a deterministic check or an agent's finding. */
	by: "computed" | "agent"
}

export function exceptionsOf(c: PaymentCase): Exception[] {
	const out: Exception[] = []
	const k = c.checks
	if (k) {
		if (k.ibanValid === false) out.push({ code: "iban_invalid", label: "Invalid IBAN", detail: "The IBAN fails the ISO 13616 checksum.", severity: "block", by: "computed" })
		if (k.ibanMatchesMaster === false) out.push({ code: "bank_mismatch", label: "Bank details differ", detail: "The IBAN on the document is not the one on file for this vendor.", severity: "review", by: "computed" })
		if (!k.vendorId) out.push({ code: "vendor_unknown", label: "Unknown vendor", detail: "The creditor is not in the vendor master.", severity: "review", by: "computed" })
		if (k.duplicateOf) out.push({ code: "duplicate", label: "Duplicate", detail: `Same invoice as the earlier document ${k.duplicateOf}.`, severity: "review", by: "computed" })
		if (k.duplicatedBy.length) out.push({ code: "has_duplicate", label: "Has a duplicate", detail: `A later document repeats this invoice: ${k.duplicatedBy.join(", ")}.`, severity: "review", by: "computed" })
		if (k.overLimit) out.push({ code: "over_limit", label: "Over limit", detail: `Above the auto-approve limit of ${k.limit.toFixed(2)}.`, severity: "review", by: "computed" })
		if (k.currencyOk === false) out.push({ code: "currency", label: "Currency", detail: "Not in the policy currency.", severity: "review", by: "computed" })
		if (k.unsourced.length) out.push({ code: "unsourced", label: "Unsourced value", detail: `No located quote in the document for: ${k.unsourced.join(", ")}.`, severity: "review", by: "computed" })
	}
	if (c.audit.result && !c.audit.result.ok) out.push({ code: "audit_mismatch", label: "Audit mismatch", detail: "The Auditor found a difference between the extraction and the document.", severity: "review", by: "agent" })
	if (c.validation.result?.disagreements.length) out.push({ code: "disagreement", label: "Agent disagreement", detail: "The Validator's report differs from the computed checks.", severity: "review", by: "computed" })
	return out.sort((a, b) => (WEIGHT[b.code] ?? 1) - (WEIGHT[a.code] ?? 1))
}

const WEIGHT: Record<string, number> = { iban_invalid: 8, bank_mismatch: 7, disagreement: 6, audit_mismatch: 5, unsourced: 5, vendor_unknown: 4, duplicate: 4, has_duplicate: 3, currency: 2, over_limit: 1 }
/** An ordering key for the review queue, not a score shown to anyone. */
export const riskRank = (c: PaymentCase) => exceptionsOf(c).reduce((s, e) => s + (WEIGHT[e.code] ?? 1), 0)

// ───────── agent loops ─────────

export type Loop = { agent: AgentName; caseId: string; title: string; start: number; end: number | null; errored: boolean }

/** One entry per agent loop, read from the timeline events the server recorded (loop.started → answer | error). */
export function loopsOf(cases: PaymentCase[]): Loop[] {
	const loops: Loop[] = []
	for (const c of cases) {
		const open = new Map<string, Loop>()
		const title = titleOf(c)
		for (const e of c.timeline) {
			if (!(AGENTS as readonly string[]).includes(e.agent)) continue
			const t = Date.parse(e.at)
			if (e.kind === "loop.started") {
				const l: Loop = { agent: e.agent as AgentName, caseId: c.id, title, start: t, end: null, errored: false }
				open.set(e.agent, l)
				loops.push(l)
			} else if ((e.kind === "answer" || e.kind === "error") && open.has(e.agent)) {
				const l = open.get(e.agent)!
				l.end = t
				l.errored = e.kind === "error"
				open.delete(e.agent)
			}
		}
	}
	return loops
}

export type Concurrency = {
	loops: number
	running: number
	/** Most loops in flight at one instant. */
	peak: number
	/** Time during which at least one loop was running. */
	wallMs: number
	/** Sum of all loop durations: what a sequential run would have taken. */
	agentMs: number
	/** agentMs / wallMs, null until there is something to divide. */
	speedup: number | null
}

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

/** How long two loops of one case ran at the same time. */
export function overlapMs(a: Loop | undefined, b: Loop | undefined, now: number): number {
	if (!a || !b) return 0
	return Math.max(0, Math.min(a.end ?? now, b.end ?? now) - Math.max(a.start, b.start))
}

// ───────── audit trail ─────────

export type ActorKind = "agent" | "guard" | "human" | "desk"
export type AuditEvent = { at: string; caseId: string; title: string; actor: string; actorKind: ActorKind; kind: string; detail: string }

const actorKind = (actor: string): ActorKind =>
	(AGENTS as readonly string[]).includes(actor) ? "agent" : actor === "PolicyGuard" ? "guard" : actor === "human" ? "human" : "desk"

export function auditOf(cases: PaymentCase[]): AuditEvent[] {
	const out: AuditEvent[] = []
	for (const c of cases) {
		const title = titleOf(c)
		out.push({ at: c.receivedAt, caseId: c.id, title, actor: "Desk", actorKind: "desk", kind: "info", detail: `document received (${c.fileName})` })
		for (const e of c.timeline) {
			if (e.kind === "inference") continue
			out.push({ at: e.at, caseId: c.id, title, actor: e.agent, actorKind: actorKind(e.agent), kind: e.kind, detail: plain(e.detail) })
		}
	}
	return out.sort((a, b) => b.at.localeCompare(a.at))
}
