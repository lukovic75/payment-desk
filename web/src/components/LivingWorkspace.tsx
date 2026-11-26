import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { ArrowCounterClockwise, Function as Fn, MagnifyingGlass, Pause, Play, Scales, Scan, ShareNetwork, ShieldCheck } from "@phosphor-icons/react"
import type { PaymentCase } from "../lib/api"
import { flagged, isRunning, outcomeOf, titleOf, type AgentName, type Loop } from "../lib/derive"
import { duration, reduceMotion } from "../lib/format"
import { controlShort, dispositionLabel } from "./bits"
import { Seg } from "./ui"

/**
 * The living agent workspace. Five glass entities and two code gates in one stable composition. Everything that moves is a
 * reading of recorded state: an agent leans toward its input while its loop is running, a capsule travels an edge at the
 * moment the receiving loop starts, and the outcome appears when the server has decided. Nothing here is timed for effect.
 */

export const AGENT_ORDER: AgentName[] = ["Extractor", "Validator", "Auditor", "Investigator", "Policy"]
const STEP = { Extractor: "extraction", Validator: "validation", Auditor: "audit", Investigator: "investigation", Policy: "decision" } as const
export type Phase = "waiting" | "running" | "retrying" | "done" | "failed" | "skipped"
type AgentView = { phase: Phase; note: string }
export type Scene = {
	agents: Record<AgentName, AgentView>
	doc: boolean
	compared: boolean
	investigated: boolean
	outcome: string | null
	/** A cross-check on record once the comparison has run: the two values that do not agree. */
	challenge: { a: string; b: string; kind: "amounts" | "account" | "reading" } | null
	tally: string | null
	story: string
	tone: "" | "good" | "warn" | "bad" | "run"
}

const TONE: Record<string, Scene["tone"]> = { AUTO_APPROVED: "good", APPROVED_BY_HUMAN: "good", NEEDS_APPROVAL: "warn", BLOCKED: "bad", PROCESSING_ERROR: "bad", REJECTED: "", NOT_A_PAYMENT: "" }
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** The recorded span of one payment's processing: from just before the first loop to just after the decision. */
export function spanOf(c: PaymentCase): { t0: number; t1: number; first: number; ms: number } | null {
	const runs = c.runs.filter((r) => r.attempt === c.attempt && r.agent !== "Solo")
	if (runs.length === 0 || runs.some((r) => !r.finishedAt)) return null
	const first = Math.min(...runs.map((r) => Date.parse(r.startedAt)))
	const last = Math.max(...runs.map((r) => Date.parse(r.finishedAt!)), c.decision.finishedAt ? Date.parse(c.decision.finishedAt) : 0)
	const pad = Math.max(8, (last - first) * 0.07)
	return { t0: first - pad, t1: last + pad * 1.6, first, ms: last - first }
}

/** One payment at one instant. `at` is a point in its recorded span (replay) or null for the state as it is now. */
export function sceneOf(c: PaymentCase, at: number | null, now: number): Scene {
	const runs = c.runs.filter((r) => r.attempt === c.attempt && r.agent !== "Solo")
	const latest = (a: AgentName) => runs.filter((r) => r.agent === a).pop()
	const T = at ?? now
	const settled = !isRunning(c)
	const end = (a: AgentName) => { const r = latest(a); return r?.finishedAt ? Date.parse(r.finishedAt) : null }
	const lastEnd = Math.max(0, ...runs.flatMap((r) => (r.finishedAt ? [Date.parse(r.finishedAt)] : [])))
	const decidedAt = Math.max(lastEnd, c.decision.finishedAt ? Date.parse(c.decision.finishedAt) : 0)
	const checks = [end("Validator"), end("Auditor")].filter((v): v is number => v != null)
	const comparedAt = latest("Validator") || latest("Auditor") ? (checks.length === [latest("Validator"), latest("Auditor")].filter(Boolean).length ? Math.max(...checks) : Infinity) : end("Extractor") ?? decidedAt
	const compared = (c.controls.length > 0 || settled) && T >= comparedAt

	const agents = {} as Record<AgentName, AgentView>
	for (const a of AGENT_ORDER) {
		const r = latest(a)
		if (!r) {
			const failed = c[STEP[a]].status === "error"
			const skipAt = a === "Investigator" ? comparedAt : decidedAt
			agents[a] = failed ? { phase: "failed", note: "Failed" } : settled && T >= skipAt ? { phase: "skipped", note: c.stage === "error" ? "Did not run" : "Not needed" } : { phase: "waiting", note: "Waiting" }
			continue
		}
		const s = Date.parse(r.startedAt), e = r.finishedAt ? Date.parse(r.finishedAt) : null
		if (T < s) agents[a] = { phase: "waiting", note: "Waiting" }
		else if (e == null || T < e) agents[a] = r.retry > 0 ? { phase: "retrying", note: `Retrying · attempt ${r.retry + 1}` } : { phase: "running", note: `Working · ${duration(Math.max(0, T - s))}` }
		else agents[a] = r.status === "done" ? { phase: "done", note: `Done · ${duration(e - s)}` } : { phase: "failed", note: "Failed" }
	}
	const inv = latest("Investigator")
	const investigated = inv != null && T >= Date.parse(inv.startedAt)
	const outcome = settled && T >= decidedAt ? outcomeOf(c) : null
	const top = compared ? flagged(c)[0] : undefined
	const issue = top ? lower(controlShort(top)) : null
	const busy = (a: AgentName) => agents[a].phase === "running" || agents[a].phase === "retrying"
	const failed = AGENT_ORDER.find((a) => agents[a].phase === "failed")
	// The first cross-check on record, shown from the instant the comparison has run. Values are the challenge's own.
	const ch = compared ? (c.challenges ?? []).find((k) => k.category !== "report_mismatch") : undefined
	const brief = (v: string) => (/^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/.test(v.replace(/\s+/g, "")) ? `…${v.replace(/\s+/g, "").slice(-4)}` : v.length > 14 ? `${v.slice(0, 13)}…` : v)
	const challenge: Scene["challenge"] = ch ? { a: brief(ch.challenged.value), b: brief(ch.observed.value), kind: ch.category === "trusted_record_mismatch" ? "account" : ch.category === "reading_disagreement" ? "reading" : "amounts" } : null

	let story = "Waiting for the document."
	if (outcome) {
		story = outcome === "AUTO_APPROVED" ? "Verified. Every check passed and a sandbox draft is ready."
			: outcome === "APPROVED_BY_HUMAN" ? "Approved by a person. A sandbox draft is ready; nothing has been sent."
				: outcome === "NEEDS_APPROVAL" ? `Needs your review${issue ? `: ${issue}` : ": the policy asks for a person"}.`
					: outcome === "BLOCKED" ? `Blocked${issue ? `: ${issue}` : ""}. It cannot be approved as it stands.`
						: outcome === "PROCESSING_ERROR" ? `Could not be processed: the ${failed ?? "workflow"} failed. Nothing was approved.`
							: outcome === "REJECTED" ? "Rejected by a person. No draft exists."
								: "Not a payment request. Nothing is due."
	} else if (busy("Policy")) story = "Applying the payment policy to what was found."
	else if (busy("Investigator")) {
		// the disagreement itself, when one is on record; otherwise the control that sent it here
		const ch = (c.challenges ?? []).find((k) => k.category === "reading_disagreement" || k.category === "document_contradiction")
		story = ch ? `${ch.category === "reading_disagreement" ? `Two agents read a different ${ch.field === "gross" ? "amount" : ch.field}` : `The document states two different ${/gross|amount|total/i.test(ch.field) ? "amounts" : `values for ${ch.field}`}`}. The Investigator is reviewing the original evidence.` : issue ? `Investigating an exception: ${issue}.` : "Investigating an exception."
	}
	else if (busy("Validator") && busy("Auditor")) story = "Two independent checks are running: trusted records, and a second reading of the document."
	else if (busy("Validator")) story = "Checking the reading against trusted records."
	else if (busy("Auditor")) story = "Reading the document a second time, independently."
	else if (busy("Extractor")) story = "Reading the document and citing every value."
	else if (failed) story = `The ${failed} failed.`
	else if (challenge && !investigated) story = challenge.kind === "account" ? "The account on the document is not the one on file. A cross-check is on record." : "Two independent findings do not agree. A cross-check is on record."
	else if (compared) story = "Controls in code are comparing what the agents found."
	else if (agents.Extractor.phase === "done") story = "The reading goes to two independent checks."
	return { agents, doc: T >= Date.parse(c.receivedAt) || runs.length > 0, compared, investigated, outcome, challenge, tally: null, story, tone: outcome ? TONE[outcome] ?? "" : AGENT_ORDER.some(busy) ? "run" : "" }
}

/** The whole inbox as one picture: how many loops each agent has running or finished. No single payment's handoffs are drawn. */
export function inboxScene(cases: PaymentCase[], loops: Loop[]): Scene {
	const agents = {} as Record<AgentName, AgentView>
	for (const a of AGENT_ORDER) {
		const mine = loops.filter((l) => l.agent === a)
		const running = mine.filter((l) => l.end == null).length
		const failed = mine.filter((l) => l.errored).length
		const done = mine.length - running - failed
		agents[a] = running ? { phase: "running", note: `${running} working` }
			: mine.length === 0 ? { phase: "waiting", note: a === "Investigator" ? "Not called" : "Waiting" }
				: done === 0 ? { phase: "failed", note: `${failed} failed` }
					: { phase: "done", note: `${done} done${failed ? ` · ${failed} failed` : ""}` }
	}
	const live = cases.filter(isRunning).length
	const decided = cases.filter((c) => !isRunning(c)).length
	const busy = (a: AgentName) => agents[a].phase === "running"
	const story = live
		? `${live} document${live === 1 ? " is" : "s are"} in progress. ${busy("Validator") && busy("Auditor") ? "Two independent checks are running side by side." : busy("Investigator") ? "Exceptions are being investigated." : busy("Policy") ? "The payment policy is being applied." : "Documents are being read."}`
		: cases.length ? `${decided} of ${cases.length} documents are decided. Nothing is running.` : "No document has been processed yet."
	return { agents, doc: cases.length > 0, compared: cases.some((c) => c.controls.length > 0), investigated: loops.some((l) => l.agent === "Investigator"), outcome: null, challenge: null, tally: decided ? `${decided} decided` : null, story, tone: live ? "run" : "" }
}

// ───────── composition ─────────

type Pt = { x: number; y: number }
type NodeId = "doc" | AgentName | "compare" | "enforce"
/** Where the two disputed values sit: above the comparison when the stage is wide, beside it when it is tall. */
const FLAG: { wide: Pt; tall: Pt } = { wide: { x: 578, y: 62 }, tall: { x: 70, y: 424 } }
const WIDE: { w: number; h: number; at: Record<NodeId, Pt> } = { w: 1000, h: 372, at: { doc: { x: 62, y: 176 }, Extractor: { x: 212, y: 176 }, Validator: { x: 408, y: 86 }, Auditor: { x: 408, y: 266 }, compare: { x: 578, y: 176 }, Investigator: { x: 694, y: 282 }, Policy: { x: 800, y: 176 }, enforce: { x: 926, y: 176 } } }
const TALL: typeof WIDE = { w: 380, h: 800, at: { doc: { x: 190, y: 44 }, Extractor: { x: 190, y: 158 }, Validator: { x: 96, y: 296 }, Auditor: { x: 284, y: 296 }, compare: { x: 190, y: 424 }, Investigator: { x: 300, y: 520 }, Policy: { x: 190, y: 616 }, enforce: { x: 190, y: 736 } } }
const EDGES: { id: string; from: NodeId; to: NodeId; branch?: boolean }[] = [
	{ id: "d-e", from: "doc", to: "Extractor" },
	{ id: "e-v", from: "Extractor", to: "Validator" },
	{ id: "e-a", from: "Extractor", to: "Auditor" },
	{ id: "v-c", from: "Validator", to: "compare" },
	{ id: "a-c", from: "Auditor", to: "compare" },
	{ id: "c-p", from: "compare", to: "Policy" },
	{ id: "c-i", from: "compare", to: "Investigator", branch: true },
	{ id: "i-p", from: "Investigator", to: "Policy", branch: true },
	{ id: "p-f", from: "Policy", to: "enforce" },
]
/** Where an agent leans while it works: toward what it is reading. Small, so names stay put and nothing overlaps. */
const LEAN: Record<AgentName, Pt> = { Extractor: { x: -20, y: 0 }, Validator: { x: -14, y: 6 }, Auditor: { x: -14, y: -6 }, Investigator: { x: -12, y: -16 }, Policy: { x: -14, y: 0 } }
const GLYPH: Record<AgentName, ReactNode> = {
	Extractor: <Scan x={-9} y={-9} size={18} weight="bold" className="orb-glyph" />,
	Validator: <ShieldCheck x={-9} y={-9} size={18} weight="bold" className="orb-glyph" />,
	Auditor: <MagnifyingGlass x={-9} y={-9} size={18} weight="bold" className="orb-glyph" />,
	Investigator: <ShareNetwork x={-9} y={-9} size={18} weight="bold" className="orb-glyph" />,
	Policy: <Scales x={-9} y={-9} size={18} weight="bold" className="orb-glyph" />,
}
const R = 33

function useWide() {
	const ref = useRef<HTMLDivElement>(null)
	const [wide, setWide] = useState(true)
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		const on = () => setWide(el.clientWidth >= 700)
		on()
		const ro = new ResizeObserver(on)
		ro.observe(el)
		return () => ro.disconnect()
	}, [])
	return [ref, wide] as const
}

type Capsule = { key: number; edge: string; tone: string }
type Props = { scene: Scene; sceneKey: string; mode: "live" | "replay" | "recorded" | "inbox"; picked?: AgentName | null; onPick?: (a: AgentName) => void; docLabel?: string; children?: ReactNode }

export function LivingWorkspace({ scene, sceneKey, mode, picked, onPick, docLabel, children }: Props) {
	const [box, wide] = useWide()
	const L = wide ? WIDE : TALL
	const path = (from: NodeId, to: NodeId) => {
		const a = L.at[from], b = L.at[to]
		if (wide) { const k = (b.x - a.x) / 2; return `M ${a.x} ${a.y} C ${a.x + k} ${a.y}, ${b.x - k} ${b.y}, ${b.x} ${b.y}` }
		const k = (b.y - a.y) / 2
		return `M ${a.x} ${a.y} C ${a.x} ${a.y + k}, ${b.x} ${b.y - k}, ${b.x} ${b.y}`
	}
	const ph = (a: AgentName) => scene.agents[a].phase
	const started = (a: AgentName) => ph(a) !== "waiting" && ph(a) !== "skipped"
	const finished = (a: AgentName) => ph(a) === "done"
	const busy = (a: AgentName) => ph(a) === "running" || ph(a) === "retrying"
	// an edge is travelled once its source has produced something and its target has taken it up
	const lit: Record<string, boolean> = {
		"d-e": started("Extractor"), "e-v": started("Validator"), "e-a": started("Auditor"),
		"v-c": finished("Validator"), "a-c": finished("Auditor"),
		"c-i": scene.investigated, "i-p": scene.investigated && started("Policy"),
		"c-p": !scene.investigated && started("Policy"), "p-f": finished("Policy"),
	}
	const flowing: Record<string, boolean> = { "d-e": busy("Extractor"), "e-v": busy("Validator"), "e-a": busy("Auditor"), "c-i": busy("Investigator"), "i-p": scene.investigated && busy("Policy"), "c-p": !scene.investigated && busy("Policy") }

	// Handoffs: a capsule leaves at the moment an edge becomes travelled. Past transitions are never replayed as new ones.
	const [capsules, setCapsules] = useState<Capsule[]>([])
	const prev = useRef<{ key: string; lit: Record<string, boolean> } | null>(null)
	const seq = useRef(0)
	const litKey = EDGES.map((e) => (lit[e.id] ? 1 : 0)).join("")
	useEffect(() => {
		const before = prev.current
		prev.current = { key: sceneKey, lit }
		if (!before || before.key !== sceneKey || mode === "inbox" || reduceMotion() || document.hidden) { if (before && before.key !== sceneKey) setCapsules([]); return }
		const fresh = EDGES.filter((e) => lit[e.id] && !before.lit[e.id]).map((e) => ({ key: ++seq.current, edge: e.id, tone: e.from === "doc" || e.from === "compare" ? "neutral" : e.from }))
		if (fresh.length) setCapsules((list) => [...list, ...fresh].slice(-8))
	}, [sceneKey, litKey, mode])

	const key = (e: KeyboardEvent, a: AgentName) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick?.(a) } }
	const labelY = R + 22
	const outcomeTone = scene.outcome ? TONE[scene.outcome] ?? "" : ""

	return (
		<section className={`law tone-${scene.tone || "none"}`} aria-label="Living agent workspace">
			<div className="law-stage" ref={box}>
				<svg viewBox={`0 0 ${L.w} ${L.h}`} role="group" aria-label="Five agents and two code gates, drawn from recorded execution state">
					<defs>
						{AGENT_ORDER.map((a) => (
							<g key={a} className={`agent-${a}`}>
								<radialGradient id={`law-shell-${a}`} cx="36%" cy="30%" r="78%"><stop offset="0%" className="s-hi" /><stop offset="55%" className="s-mid" /><stop offset="100%" className="s-deep" /></radialGradient>
								<radialGradient id={`law-core-${a}`} cx="50%" cy="50%" r="50%"><stop offset="0%" className="c-in" /><stop offset="60%" className="c-mid" /><stop offset="100%" className="c-out" /></radialGradient>
								<radialGradient id={`law-glow-${a}`} cx="50%" cy="50%" r="50%"><stop offset="35%" className="g-in" /><stop offset="100%" className="g-out" /></radialGradient>
							</g>
						))}
						<linearGradient id="law-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" className="rim-a" /><stop offset="45%" className="rim-b" /><stop offset="100%" className="rim-c" /></linearGradient>
						<radialGradient id="law-spec" cx="50%" cy="50%" r="50%"><stop offset="0%" className="spec-a" /><stop offset="100%" className="spec-b" /></radialGradient>
					</defs>

					{EDGES.map((e) => <path key={e.id} d={path(e.from, e.to)} className={`law-edge${e.branch ? " branch" : ""}${lit[e.id] ? " lit" : ""}${flowing[e.id] ? " flow" : ""}${e.id === "c-p" && scene.investigated ? " bypassed" : ""}`} />)}
					{capsules.map((k) => {
						const e = EDGES.find((x) => x.id === k.edge)!
						return (
							<g key={k.key} className={`law-capsule agent-${k.tone}`} style={{ offsetPath: `path("${path(e.from, e.to)}")` } as CSSProperties} onAnimationEnd={() => setCapsules((list) => list.filter((x) => x.key !== k.key))}>
								<rect x={-10} y={-4.5} width={20} height={9} rx={4.5} /><rect className="shine" x={-6} y={-2.6} width={9} height={2} rx={1} />
							</g>
						)
					})}

					<g transform={`translate(${L.at.doc.x} ${L.at.doc.y})`} className={`law-doc${scene.doc ? " in" : ""}${busy("Extractor") ? " scanning" : ""}`}>
						<rect x={-19} y={-25} width={38} height={50} rx={7} className="page" />
						<path d="M-11 -12 H11 M-11 -4 H7 M-11 4 H11 M-11 12 H2" className="lines" />
						<rect x={-19} y={-25} width={38} height={3} rx={1.5} className="scan" />
						<text y={45} textAnchor="middle" className="law-name">{docLabel ?? "Documents"}</text>
					</g>

					{(["compare", "enforce"] as const).map((g) => {
						const on = g === "compare" ? scene.compared : scene.outcome != null || scene.tally != null
						return (
							<g key={g} transform={`translate(${L.at[g].x} ${L.at[g].y})`} className={`law-gate ${g}${on ? " on" : ""}${g === "compare" && scene.challenge ? " flagged" : ""}${g === "enforce" && scene.outcome ? ` decided t-${outcomeTone || "none"}` : ""}`}>
								{g === "enforce" && scene.outcome && <rect key={scene.outcome} x={-23} y={-23} width={46} height={46} rx={13} className="ripple" />}
								<rect x={-23} y={-23} width={46} height={46} rx={g === "compare" ? 6 : 13} className="plate" transform={g === "compare" ? "rotate(45)" : undefined} />
								<Fn x={-8} y={-8} size={16} weight="bold" className="gate-glyph" />
								<text y={g === "compare" ? 52 : 46} textAnchor="middle" className="law-name">{g === "compare" ? "Compare" : "Enforce"}</text>
								<text y={g === "compare" ? 67 : 61} textAnchor="middle" className="law-note">{g === "enforce" && scene.outcome ? dispositionLabel(scene.outcome) : g === "enforce" && scene.tally ? scene.tally : "code, no model"}</text>
							</g>
						)
					})}

					{scene.challenge && (() => {
						// The two values that do not agree, as the challenge states them: side by side above the comparison (wide) or stacked beside it (tall).
						const at = wide ? FLAG.wide : FLAG.tall
						const w = (t: string) => Math.max(46, t.length * 6.6 + 18)
						const wa = w(scene.challenge.a), wb = w(scene.challenge.b), gap = 22, total = wa + gap + wb
						const a = wide ? { x: -total / 2 + wa / 2, y: 0 } : { x: 0, y: -13 }
						const b = wide ? { x: total / 2 - wb / 2, y: 0 } : { x: 0, y: 13 }
						return (
							<g key={`${sceneKey}:flag`} transform={`translate(${at.x} ${at.y})`} role="img" aria-label={`Cross-check on record: ${scene.challenge.a} against ${scene.challenge.b}`}>
								<g className="law-flag">
									{wide && <path className="stem" d={`M 0 15 V ${L.at.compare.y - at.y - 38}`} />}
									<g transform={`translate(${a.x} ${a.y})`}><rect x={-wa / 2} y={-11} width={wa} height={22} rx={11} /><text textAnchor="middle" y={4}>{scene.challenge.a}</text></g>
									{wide && <text className="neq" textAnchor="middle" x={-total / 2 + wa + gap / 2} y={4}>≠</text>}
									<g transform={`translate(${b.x} ${b.y})`}><rect x={-wb / 2} y={-11} width={wb} height={22} rx={11} /><text textAnchor="middle" y={4}>{scene.challenge.b}</text></g>
								</g>
							</g>
						)
					})()}

					{AGENT_ORDER.map((a) => {
						const v = scene.agents[a]
						const active = v.phase === "running" || v.phase === "retrying"
						const lean = active ? LEAN[a] : { x: 0, y: 0 }
						const tilt = wide ? lean : { x: lean.y, y: lean.x }
						return (
							<g key={a} transform={`translate(${L.at[a].x} ${L.at[a].y})`} className={`law-agent agent-${a} is-${v.phase}`}>
								<g className="orb" role="button" tabIndex={0} data-drawer-keep aria-pressed={picked === a} aria-label={`${a}: ${v.note}. Open the inspector.`} onClick={() => onPick?.(a)} onKeyDown={(e) => key(e, a)} style={{ "--dx": `${tilt.x}px`, "--dy": `${tilt.y}px` } as CSSProperties}>
									<ellipse cy={R + 9} rx={24} ry={5} className="orb-shadow" />
									<circle r={R + 15} fill={`url(#law-glow-${a})`} className="orb-glow" />
									<g className="orb-sig">
										{a === "Extractor" && <ellipse rx={R + 9} ry={12} transform="rotate(-22)" className="sig orbit" pathLength={100} />}
										{a === "Validator" && <><path d={`M ${-R - 9} -9 V 9`} className="sig bar a" /><path d={`M ${R + 9} -9 V 9`} className="sig bar b" /></>}
										{a === "Auditor" && <circle r={R + 8} className="sig sweep" pathLength={100} />}
										{a === "Investigator" && <g className="sig trio">{[0, 120, 240].map((d) => <circle key={d} r={2.6} cx={R + 9} transform={`rotate(${d})`} />)}</g>}
										{a === "Policy" && <><circle r={R + 7} className="sig ring a" pathLength={100} /><circle r={R + 12} className="sig ring b" pathLength={100} /></>}
									</g>
									<circle r={R} fill={`url(#law-shell-${a})`} className="orb-shell" />
									<circle r={15} fill={`url(#law-core-${a})`} className="orb-core" />
									<circle r={R} className="orb-rim" stroke="url(#law-rim)" />
									<ellipse cx={-11} cy={-16} rx={13} ry={6.5} transform="rotate(-30 -11 -16)" fill="url(#law-spec)" className="orb-spec" />
									{GLYPH[a]}
									{(v.phase === "done" || v.phase === "failed") && <g className="orb-badge" transform={`translate(${R - 8} ${-R + 8})`}><circle r={7.5} /><path d={v.phase === "done" ? "M-3.2 0.2 L-1 2.5 L3.3 -2.2" : "M-2.6 -2.6 L2.6 2.6 M2.6 -2.6 L-2.6 2.6"} /></g>}
								</g>
								<text y={labelY + 14} textAnchor="middle" className="law-name">{a}</text>
								<text y={labelY + 30} textAnchor="middle" className="law-note">{v.note}</text>
								{a === "Validator" && busy("Validator") && busy("Auditor") && wide && <text y={(L.at.Auditor.y - L.at.Validator.y) / 2 + 4} x={-R - 34} textAnchor="middle" className="law-par" transform={`rotate(-90 ${-R - 34} ${(L.at.Auditor.y - L.at.Validator.y) / 2})`}>in parallel</text>}
							</g>
						)
					})}
				</svg>
			</div>
			<div className="law-foot">
				<span className={`law-mode ${mode}`}><i aria-hidden />{mode === "live" ? "Live" : mode === "replay" ? "Replay" : mode === "inbox" ? (scene.tone === "run" ? "Live" : "Idle") : "Recorded"}</span>
				<p className="law-story" role="status" aria-live="polite"><span key={scene.story} className="swap">{scene.story}</span></p>
				{children}
			</div>
		</section>
	)
}

// ───────── replay: a clock over recorded timestamps ─────────

const LENGTH = [{ value: "8", label: "8 s" }, { value: "16", label: "16 s" }, { value: "real", label: "Real time" }] as const
type Len = (typeof LENGTH)[number]["value"]

/**
 * Plays one payment's recorded execution back. It reads start and finish times the server stored and calls nothing:
 * no agent runs, no state changes. `at` is null when not replaying.
 */
export function useReplay(c: PaymentCase | null) {
	const span = c ? spanOf(c) : null
	const [state, setState] = useState<{ id: string; at: number; playing: boolean } | null>(null)
	const [len, setLen] = useState<Len>("8")
	const on = state && c && state.id === `${c.id}:${c.attempt}` && span ? state : null
	const rate = span ? (len === "real" ? 1 : (span.t1 - span.t0) / (Number(len) * 1000)) : 1

	useEffect(() => {
		if (!on?.playing || !span) return
		let raf = 0, last = performance.now()
		const tick = (t: number) => {
			const dt = t - last
			last = t
			setState((s) => {
				if (!s || !s.playing) return s
				const at = s.at + dt * rate
				return at >= span.t1 ? { ...s, at: span.t1, playing: false } : { ...s, at }
			})
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(raf)
	}, [on?.playing, on?.id, rate, span?.t0, span?.t1])

	return {
		available: span != null,
		at: on?.at ?? null,
		playing: on?.playing ?? false,
		progress: on && span ? (on.at - span.t0) / (span.t1 - span.t0) : 0,
		span, len, setLen,
		start: () => c && span && setState({ id: `${c.id}:${c.attempt}`, at: span.t0, playing: true }),
		toggle: () => setState((s) => (s && span ? (s.at >= span.t1 ? { ...s, at: span.t0, playing: true } : { ...s, playing: !s.playing }) : s)),
		seek: (p: number) => c && span && setState({ id: `${c.id}:${c.attempt}`, at: span.t0 + p * (span.t1 - span.t0), playing: false }),
		stop: () => setState(null),
	}
}

export function ReplayControls({ r, title }: { r: ReturnType<typeof useReplay>; title: string }) {
	if (!r.available) return <span className="law-hint">Replay is available once every loop of this payment has a recorded finish time.</span>
	if (r.at == null) return <button type="button" className="btn" onClick={r.start}><Play size={12} weight="fill" /> Replay the recorded run</button>
	return (
		<div className="law-replay" role="group" aria-label={`Replay of the recorded execution of ${title}`}>
			<button type="button" className="btn btn-icon btn-round" onClick={r.toggle} aria-label={r.playing ? "Pause" : r.progress >= 1 ? "Play again" : "Play"}>{r.playing ? <Pause size={13} weight="fill" /> : r.progress >= 1 ? <ArrowCounterClockwise size={14} /> : <Play size={12} weight="fill" />}</button>
			<input type="range" className="law-scrub" min={0} max={1000} value={Math.round(r.progress * 1000)} onChange={(e) => r.seek(Number(e.target.value) / 1000)} aria-label="Position in the recorded execution" style={{ "--p": `${r.progress * 100}%` } as CSSProperties} />
			<span className="law-time">{duration(Math.max(0, Math.min(r.span!.ms, r.at - r.span!.first)))} of {duration(r.span!.ms)}</span>
			<Seg value={r.len} onChange={r.setLen} options={LENGTH.map((l) => ({ value: l.value, label: l.label }))} label="Replay length" />
			<button type="button" className="btn btn-ghost btn-sm" onClick={r.stop}>Done</button>
		</div>
	)
}

export const docLabelOf = (c: PaymentCase) => { const t = titleOf(c); return t.length > 18 ? `${t.slice(0, 17)}…` : t }

/** The five agents at a glance, for the overview: the same glass entities, small, each showing what it is doing now. */
export function MiniAgents({ scene }: { scene: Scene }) {
	return (
		<div className="law mini" role="list" aria-label="Agents">
			{AGENT_ORDER.map((a) => {
				const v = scene.agents[a]
				return (
					<div key={a} role="listitem" className={`law-agent agent-${a} is-${v.phase}`}>
						<svg viewBox="-26 -26 52 52" aria-hidden>
							<defs>
								<radialGradient id={`mini-shell-${a}`} cx="36%" cy="30%" r="78%"><stop offset="0%" className="s-hi" /><stop offset="55%" className="s-mid" /><stop offset="100%" className="s-deep" /></radialGradient>
								<radialGradient id={`mini-core-${a}`} cx="50%" cy="50%" r="50%"><stop offset="0%" className="c-in" /><stop offset="60%" className="c-mid" /><stop offset="100%" className="c-out" /></radialGradient>
								<linearGradient id={`mini-rim-${a}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" className="rim-a" /><stop offset="45%" className="rim-b" /><stop offset="100%" className="rim-c" /></linearGradient>
							</defs>
							<g className="orb"><circle r={21} fill={`url(#mini-shell-${a})`} /><circle r={10} fill={`url(#mini-core-${a})`} className="orb-core" /><circle r={21} className="orb-rim" stroke={`url(#mini-rim-${a})`} /><g transform="scale(0.72)">{GLYPH[a]}</g></g>
						</svg>
						<b>{a}</b><span title={v.note}>{v.note.split(" · ")[0]}</span>
					</div>
				)
			})}
		</div>
	)
}
