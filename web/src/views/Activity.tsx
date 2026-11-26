import { useMemo, useState } from "react"
import { ArrowRight, CaretRight } from "@phosphor-icons/react"
import type { DeskSnapshot, Tokens } from "../lib/api"
import { AGENTS, concurrencyOf, isRunning, loopsOf, titleOf } from "../lib/derive"
import { clock, count, duration } from "../lib/format"
import { go, href } from "../lib/router"
import { Prov, Tick } from "../components/bits"
import { Timeline, useNow } from "../components/Timeline"

export function Activity({ snapshot, tokens, id }: { snapshot: DeskSnapshot; tokens: Tokens; id: string | null }) {
	const { cases } = snapshot
	const running = cases.some(isRunning)
	const all = useMemo(() => loopsOf(cases), [cases])
	const now = useNow(running)
	const conc = concurrencyOf(all, now)
	const [scope, setScope] = useState<"inbox" | "case">(id ? "case" : "inbox")
	const focus = id ?? cases.find((c) => c.timeline.length > 0)?.id ?? null
	const shown = scope === "case" && focus ? all.filter((l) => l.caseId === focus) : all
	const events = Object.entries(snapshot.runtime.events).sort((a, b) => b[1] - a[1])
	const sorted = [...all].sort((a, b) => a.start - b.start)

	return (
		<main className="view">
			<section className="panel">
				<div className="panel-head">
					<h2>Execution timeline</h2>
					<div className="right">
						<div className="seg" role="group" aria-label="Timeline scope">
							<button aria-pressed={scope === "inbox"} onClick={() => setScope("inbox")}>Whole inbox</button>
							<button aria-pressed={scope === "case"} onClick={() => setScope("case")} disabled={!focus}>One payment</button>
						</div>
						{scope === "case" && focus && (
							<select className="select" aria-label="Payment" value={focus} onChange={(e) => go("activity", e.target.value, true)} style={{ maxWidth: 240 }}>
								{cases.filter((c) => c.timeline.length > 0).map((c) => <option key={c.id} value={c.id}>{titleOf(c)} · {c.id}</option>)}
							</select>
						)}
					</div>
				</div>
				<div className="stats">
					<div className="stat"><span className="k">Loops</span><span className="v"><Tick value={conc.loops} />{conc.running > 0 && <small>{conc.running} running</small>}</span></div>
					<div className="stat"><span className="k">Peak in parallel</span><span className="v"><Tick value={conc.peak} /><small>at one instant</small></span></div>
					<div className="stat"><span className="k">Agent time</span>{conc.loops ? <span className="v">{duration(conc.agentMs)}<small>sum of loops</small></span> : <span className="v none">n/a</span>}</div>
					<div className="stat"><span className="k">Wall time</span>{conc.loops ? <span className="v">{duration(conc.wallMs)}<small>agents active</small></span> : <span className="v none">n/a</span>}</div>
					<div className="stat"><span className="k">Concurrency gain <Prov kind="computed" label="" /></span>{conc.speedup ? <span className="v">{conc.speedup.toFixed(1)}×<small>agent time ÷ wall time</small></span> : <span className="v none">n/a</span>}</div>
				</div>
				<div className={`live-surface${running ? " is-live" : ""}`}>
					<Timeline loops={shown} scope={scope === "case" && focus ? "case" : "inbox"} live={running} selected={scope === "inbox" ? id : null} onSelect={(c) => go("activity", c, true)}
						empty="No agent has run yet. Process the inbox and every loop appears here on a shared clock: one lane per agent, one bar per loop, overlap means the loops ran at the same time." />
				</div>
				<div className="flow" aria-label="How a document moves between agents">
					<span className="node agent-Extractor"><span className="swatch" />Extractor</span><ArrowRight size={12} />
					<span className="fork"><span className="node agent-Validator"><span className="swatch" />Validator</span><span className="node agent-Auditor"><span className="swatch" />Auditor</span><em>in parallel</em></span><ArrowRight size={12} />
					<span className="node agent-Policy"><span className="swatch" />Policy</span><ArrowRight size={12} />
					<span className="node">Policy guard</span><ArrowRight size={12} />
					<span className="node">Auto-approve, a person, or reject</span>
				</div>
			</section>

			<div className="agents">
				{snapshot.agents.map((a) => {
					const mine = all.filter((l) => l.agent === a.name && l.end != null)
					const avg = mine.length ? mine.reduce((s, l) => s + (l.end! - l.start), 0) / mine.length : null
					const t = tokens[a.name]
					const live = all.some((l) => l.agent === a.name && l.end == null)
					return (
						<section key={a.id} className={`panel agent-card agent-${a.name}`}>
							<div className="who"><span className="swatch" />{a.name}{live && <span className="tag run"><span className="dot" aria-hidden />running</span>}<span className="mono">{a.model}</span></div>
							<p>{a.role}.</p>
							<dl>
								<div><dt>Loops</dt><dd>{all.filter((l) => l.agent === a.name).length}</dd></div>
								<div><dt>Avg duration</dt><dd>{avg != null ? duration(avg) : <span className="muted">n/a</span>}</dd></div>
								<div><dt>Tokens</dt><dd>{t ? `${count(Math.round((t.input + t.output) / 1000))}k` : <span className="muted">n/a</span>}</dd></div>
							</dl>
						</section>
					)
				})}
			</div>

			<details className="panel fold">
				<summary><CaretRight size={12} weight="bold" className="caret" /> Technical details <span className="right">{all.length} loops · {count(events.reduce((s, [, n]) => s + n, 0))} Mozaik events</span></summary>
				{all.length === 0 ? <div className="empty"><p>Loop start and finish times and the Mozaik event counts appear here after the first run.</p></div> : (
					<>
						<div className="grid-table" style={{ ["--cols" as string]: "110px minmax(140px, 1fr) 96px 96px 84px 84px", maxHeight: 360 }}>
							<div className="tr h"><span>Agent</span><span>Payment</span><span>Started</span><span>Finished</span><span className="num">Offset</span><span className="num">Duration</span></div>
							{sorted.map((l, i) => (
								<div className={`tr${l.errored ? " err" : ""}`} key={i}>
									<span className={`who agent-${l.agent}`}><span className="swatch" />{l.agent}</span>
									<a className="pay truncate" href={href("inbox", l.caseId)}>{l.title}</a>
									<span className="t">{clock(new Date(l.start).toISOString(), true)}</span>
									<span className="t">{l.end ? clock(new Date(l.end).toISOString(), true) : "running"}</span>
									<span className="num">+{duration(l.start - sorted[0]!.start)}</span>
									<span className="num">{l.end ? duration(l.end - l.start) : duration(now - l.start)}{l.errored ? " ✕" : ""}</span>
								</div>
							))}
						</div>
						<div className="sec-body" style={{ borderTop: "1px solid var(--line)" }}>
							<div className="sub-h">Events published on the Mozaik runtime this run</div>
							<div className="chips">{events.length ? events.map(([type, n]) => <span key={type} className="tag line"><span className="mono">{type}</span> {count(n)}</span>) : <span className="muted">none yet</span>}</div>
							<p className="muted" style={{ fontSize: "var(--fs-12)" }}>{snapshot.runtime.participants} participants are joined to the runtime: the four agents, the desk and an observer. {AGENTS.length} agents react to events; nothing calls them in sequence.</p>
						</div>
					</>
				)}
			</details>
		</main>
	)
}
