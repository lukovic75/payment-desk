import { useMemo, useState } from "react"
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react"
import type { DeskSnapshot } from "../lib/api"
import { auditOf, titleOf, type ActorKind } from "../lib/derive"
import { clock } from "../lib/format"
import { href } from "../lib/router"
import { Prov } from "../components/bits"

const ACTORS: { key: "all" | ActorKind; label: string }[] = [
	{ key: "all", label: "Everyone" },
	{ key: "agent", label: "Agents" },
	{ key: "guard", label: "Policy guard" },
	{ key: "human", label: "People" },
	{ key: "desk", label: "Desk" },
]

/** Every recorded step, newest first: who did what to which payment, and on whose authority. */
export function Audit({ snapshot }: { snapshot: DeskSnapshot }) {
	const all = useMemo(() => auditOf(snapshot.cases), [snapshot.cases])
	const [q, setQ] = useState("")
	const [actor, setActor] = useState<"all" | ActorKind>("all")
	const [pay, setPay] = useState("all")
	const needle = q.trim().toLowerCase()
	const shown = all.filter((e) => (actor === "all" || e.actorKind === actor) && (pay === "all" || e.caseId === pay) && (!needle || `${e.actor} ${e.title} ${e.caseId} ${e.detail}`.toLowerCase().includes(needle)))

	const exportJson = () => {
		const a = document.createElement("a")
		a.href = URL.createObjectURL(new Blob([JSON.stringify(shown, null, 2)], { type: "application/json" }))
		a.download = `payment-desk-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`
		a.click()
		URL.revokeObjectURL(a.href)
	}

	return (
		<main className="view">
			<section className="panel">
				<div className="tools">
					<label className="search"><span className="sr-only">Search the audit trail</span><MagnifyingGlass size={14} /><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search events" spellCheck={false} /></label>
					<div className="seg" role="group" aria-label="Filter by actor">
						{ACTORS.map((a) => <button key={a.key} aria-pressed={actor === a.key} onClick={() => setActor(a.key)}>{a.label}</button>)}
					</div>
					<select className="select" aria-label="Filter by payment" value={pay} onChange={(e) => setPay(e.target.value)} style={{ maxWidth: 220 }}>
						<option value="all">All payments</option>
						{snapshot.cases.map((c) => <option key={c.id} value={c.id}>{titleOf(c)} · {c.id}</option>)}
					</select>
					<span className="n" aria-live="polite">{shown.length}/{all.length}</span>
					<button className="btn" onClick={exportJson} disabled={shown.length === 0}><DownloadSimple size={14} /> Export JSON</button>
				</div>
				{all.length === 0 ? (
					<div className="empty"><h2>No events yet</h2><p>Once documents are processed, every agent step, guard decision and human approval is recorded here with its time and actor.</p></div>
				) : shown.length === 0 ? (
					<div className="empty"><h2>No events match</h2><p>Nothing in the trail matches this search and these filters.</p><div className="actions"><button className="btn" onClick={() => { setQ(""); setActor("all"); setPay("all") }}>Clear search and filters</button></div></div>
				) : (
					<div className="grid-table" style={{ ["--cols" as string]: "84px 140px minmax(140px, 240px) minmax(0, 1fr)" }}>
						<div className="tr h"><span>Time</span><span>Actor</span><span>Payment</span><span>Event</span></div>
						{shown.map((e, i) => (
							<div className={`tr${e.kind === "error" ? " err" : ""}`} key={i}>
								<span className="t">{clock(e.at)}</span>
								<span className={`who agent-${e.actor}`}>
									{e.actorKind === "agent" ? <><span className="swatch" />{e.actor}</> : e.actorKind === "human" ? <Prov kind="human" label="Human" /> : e.actorKind === "guard" ? <Prov kind="computed" label="Policy guard" /> : <span className="muted">Desk</span>}
								</span>
								<a className="pay truncate" href={href("inbox", e.caseId)}>{e.title}</a>
								<span className="wide soft">{e.detail}</span>
							</div>
						))}
					</div>
				)}
			</section>
			<p className="muted" style={{ fontSize: "var(--fs-12)", maxWidth: "80ch" }}>The trail lives in the desk server's memory for this run. Processing the inbox again starts a new one, so export what you need to keep.</p>
		</main>
	)
}
