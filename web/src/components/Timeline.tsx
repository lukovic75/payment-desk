import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AGENTS, overlapMs, type AgentName, type Loop } from "../lib/derive"
import { clock, duration } from "../lib/format"

type Props = {
	/** Loops to draw: the whole inbox, or one payment's. All come from recorded orchestration events. */
	loops: Loop[]
	scope: "inbox" | "case"
	live: boolean
	/** Highlight this payment's loops and draw its dependencies. */
	selected?: string | null
	onSelect?: (caseId: string) => void
	empty?: string
}

type Placed = Loop & { row: number }
type Cluster = { start: number; end: number; x0: number }

const IDLE_GAP_MS = 4000
const GAP_W = 34

/** A clock that only ticks while something is running and the tab is visible. */
export function useNow(live: boolean): number {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		setNow(Date.now())
		if (!live) return
		let id: ReturnType<typeof setInterval> | undefined
		const start = () => { if (id == null) id = setInterval(() => setNow(Date.now()), 200) }
		const stop = () => { clearInterval(id); id = undefined }
		const onVis = () => (document.hidden ? stop() : (setNow(Date.now()), start()))
		onVis()
		document.addEventListener("visibilitychange", onVis)
		return () => { stop(); document.removeEventListener("visibilitychange", onVis) }
	}, [live])
	return now
}

function useWidth() {
	const ref = useRef<HTMLDivElement>(null)
	const [w, setW] = useState(0)
	useLayoutEffect(() => {
		const el = ref.current
		if (!el) return
		setW(Math.floor(el.clientWidth))
		const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)))
		ro.observe(el)
		return () => ro.disconnect()
	}, [])
	return [ref, w] as const
}

const tickLabel = (ms: number, step: number) => {
	const s = ms / 1000
	if (s >= 60) return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
	return `${step < 1000 ? s.toFixed(1) : Math.round(s)}s`
}

/**
 * Agent loops on one shared clock. One lane per agent, one bar per loop, sub-rows where loops overlap,
 * so concurrency is visible as overlap. Idle stretches longer than a few seconds are folded and labelled.
 */
export function Timeline({ loops, scope, live, selected = null, onSelect, empty }: Props) {
	const [ref, width] = useWidth()
	const now = useNow(live)
	const [tip, setTip] = useState<{ x: number; y: number; loop: Placed } | null>(null)
	const isCase = scope === "case"

	const model = useMemo(() => {
		if (loops.length === 0 || width < 120) return null
		const ROW = isCase ? 26 : 10
		const BAR = isCase ? 12 : 6
		const PAD = isCase ? 0 : 10
		const LEFT = width < 520 ? 74 : 92
		const RIGHT = isCase ? 58 : 10
		const TOP = isCase ? 14 : 6

		// pack each lane's overlapping loops into sub-rows
		const placed: Placed[] = []
		const rows = new Map<AgentName, number>()
		const liveLane = new Map<AgentName, boolean>()
		for (const lane of AGENTS) {
			const mine = loops.filter((l) => l.agent === lane).sort((a, b) => a.start - b.start)
			const ends: number[] = []
			for (const l of mine) {
				let r = ends.findIndex((e) => e <= l.start)
				if (r < 0) { r = ends.length; ends.push(0) }
				ends[r] = l.end ?? Number.POSITIVE_INFINITY
				placed.push({ ...l, row: r })
			}
			rows.set(lane, Math.max(1, ends.length))
			liveLane.set(lane, mine.some((l) => l.end == null))
		}
		const laneTop = new Map<AgentName, number>()
		let y = TOP
		for (const lane of AGENTS) { laneTop.set(lane, y); y += rows.get(lane)! * ROW + PAD }
		const bottom = y - PAD + 2

		// time scale with folded idle gaps
		const spans = loops.map((l) => [l.start, l.end ?? now] as [number, number]).sort((a, b) => a[0] - b[0])
		const clusters: Cluster[] = []
		for (const [s, e] of spans) {
			const last = clusters[clusters.length - 1]
			if (last && s <= last.end + IDLE_GAP_MS) last.end = Math.max(last.end, e)
			else clusters.push({ start: s, end: e, x0: 0 })
		}
		const t0 = clusters[0]!.start
		const lastC = clusters[clusters.length - 1]!
		const active = clusters.reduce((s, c) => s + (c.end - c.start), 0)
		const padMs = Math.max(0, 4000 - active) + active * 0.02
		lastC.end += padMs
		const plotW = Math.max(40, width - LEFT - RIGHT - (clusters.length - 1) * GAP_W)
		const pxPerMs = plotW / (active + padMs)
		let x0 = LEFT
		for (const c of clusters) { c.x0 = x0; x0 += (c.end - c.start) * pxPerMs + GAP_W }
		const x = (t: number) => {
			const c = clusters.find((k) => t <= k.end) ?? lastC
			return c.x0 + Math.max(0, Math.min(t, c.end) - c.start) * pxPerMs
		}

		const step = [200, 500, 1000, 2000, 5000, 10000, 30000, 60000].find((s) => s * pxPerMs >= 54) ?? 120000
		const ticks: { x: number; label: string }[] = []
		for (const c of clusters) {
			for (let t = Math.ceil((c.start - t0) / step) * step; t <= c.end - t0; t += step) {
				const tx = c.x0 + (t0 + t - c.start) * pxPerMs
				if (ticks.length === 0 || tx - ticks[ticks.length - 1]!.x >= 40) ticks.push({ x: tx, label: tickLabel(t, step) })
			}
		}
		const gaps = clusters.slice(1).map((c, i) => ({ x: c.x0 - GAP_W / 2, idle: c.start - clusters[i]!.end }))
		const clear = ticks.filter((t) => !gaps.some((g) => Math.abs(g.x - t.x) < 52))
		const barY = (l: Placed) => laneTop.get(l.agent)! + l.row * ROW + (ROW - BAR) / 2
		return { ROW, BAR, LEFT, RIGHT, TOP, placed, rows, liveLane, laneTop, bottom, height: bottom + 18, x, ticks: clear, gaps, t0, barY }
	}, [loops, width, now, isCase])

	if (loops.length === 0) return <div className="tl-empty" ref={ref}>{empty ?? "Agent activity draws here once documents are processed: one lane per agent, one bar per loop."}</div>

	const focus = isCase ? loops[0]!.caseId : tip?.loop.caseId ?? selected
	const m = model
	// dependencies of the focused payment: Extractor → Validator + Auditor → Policy (last loop per agent)
	const dep = (() => {
		if (!m || !focus) return null
		const of = (a: AgentName) => m.placed.filter((l) => l.caseId === focus && l.agent === a).pop()
		return { e: of("Extractor"), v: of("Validator"), a: of("Auditor"), p: of("Policy") }
	})()
	const mid = (l: Placed) => m!.barY(l) + m!.BAR / 2
	const curve = (from: Placed, to: Placed) => {
		const x1 = m!.x(from.end ?? now), y1 = mid(from), x2 = m!.x(to.start), y2 = mid(to)
		const dy = y2 - y1
		return `M ${x1} ${y1} C ${x1 + 6} ${y1 + dy * 0.55}, ${x2 - 6} ${y1 + dy * 0.45}, ${x2} ${y2}`
	}
	const par = dep && isCase && dep.v && dep.a ? { ms: overlapMs(dep.v, dep.a, now), x1: m!.x(Math.max(dep.v.start, dep.a.start)), x2: m!.x(Math.min(dep.v.end ?? now, dep.a.end ?? now)) } : null

	return (
		<div className="tl" onMouseLeave={() => setTip(null)}>
			<div ref={ref}>
				{m && (
					<svg width={width} height={m.height} role="img" aria-label={`Timeline of ${loops.length} agent loops. Bars that overlap ran at the same time. The same data is in the loops table.`}>
						{m.ticks.map((t, i) => (
							<g key={i}>
								<line className="grid" x1={t.x} x2={t.x} y1={m.TOP - 2} y2={m.bottom} />
								<text className="tk" x={t.x} y={m.height - 4} textAnchor="middle">{t.label}</text>
							</g>
						))}
						{m.gaps.map((g, i) => (
							<g key={i}>
								<line className="gap" x1={g.x} x2={g.x} y1={m.TOP - 2} y2={m.bottom} />
								<text className="gap-l" x={g.x} y={m.height - 4} textAnchor="middle">idle {duration(g.idle)}</text>
							</g>
						))}
						{AGENTS.map((lane, i) => {
							const top = m.laneTop.get(lane)!
							const h = m.rows.get(lane)! * m.ROW
							const n = m.placed.filter((l) => l.agent === lane).length
							return (
								<g key={lane} className={`agent-${lane}`}>
									{i > 0 && !isCase && <line className="sep" x1={m.LEFT} x2={width - m.RIGHT} y1={top - 5} y2={top - 5} />}
									<circle className={`lane-dot${m.liveLane.get(lane) ? " on" : ""}`} cx={4} cy={top + h / 2 - (n > 1 && !isCase ? 5 : 0)} r={3} />
									<text className="lane" x={13} y={top + h / 2 + (n > 1 && !isCase ? -1 : 4)}>{lane}</text>
									{n > 1 && !isCase && <text className="lane-n" x={13} y={top + h / 2 + 11}>{n} loops</text>}
								</g>
							)
						})}
						{par && par.ms > 0 && dep?.v && dep.a && (
							<g>
								<rect className="par" x={par.x1} y={m.laneTop.get("Validator")! + 2} width={Math.max(1, par.x2 - par.x1)} height={m.ROW * 2 - 4} rx={3} />
								<line className="par-edge" x1={par.x1} x2={par.x1} y1={m.laneTop.get("Validator")!} y2={m.laneTop.get("Auditor")! + m.ROW} />
								<line className="par-edge" x1={par.x2} x2={par.x2} y1={m.laneTop.get("Validator")!} y2={m.laneTop.get("Auditor")! + m.ROW} />
							</g>
						)}
						{m.placed.map((l, i) => {
							const x1 = m.x(l.start)
							const w = Math.max(2, m.x(l.end ?? now) - x1)
							const yy = m.barY(l)
							const dim = !isCase && focus != null && focus !== l.caseId
							return (
								<g key={i} className={`agent-${l.agent}`} onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, loop: l })} onClick={() => onSelect?.(l.caseId)}>
									<rect className={`lp${l.end == null ? " running" : ""}${l.errored ? " err" : ""}${dim ? " dim" : ""}`} x={x1} y={yy} width={w} height={m.BAR} rx={2} />
									<rect className="hit" x={x1 - 2} y={yy - (isCase ? 6 : 2)} width={w + 4} height={m.BAR + (isCase ? 12 : 4)} />
									{isCase && <text className="dur" x={x1 + w + 6} y={yy + m.BAR - 2}>{l.end ? duration(l.end - l.start) : "running"}</text>}
								</g>
							)
						})}
						{dep?.e && [dep.v, dep.a].map((to, i) => to && (
							<g key={`ea${i}`}><path className="dep" d={curve(dep.e!, to)} /><circle className="dep-dot" cx={m.x(to.start)} cy={mid(to)} r={2} /></g>
						))}
						{dep?.p && [dep.v, dep.a].map((from, i) => from && from.end != null && (
							<g key={`vp${i}`}><path className="dep" d={curve(from, dep.p!)} /><circle className="dep-dot" cx={m.x(dep.p!.start)} cy={mid(dep.p!)} r={2} /></g>
						))}
						{par && par.ms > 0 && par.x2 - par.x1 > 96 && <text className="par-l" x={par.x1 + 14} y={m.laneTop.get("Auditor")! + 3}>in parallel {duration(par.ms)}</text>}
						{live && <line className="now" x1={m.x(now)} x2={m.x(now)} y1={m.TOP - 2} y2={m.bottom} />}
					</svg>
				)}
			</div>
			{tip && m && (
				<div className="tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
					<div><b>{tip.loop.agent}</b> · {tip.loop.title}</div>
					<span>started {clock(new Date(tip.loop.start).toISOString())} (+{duration(tip.loop.start - m.t0)})</span>
					<span>{tip.loop.end ? `finished ${clock(new Date(tip.loop.end).toISOString())} · ran ${duration(tip.loop.end - tip.loop.start)}` : `running for ${duration(now - tip.loop.start)}`}{tip.loop.errored ? " · failed" : ""}</span>
				</div>
			)}
		</div>
	)
}
