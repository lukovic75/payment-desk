import { useEffect, useMemo, useState } from "react"
import type { DeskSnapshot } from "./api"

type Bar = { agent: string; caseId: string; start: number; end: number | null; errored: boolean; row: number }

const LANES = ["Extractor", "Validator", "Auditor", "Policy"] as const
const ROW_H = 12
const BAR_H = 8
const LANE_PAD = 8
const LEFT = 76
const TOP = 18
const RIGHT = 12

/** Every agent loop as a bar on one shared clock: overlap is the proof that agents run together. */
export function Timeline({ snapshot }: { snapshot: DeskSnapshot }) {
	const running = snapshot.cases.some((c) => ["extracting", "checking", "deciding"].includes(c.stage))
	const [now, setNow] = useState(Date.now())
	useEffect(() => {
		if (!running) return
		const id = setInterval(() => setNow(Date.now()), 250)
		return () => clearInterval(id)
	}, [running])
	useEffect(() => { setNow(Date.now()) }, [snapshot])

	const { bars, t0, tEnd, rowsPerLane } = useMemo(() => {
		const t0 = snapshot.startedAt ? Date.parse(snapshot.startedAt) : 0
		const bars: Bar[] = []
		let tEnd = t0
		for (const c of snapshot.cases) {
			const open = new Map<string, Bar>()
			for (const e of c.timeline) {
				const t = Date.parse(e.at)
				if (e.kind === "loop.started") {
					const b: Bar = { agent: e.agent, caseId: c.id, start: t, end: null, errored: false, row: 0 }
					open.set(e.agent, b)
					bars.push(b)
				} else if ((e.kind === "answer" || e.kind === "error") && open.has(e.agent)) {
					const b = open.get(e.agent)!
					b.end = t
					b.errored = e.kind === "error"
					open.delete(e.agent)
					tEnd = Math.max(tEnd, t)
				}
			}
		}
		// Pack concurrent loops of one agent into sub-rows so every parallel loop stays visible.
		const rowsPerLane = new Map<string, number>()
		for (const lane of LANES) {
			const mine = bars.filter((b) => b.agent === lane).sort((a, b) => a.start - b.start)
			const rowEnds: number[] = []
			for (const b of mine) {
				let r = rowEnds.findIndex((end) => end <= b.start)
				if (r < 0) { r = rowEnds.length; rowEnds.push(0) }
				b.row = r
				rowEnds[r] = b.end ?? Number.POSITIVE_INFINITY
			}
			rowsPerLane.set(lane, Math.max(1, rowEnds.length))
		}
		return { bars, t0, tEnd, rowsPerLane }
	}, [snapshot])

	if (!snapshot.startedAt || bars.length === 0) return <div className="timeline-empty">Agent activity appears here as soon as the inbox is processed.</div>

	const last = Math.max(tEnd, bars.some((b) => b.end === null) ? now : tEnd)
	const span = Math.max(5000, last - t0 + 500)
	const width = 960
	const plotW = width - LEFT - RIGHT
	const x = (t: number) => LEFT + ((t - t0) / span) * plotW
	const laneTop: number[] = []
	let y = TOP
	for (const lane of LANES) { laneTop.push(y); y += (rowsPerLane.get(lane) ?? 1) * ROW_H + LANE_PAD }
	const plotBottom = y - LANE_PAD
	const height = plotBottom + 18
	const tickStep = span > 60000 ? 10000 : span > 20000 ? 5000 : span > 8000 ? 2000 : 1000
	const ticks: number[] = []
	for (let t = 0; t <= span; t += tickStep) ticks.push(t)
	const fmt = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s`

	return (
		<div className="timeline">
			<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Agent loops over time; overlapping bars ran at the same time">
				{ticks.map((t) => (
					<g key={t}>
						<line className="grid" x1={x(t0 + t)} x2={x(t0 + t)} y1={TOP - 4} y2={plotBottom} />
						<text className="tick" x={x(t0 + t)} y={height - 4} textAnchor="middle">{fmt(t)}</text>
					</g>
				))}
				{LANES.map((lane, i) => (
					<text key={lane} className="lane-label" x={LEFT - 10} y={laneTop[i]! + ((rowsPerLane.get(lane) ?? 1) * ROW_H) / 2 + 4} textAnchor="end">{lane}</text>
				))}
				{bars.map((b, i) => {
					const lane = LANES.indexOf(b.agent as (typeof LANES)[number])
					if (lane < 0) return null
					const x1 = x(b.start)
					const x2 = x(b.end ?? now)
					const w = Math.max(2, x2 - x1)
					return (
						<g key={i} className={`agent-${b.agent}`}>
							<title>{`${b.agent} · ${b.caseId} · ${b.end ? `${((b.end - b.start) / 1000).toFixed(1)} s` : "running"}${b.errored ? " · error" : ""}`}</title>
							<rect className={`bar${b.end ? "" : " running"}${b.errored ? " errored" : ""}`} x={x1} y={laneTop[lane]! + b.row * ROW_H + (ROW_H - BAR_H) / 2} width={w} height={BAR_H} fill="var(--c)" />
						</g>
					)
				})}
				{running && <line className="now" x1={x(now)} x2={x(now)} y1={TOP - 4} y2={plotBottom} />}
			</svg>
		</div>
	)
}
