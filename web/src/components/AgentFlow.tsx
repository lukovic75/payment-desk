import { Function as Fn } from "@phosphor-icons/react"
import type { DeskSnapshot, PaymentCase } from "../lib/api"
import { outcomeOf, type AgentName, type Loop } from "../lib/derive"
import { duration } from "../lib/format"
import { dispositionLabel } from "./bits"

export const ROLE: Record<AgentName, string> = {
	Extractor: "Reads the document and cites every value",
	Validator: "Checks the reading against trusted records",
	Auditor: "Reads the document again, independently",
	Investigator: "Explains an exception from the evidence",
	Policy: "Recommends what should happen",
}
const STEP = { Extractor: "extraction", Validator: "validation", Auditor: "audit", Investigator: "investigation", Policy: "decision" } as const

type State = "waiting" | "running" | "retrying" | "done" | "failed" | "skipped"
type NodeView = { state: State; text: string; failed: number; time: string | null }

/** What one agent is doing, from the step and run records the server keeps. Nothing here is inferred or simulated. */
function nodeOf(agent: AgentName, loops: Loop[], focus: PaymentCase | null, now: number): NodeView {
	const mine = loops.filter((l) => l.agent === agent)
	if (focus) {
		const step = focus[STEP[agent]]
		const run = mine.filter((l) => l.run.attempt === focus.attempt).pop()
		const time = run ? duration((run.end ?? now) - run.start) : null
		if (step.status === "running") return run && run.run.retry > 0 ? { state: "retrying", text: `Retrying, attempt ${run.run.retry + 1}`, failed: 0, time } : { state: "running", text: "Running", failed: 0, time }
		if (step.status === "done") return { state: "done", text: "Completed", failed: 0, time }
		if (step.status === "error") return { state: "failed", text: "Failed", failed: 1, time }
		if (step.status === "skipped") return { state: "skipped", text: agent === "Investigator" ? "Not needed" : "Skipped", failed: 0, time: null }
		return { state: "waiting", text: "Waiting", failed: 0, time: null }
	}
	const running = mine.filter((l) => l.end == null).length
	const failed = mine.filter((l) => l.errored).length
	const done = mine.filter((l) => l.end != null && !l.errored)
	const avg = done.length ? `avg ${duration(done.reduce((s, l) => s + (l.end! - l.start), 0) / done.length)}` : null
	if (running) return { state: "running", text: `${running} running`, failed, time: done.length ? `${done.length} done` : null }
	if (mine.length === 0) return { state: "waiting", text: agent === "Investigator" ? "Not called yet" : "Waiting", failed: 0, time: null }
	if (done.length === 0) return { state: "failed", text: `${failed} failed`, failed: 0, time: null }
	return { state: "done", text: `${done.length} done`, failed, time: avg }
}

type Props = {
	agents: DeskSnapshot["agents"]
	loops: Loop[]
	/** One payment: the nodes show that payment's own steps. Without it they summarise every loop. */
	focus: PaymentCase | null
	now: number
	picked?: string | null
	onPick?: (agent: AgentName) => void
	decided?: number
}

const Edge = ({ kind, on }: { kind: "line" | "fork" | "join"; on: boolean }) => (
	<svg className={`edge${on ? " on" : ""}`} viewBox="0 0 32 100" preserveAspectRatio="none" aria-hidden>
		{kind === "line" && <path className="flow-edge" d="M0 50 H32" />}
		{kind === "fork" && <><path className="flow-edge" d="M0 50 C18 50 14 25 32 25" /><path className="flow-edge" d="M0 50 C18 50 14 75 32 75" /></>}
		{kind === "join" && <><path className="flow-edge" d="M0 25 C18 25 14 50 32 50" /><path className="flow-edge" d="M0 75 C18 75 14 50 32 50" /></>}
	</svg>
)

/**
 * The workflow as it is wired: one reader, two independent checkers in parallel, an investigator only on an exception,
 * a recommendation, and code that has the last word. A connection moves only while the agent it feeds is really running.
 */
export function AgentFlow({ agents, loops, focus, now, picked, onPick, decided }: Props) {
	const view = (a: AgentName) => nodeOf(a, loops, focus, now)
	const model = (a: AgentName) => agents.find((x) => x.name === a)?.model
	const busy = (a: AgentName) => { const s = view(a).state; return s === "running" || s === "retrying" }
	const node = (a: AgentName) => {
		const v = view(a)
		return (
			<button key={a} type="button" className={`node agent-${a} is-${v.state}`} data-drawer-keep aria-pressed={picked === a} onClick={() => onPick?.(a)} title={model(a)}>
				<span className="node-top"><span className="swatch" /><b>{a}</b></span>
				<span className="node-role">{ROLE[a]}</span>
				<span className="node-state"><i aria-hidden /><span>{v.text}{v.failed > 0 && v.state !== "failed" && <em> · {v.failed} failed</em>}</span>{v.time && <span className="node-time">{v.time}</span>}</span>
			</button>
		)
	}
	const enforced = focus?.decision.result ? dispositionLabel(outcomeOf(focus)) : null
	const compared = focus ? focus.controls.length > 0 : loops.length > 0
	return (
		<div className="graph-box"><div className="graph" role="group" aria-label="How a document moves between the agents and the deterministic controls">
			<div className="stage">{node("Extractor")}</div>
			<Edge kind="fork" on={busy("Validator") || busy("Auditor")} />
			<div className="stage two">{node("Validator")}{node("Auditor")}<span className="par">in parallel</span></div>
			<Edge kind="join" on={false} />
			<div className="stage"><div className={`gate${compared ? " is-done" : ""}`}><Fn size={14} /><b>Compare</b><span>controls in code</span></div></div>
			<Edge kind="line" on={busy("Investigator")} />
			<div className="stage">{node("Investigator")}</div>
			<Edge kind="line" on={busy("Policy")} />
			<div className="stage">{node("Policy")}</div>
			<Edge kind="line" on={false} />
			<div className="stage"><div className={`gate${enforced || (decided ?? 0) > 0 ? " is-done" : ""}`}><Fn size={14} /><b>Enforce</b><span>{enforced ?? (decided != null && decided > 0 ? `${decided} decided` : "stricter of the two")}</span></div></div>
		</div></div>
	)
}

/** The same agents in one quiet line, for the overview: a name, a colour and what each is doing right now. */
export function AgentStrip({ loops, now }: { loops: Loop[]; now: number }) {
	const names: AgentName[] = ["Extractor", "Validator", "Auditor", "Investigator", "Policy"]
	return (
		<div className="strip" role="list" aria-label="Agents">
			{names.map((a) => {
				const v = nodeOf(a, loops, null, now)
				return <div key={a} role="listitem" className={`strip-node agent-${a} is-${v.state}`}><span className="swatch" /><b>{a}</b><span>{v.text}</span></div>
			})}
		</div>
	)
}
