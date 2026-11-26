import { useMemo, useState } from "react"
import { ArrowRight, CaretRight } from "@phosphor-icons/react"
import type { DeskSnapshot } from "../lib/api"
import { concurrencyOf, isRunning, loopsOf, titleOf, usageOf } from "../lib/derive"
import { clock, count, duration } from "../lib/format"
import { go, href } from "../lib/router"
import { Prov, Tick } from "../components/bits"
import { Timeline, useNow } from "../components/Timeline"

export function Activity({ snapshot, id }: { snapshot: DeskSnapshot; id: string | null }) {
	const { cases } = snapshot
	const running = cases.some(isRunning)
	const all = useMemo(() => loopsOf(cases), [cases])
	const now = useNow(running)
	const conc = concurrencyOf(all, now)
	const usage = usageOf(all)
	const [scope, setScope] = useState<"inbox" | "case">(id ? "case" : "inbox")
	const withRuns = cases.filter((c) => c.runs.length > 0)
	const focus = id && withRuns.some((c) => c.id === id) ? id : withRuns[0]?.id ?? null
	const shown = scope === "case" && focus ? all.filter((l) => l.caseId === focus) : all
	const events = Object.entries(snapshot.runtime.events).sort((a, b) => b[1] - a[1])
	const sorted = [...all].sort((a, b) => a.start - b.start)
	const investigated = cases.filter((c) => c.runs.some((r) => r.agent === "Investigator")).length

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
							<select className="select" aria-label="Payment" value={focus} onChange={(e) => go("activity", e.target.value, true)}>
								{withRuns.map((c) => <option key={c.id} value={c.id}>{titleOf(c)} · {c.id}</option>)}
							</select>
						)}
					</div>
				</div>
				<div className="stats">
					<div className="stat"><span className="k">Loops</span><span className="v"><Tick value={conc.loops} />{conc.running > 0 && <small>{conc.running} running</small>}</span></div>
					<div className="stat"><span className="k">Peak in parallel</span><span className="v"><Tick value={conc.peak} /><small>at one instant</small></span></div>
					<div className="stat"><span className="k">Agent time</span>{conc.loops ? <span className="v">{duration(conc.agentMs)}<small>sum of loops</small></span> : <span className="v none">n/a</span>}</div>
					<div className="stat"><span className="k">Wall time</span>{conc.loops ? <span className="v">{duration(conc.wallMs)}<small>agents active</small></span> : <span className="v none">n/a</span>}</div>
					<div className="stat"><span className="k">Investigations <Prov kind="computed" label="" /></span><span className="v"><Tick value={investigated} /><small>triggered by an exception</small></span></div>
				</div>
				<div className={`live-surface${running ? " is-live" : ""}`}>
					<Timeline loops={shown} scope={scope === "case" && focus ? "case" : "inbox"} live={running} selected={scope === "inbox" ? id : null} onSelect={(c) => go("activity", c, true)}
						empty="No agent has run yet. Run the demo scenarios and every loop appears here on a shared clock: one lane per agent, one bar per loop, overlap means the loops ran at the same time." />
				</div>
				<div className="flow" aria-label="How a document moves between agents">
					<span className="node agent-Extractor"><span className="swatch" />Extractor</span><ArrowRight size={12} />
					<span className="fork"><span className="node agent-Validator"><span className="swatch" />Validator</span><span className="node agent-Auditor"><span className="swatch" />Auditor</span><em>in parallel</em></span><ArrowRight size={12} />
					<span className="node">Firewall compares</span><ArrowRight size={12} />
					<span className="node agent-Investigator opt"><span className="swatch" />Investigator <i>on an exception</i></span><ArrowRight size={12} />
					<span className="node agent-Policy"><span className="swatch" />Policy</span><ArrowRight size={12} />
					<span className="node">Firewall enforces</span>
				</div>
			</section>

			<div className="agents">
				{snapshot.agents.map((a) => {
					const mine = all.filter((l) => l.agent === a.name)
					const done = mine.filter((l) => l.end != null)
					const avg = done.length ? done.reduce((s, l) => s + (l.end! - l.start), 0) / done.length : null
					const t = usage.byAgent[a.name]
					const live = mine.some((l) => l.end == null)
					return (
						<section key={a.id} className={`panel agent-card agent-${a.name}`}>
							<div className="who"><span className="swatch" />{a.name}{live && <span className="tag run"><span className="dot" aria-hidden />running</span>}<span className="mono">{a.model}</span></div>
							<p>{a.role}.</p>
							<dl>
								<div><dt>Loops</dt><dd>{mine.length}</dd></div>
								<div><dt>Avg duration</dt><dd>{avg != null ? duration(avg) : <span className="muted">n/a</span>}</dd></div>
								<div><dt>Tokens</dt><dd>{t && t.reported > 0 ? `${count(Math.round(t.tokens / 1000))}k` : <span className="muted" title="The provider has reported no usage for this agent.">unavailable</span>}</dd></div>
							</dl>
						</section>
					)
				})}
			</div>

			<details className="panel fold">
				<summary><CaretRight size={12} weight="bold" className="caret" /> Technical details <span className="right">{all.length} loops · {count(events.reduce((s, [, n]) => s + n, 0))} Mozaik events</span></summary>
				{all.length === 0 ? <div className="empty"><p>Loop start and finish times, models, retries, token usage and the Mozaik event counts appear here after the first run.</p></div> : (
					<>
						<div className="grid-table" style={{ ["--cols" as string]: "104px minmax(130px, 1fr) 132px 92px 92px 76px 52px 84px minmax(120px, 1fr)", maxHeight: 380 }}>
							<div className="tr h"><span>Agent</span><span>Payment</span><span>Model</span><span>Started</span><span>Finished</span><span className="num">Duration</span><span className="num">Retries</span><span className="num">Tokens</span><span>Triggered by</span></div>
							{sorted.map((l, i) => (
								<div className={`tr${l.errored ? " err" : ""}`} key={i}>
									<span className={`who agent-${l.agent}`}><span className="swatch" />{l.agent}</span>
									<a className="pay truncate" href={href("inbox", l.caseId)}>{l.title}</a>
									<span className="t">{l.run.model}</span>
									<span className="t">{clock(l.run.startedAt, true)}</span>
									<span className="t">{l.run.finishedAt ? clock(l.run.finishedAt, true) : "running"}</span>
									<span className="num">{duration((l.end ?? now) - l.start)}</span>
									<span className="num">{l.run.retry}</span>
									<span className="num">{l.run.tokens ? count(l.run.tokens.input + l.run.tokens.output) : <span className="muted" title="The provider reported no usage for this loop.">n/a</span>}</span>
									<span className="wide soft truncate" title={l.run.trigger}>{l.run.status === "done" || l.run.status === "running" ? l.run.trigger : `${l.run.status}: ${l.run.error ?? ""}`}</span>
								</div>
							))}
						</div>
						<div className="sec-body" style={{ borderTop: "1px solid var(--line)" }}>
							<div className="sub-h">Events published on the Mozaik runtime this run</div>
							<div className="chips">{events.length ? events.map(([type, n]) => <span key={type} className="tag line"><span className="mono">{type}</span> {count(n)}</span>) : <span className="muted">none yet</span>}</div>
							<p className="muted" style={{ fontSize: "var(--fs-12)" }}>{snapshot.runtime.participants} participants are joined to the runtime: five agents, the firewall, the desk and an observer. Agents react to events; nothing calls them in sequence. Model reasoning is not recorded or shown, only tool calls, results and findings.</p>
						</div>
					</>
				)}
			</details>
		</main>
	)
}
