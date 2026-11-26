import { useEffect, useMemo, useState } from "react"
import type { DeskSnapshot } from "./api"
import { isRunning } from "./api"

type Bar = { agent: string; caseId: string; title: string; start: number; end: number | null; errored: boolean; row: number }

const LANES = ["Extractor", "Validator", "Auditor", "Policy"] as const
const ROW_H = 11
const BAR_H = 7
const LANE_PAD = 10
const LEFT = 84
const TOP = 14
const RIGHT = 12
const WIDTH = 960

/** Every agent loop as a bar on one shared clock. Overlap is the proof that agents run together. */
export function Timeline({ snapshot, selected, onSelect }: { snapshot: DeskSnapshot; selected: string | null; onSelect: (id: string) => void }) {
	const running = snapshot.cases.some(isRunning)
	const [now, setNow] = useState(Date.now())
	const [tip, setTip] = useState<{ x: number; y: number; bar: Bar } | null>(null)
	useEffect(() => {
		if (!running) return
		const id = setInterval(() => setNow(Date.now()), 200)
		return () => clearInterval(id)
	}, [running])
	useEffect(() => { setNow(Date.now()) }, [snapshot])

	const { bars, t0, tEnd, rowsPerLane, countPerLane } = useMemo(() => {
		const t0 = snapshot.startedAt ? Date.parse(snapshot.startedAt) : 0
		const bars: Bar[] = []
		let tEnd = t0
		for (const c of snapshot.cases) {
			const open = new Map<string, Bar>()
			const title = c.validation.result?.vendorName ?? c.extraction.result?.creditorName ?? c.id
			for (const e of c.timeline) {
				const t = Date.parse(e.at)
				if (e.kind === "loop.started") {
					const b: Bar = { agent: e.agent, caseId: c.id, title, start: t, end: null, errored: false, row: 0 }
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
		const rowsPerLane = new Map<string, number>()
		const countPerLane = new Map<string, number>()
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
			countPerLane.set(lane, mine.length)
		}
		return { bars, t0, tEnd, rowsPerLane, countPerLane }
	}, [snapshot])

	if (!snapshot.startedAt || bars.length === 0) return <div className="timeline-empty">Agent activity draws here as soon as the inbox is processed: one bar per loop, one lane per agent.</div>

	const last = Math.max(tEnd, bars.some((b) => b.end === null) ? now : tEnd)
	const span = Math.max(5000, last - t0 + 400)
	const plotW = WIDTH - LEFT - RIGHT
	const x = (t: number) => LEFT + ((t - t0) / span) * plotW
	const laneTop: number[] = []
	let y = TOP
	for (const lane of LANES) { laneTop.push(y); y += (rowsPerLane.get(lane) ?? 1) * ROW_H + LANE_PAD }
	const plotBottom = y - LANE_PAD + 2
	const height = plotBottom + 18
	const tickStep = span > 60000 ? 10000 : span > 24000 ? 5000 : span > 10000 ? 2000 : 1000
	const ticks: number[] = []
	for (let t = 0; t <= span; t += tickStep) ticks.push(t)
	const total = ((last - t0) / 1000).toFixed(1)

	return (
		<div className="timeline" onMouseLeave={() => setTip(null)}>
			<svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={`Agent loops over ${total} seconds; overlapping bars ran at the same time`}>
				{ticks.map((t) => (
					<g key={t}>
						<line className="grid" x1={x(t0 + t)} x2={x(t0 + t)} y1={TOP - 4} y2={plotBottom} />
						<text className="tick" x={x(t0 + t)} y={height - 4} textAnchor="middle">{t / 1000}s</text>
					</g>
				))}
				{LANES.map((lane, i) => {
					const rows = rowsPerLane.get(lane) ?? 1
					const mid = laneTop[i]! + (rows * ROW_H) / 2
					return (
						<g key={lane}>
							{i > 0 && <line className="lane-sep" x1={LEFT} x2={WIDTH - RIGHT} y1={laneTop[i]! - LANE_PAD / 2} y2={laneTop[i]! - LANE_PAD / 2} />}
							<text className="lane-label" x={LEFT - 10} y={mid + (rows > 1 ? -2 : 4)} textAnchor="end">{lane}</text>
							{rows > 1 && <text className="lane-count" x={LEFT - 10} y={mid + 10} textAnchor="end">{countPerLane.get(lane)} loops</text>}
						</g>
					)
				})}
				{bars.map((b, i) => {
					const lane = LANES.indexOf(b.agent as (typeof LANES)[number])
					if (lane < 0) return null
					const x1 = x(b.start)
					const w = Math.max(2, x(b.end ?? now) - x1)
					const yy = laneTop[lane]! + b.row * ROW_H + (ROW_H - BAR_H) / 2
					const dim = selected != null && selected !== b.caseId && tip?.bar !== b
					return (
						<g key={i} className={`agent-${b.agent}`} style={{ cursor: "pointer" }}
							onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, bar: b })}
							onClick={() => onSelect(b.caseId)}>
							<rect className="hit" x={x1 - 2} y={yy - 3} width={w + 4} height={BAR_H + 6} />
							<rect className={`bar${b.end ? "" : " running"}${b.errored ? " errored" : ""}${dim ? " dim" : ""}`} x={x1} y={yy} width={w} height={BAR_H} />
						</g>
					)
				})}
				{running && <line className="now" x1={x(now)} x2={x(now)} y1={TOP - 4} y2={plotBottom} />}
			</svg>
			{tip && (
				<div className="tip" style={{ left: tip.x, top: tip.y }} role="tooltip">
					<b>{tip.bar.agent}</b> · {tip.bar.title}<br />
					<span className="mono">{tip.bar.end ? `${((tip.bar.end - tip.bar.start) / 1000).toFixed(1)} s` : "running"}{tip.bar.errored ? " · error" : ""} · starts at {((tip.bar.start - t0) / 1000).toFixed(1)} s</span>
				</div>
			)}
		</div>
	)
}
