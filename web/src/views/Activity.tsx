import { useMemo, useState } from "react"
import { CaretRight } from "@phosphor-icons/react"
import type { DeskSnapshot } from "../lib/api"
import { concurrencyOf, isRunning, loopsOf, titleOf, usageOf, type AgentName } from "../lib/derive"
import { clock, count, duration, plain } from "../lib/format"
import { go, href } from "../lib/router"
import { Prov, Tick } from "../components/bits"
import { ROLE } from "../components/AgentFlow"
import { LivingWorkspace, ReplayControls, docLabelOf, inboxScene, sceneOf, useReplay } from "../components/LivingWorkspace"
import { Timeline, useNow } from "../components/Timeline"
import { Drawer, PageHead, Seg, Tabs } from "../components/ui"

export function Activity({ snapshot, id, sub }: { snapshot: DeskSnapshot; id: string | null; sub?: string | null }) {
	const { cases } = snapshot
	const running = cases.some(isRunning)
	const all = useMemo(() => loopsOf(cases), [cases])
	const now = useNow(running)
	const conc = concurrencyOf(all, now)
	const [tab, setTab] = useState<"workspace" | "details">(sub === "details" ? "details" : "workspace")
	const [scope, setScope] = useState<"inbox" | "case">(id || !running ? "case" : "inbox")
	const [picked, setPicked] = useState<AgentName | null>(null)
	const withRuns = cases.filter((c) => c.runs.length > 0)
	// With no payment chosen, the one that shows the most of the workflow: an exception that reached the Investigator.
	const focusId = id && withRuns.some((c) => c.id === id) ? id : (withRuns.find((c) => c.runs.some((r) => r.agent === "Investigator" && r.attempt === c.attempt)) ?? withRuns[0])?.id ?? null
	const focus = scope === "case" && focusId ? cases.find((c) => c.id === focusId) ?? null : null
	const shown = focus ? all.filter((l) => l.caseId === focus.id) : all
	const events = Object.entries(snapshot.runtime.events).sort((a, b) => b[1] - a[1])
	const sorted = [...all].sort((a, b) => a.start - b.start)
	const investigated = cases.filter((c) => c.runs.some((r) => r.agent === "Investigator")).length
	const replay = useReplay(focus)
	// Collaboration figures. Each is a count over records the server keeps; none is a score.
	const collab = useMemo(() => {
		let readTwice = 0, disagreed = 0, raised = 0, withEvidence = 0, accepted = 0, waiting = 0, overridden = 0, outputChecks = 0
		for (const c of cases) {
			const x = c.extraction.result, a = c.audit.result?.reading
			const differs = new Set((c.challenges ?? []).filter((k) => k.category === "reading_disagreement").map((k) => k.field))
			if (x && a) for (const f of ["gross", "currency", "iban"] as const) if (x[f] != null && a[f] != null) differs.has(f) ? disagreed++ : readTwice++
			for (const k of c.challenges ?? []) { raised++; if (k.status === "matched_to_record") withEvidence++; else if (k.status === "accepted_by_reviewer") accepted++; else if (k.status === "requires_human_verification" || k.status === "unresolved" || k.status === "open") waiting++ }
			if (c.decision.result?.overridden) overridden++
			outputChecks += c.outputChecks?.length ?? 0
		}
		return { readTwice, disagreed, raised, withEvidence, accepted, waiting, overridden, outputChecks }
	}, [cases])
	const live = focus ? isRunning(focus) : running
	const mode = !focus ? "inbox" : live ? "live" : replay.at != null ? "replay" : "recorded"
	const scene = focus ? sceneOf(focus, live ? null : replay.at, now) : inboxScene(cases, all)

	return (
		<main className="view">
			<PageHead title="Agent Activity" sub="Five agents read, check and investigate each document. Code has the last word.">
				<Seg value={focusId ? scope : "inbox"} onChange={(v) => { setScope(v); replay.stop() }} label="Scope" options={[{ value: "case", label: "One payment", disabled: !focusId }, { value: "inbox", label: "Whole inbox" }]} />
				{scope === "case" && focusId && (
					<select className="select" aria-label="Payment" value={focusId} onChange={(e) => { replay.stop(); go("activity", e.target.value, true) }} style={{ maxWidth: 240 }}>
						{withRuns.map((c) => <option key={c.id} value={c.id}>{titleOf(c)} · {c.id}</option>)}
					</select>
				)}
			</PageHead>

			<Tabs value={tab} onChange={setTab} label="Agent activity views" tabs={[{ value: "workspace", label: "Workspace" }, { value: "details", label: "Execution details" }]} />

			{tab === "workspace" ? (
				<>
					<LivingWorkspace scene={scene} sceneKey={focus ? `${focus.id}:${focus.attempt}:${mode === "replay" ? "replay" : "state"}` : "inbox"} mode={mode} picked={picked} onPick={(a) => setPicked(picked === a ? null : a)} docLabel={focus ? docLabelOf(focus) : cases.length ? `${cases.length} documents` : undefined}>
						{focus ? (live ? null : <ReplayControls r={replay} title={titleOf(focus)} />) : focusId ? <button type="button" className="btn" onClick={() => setScope("case")}>Follow one payment</button> : null}
					</LivingWorkspace>
					<section className="statline" aria-label="What the agents have done, from recorded state">
						<div className="stat"><span className="k">Documents decided</span><span className="v"><Tick value={cases.filter((c) => !isRunning(c)).length} /><small>of {cases.length}</small></span></div>
						<div className="stat"><span className="k">Side by side</span>{conc.loops ? <span className="v"><Tick value={conc.peak} /><small>agent loops at one instant</small></span> : <span className="v none">Not measured</span>}</div>
						<div className="stat"><span className="k">Exceptions investigated</span><span className="v"><Tick value={investigated} /></span></div>
					</section>
				</>
			) : (
				<>
					<section className="statline" aria-label="Concurrency, from recorded timestamps">
						<div className="stat"><span className="k">Loops</span><span className="v"><Tick value={conc.loops} />{conc.running > 0 && <small>{conc.running} running</small>}</span></div>
						<div className="stat"><span className="k">Peak in parallel</span><span className="v"><Tick value={conc.peak} /><small>at one instant</small></span></div>
						<div className="stat"><span className="k">Agent time</span>{conc.loops ? <span className="v">{duration(conc.agentMs)}<small>sum of loops</small></span> : <span className="v none">Not measured</span>}</div>
						<div className="stat"><span className="k">Wall time</span>{conc.loops ? <span className="v">{duration(conc.wallMs)}<small>agents active</small></span> : <span className="v none">Not measured</span>}</div>
						<div className="stat"><span className="k">Investigations <Prov kind="computed" label="" /></span><span className="v"><Tick value={investigated} /><small>on an exception</small></span></div>
					</section>
					<section className="sec">
						<div className="sec-title"><h2>What the agents did for each other</h2><span className="right">counted from the cases' own records</span></div>
						<div className="statline" aria-label="Collaboration, counted from recorded state">
							<div className="stat" title="Amount, currency and IBAN that the Extractor and the Auditor each read from the document, without seeing the other's reading, and on which they agree."><span className="k">Critical fields read twice, in agreement</span>{collab.readTwice + collab.disagreed > 0 ? <span className="v">{collab.readTwice}<small>of {collab.readTwice + collab.disagreed}</small></span> : <span className="v none">Not measured</span>}</div>
							<div className="stat" title="Structured disagreements on record: two readings that differ, a document that contradicts itself, an account that is not the one on file, a report that contradicts the computed check."><span className="k">Cross-checks raised</span><span className="v">{collab.raised}{collab.raised > 0 && <small>{collab.withEvidence} matched to a record · {collab.accepted} accepted by a reviewer · {collab.waiting} waiting for a person</small>}</span></div>
							<div className="stat" title="Payments where the Policy agent recommended something looser than the controls allow. The controls decided."><span className="k">Recommendations the controls overrode</span><span className="v">{collab.overridden}</span></div>
							<div className="stat" title="Parts of a model's answer that code found wrong and removed or refused: a citation to nothing, an invented rule, a result that does not match its schema."><span className="k">Output checks</span><span className="v">{collab.outputChecks}</span></div>
						</div>
					</section>
					<section className="sec">
						<div className="sec-title"><h2>Execution timeline</h2><span className="right">{focus ? titleOf(focus) : "one lane per agent · overlap is real concurrency"}</span></div>
						<div className="panel">
							<Timeline loops={shown} scope={focus ? "case" : "inbox"} live={running} selected={scope === "inbox" ? id : null} onSelect={(c) => go("activity", c, true)}
								empty="No agent has run yet. Run the demo and every loop appears here on a shared clock: one lane per agent, one bar per loop, overlap means the loops ran at the same time." />
						</div>
					</section>
					<details className="panel fold" open={all.length > 0}>
						<summary><CaretRight size={12} weight="bold" className="caret" /> Every loop <span className="right">{all.length} loops · {count(events.reduce((s, [, n]) => s + n, 0))} Mozaik events</span></summary>
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
								<div className="sec-body" style={{ borderTop: "1px solid var(--line)", paddingTop: "var(--sp-4)" }}>
									<div className="sub-h">Events published on the Mozaik runtime this run</div>
									<div className="chips">{events.length ? events.map(([type, n]) => <span key={type} className="tag line"><span className="mono">{type}</span> {count(n)}</span>) : <span className="muted">none yet</span>}</div>
									<p className="fine">{snapshot.runtime.participants} participants are joined to the runtime: five agents, the firewall, the desk and an observer. Agents react to events; nothing calls them in sequence. Model reasoning is not recorded or shown.</p>
								</div>
							</>
						)}
					</details>
				</>
			)}

			<Drawer open={picked != null} onClose={() => setPicked(null)} label="Agent inspector" kicker={focus ? `On ${titleOf(focus)}` : "Across the inbox"} title={picked ?? ""}>
				{picked && (() => {
					const a = snapshot.agents.find((x) => x.name === picked)
					const mine = shown.filter((l) => l.agent === picked)
					const done = mine.filter((l) => l.end != null && !l.errored)
					const t = usageOf(mine)
					// what these loops were recorded with; the configured model is named only when no loop has run, and as that
					const ran = [...new Set(mine.map((l) => l.run.model).filter(Boolean))]
					const predefined = ran.length > 0 && ran.every((m) => m === "scripted fixture")
					const retries = mine.reduce((n, l) => n + l.run.retry, 0)
					const found = focus ? findingsOf(picked, focus) : null
					return (
						<>
							<p className="say">{a?.role ?? ROLE[picked]}.</p>
							<dl className="kv">
								<div><dt>Model</dt><dd className="mono">{ran.length ? ran.join(", ") : <>{a?.model ?? "unknown"} <span className="muted">(configured; no loop has run)</span></>}</dd></div>
								<div><dt>Loops</dt><dd>{mine.length}{mine.some((l) => l.end == null) ? `, ${mine.filter((l) => l.end == null).length} running` : ""}{mine.some((l) => l.errored) ? `, ${mine.filter((l) => l.errored).length} failed` : ""}</dd></div>
								<div><dt>{focus ? "Duration" : "Average duration"}</dt><dd>{done.length ? duration(done.reduce((s, l) => s + (l.end! - l.start), 0) / done.length) : <span className="muted">not measured</span>}</dd></div>
								<div><dt>Retries</dt><dd>{mine.length ? retries : <span className="muted">not measured</span>}</dd></div>
								<div><dt>Tokens</dt><dd>{t.reported > 0 ? <>{count(t.tokens)} <span className="muted">reported for {t.reported} of {mine.length} loops</span></> : <span className="muted">{predefined ? "none: predefined responses, no model was called" : "not reported by the provider"}</span>}</dd></div>
							</dl>
							{found && <div className="facts"><div className="sub-h">Findings on this payment <Prov kind="agent" /></div>{found.length ? <ul className="bullets">{found.map((f, n) => <li key={n}>{f}</li>)}</ul> : <p className="muted">Nothing recorded by this agent for this payment.</p>}</div>}
							{mine.length > 0 && (
								<div className="facts">
									<div className="sub-h">{focus ? "Executions" : "Latest executions"}</div>
									<ul className="runs">
										{[...mine].sort((x, y) => y.start - x.start).slice(0, 8).map((l, n) => (
											<li key={n} className={l.errored ? "err" : ""}>
												<a href={href("inbox", l.caseId)}>{l.title}</a><span className="mono">{l.end ? duration(l.end - l.start) : "running"}</span>
												<span className="fine">{clock(l.run.startedAt, true)}{l.run.id ? ` · ${l.run.id}` : ""} · {l.errored ? `${l.run.status}: ${l.run.error ?? ""}` : l.run.trigger}</span>
											</li>
										))}
									</ul>
								</div>
							)}
							<p className="fine">Reasoning is not recorded. What is shown here is the agent's recorded output and the timing the server measured.</p>
						</>
					)
				})()}
			</Drawer>
		</main>
	)
}

/** The structured output one agent left on one payment, as short statements. Advisory by nature. */
function findingsOf(agent: AgentName, c: DeskSnapshot["cases"][number]): string[] {
	const x = c.extraction.result
	if (agent === "Extractor") return x ? [x.isPaymentRequest ? `Read a payment request from ${x.creditorName ?? "an unnamed creditor"}, with ${Object.keys(x.refs).length} cited values.` : `Read the document as a ${x.documentKind}.`, ...(x.note ? [plain(x.note)] : [])] : []
	if (agent === "Auditor") return c.audit.result ? [plain(c.audit.result.summary), ...c.audit.result.conflicts.map((k) => `The document contradicts itself on ${k.field}: ${k.values.join(" vs ")}.`)] : []
	if (agent === "Validator") return c.validation.result ? [plain(c.validation.result.summary), ...c.validation.result.issues.map((i) => plain(i.message))] : []
	if (agent === "Investigator") return c.investigation.result ? [plain(c.investigation.result.explanation), ...c.investigation.result.unknowns.map((u) => `Unknown: ${plain(u)}`)] : []
	const rec = c.decision.result?.recommended
	return rec ? [`Recommended ${rec.disposition.replace(/_/g, " ").toLowerCase()}. ${plain(rec.explanation)}`] : []
}
