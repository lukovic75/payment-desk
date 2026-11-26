import { useEffect, useState, type ReactNode } from "react"
import { DotsThree, Flask, GearSix, Graph, ListChecks, Moon, Play, Plus, Presentation, Receipt, SealCheck, ShieldCheck, SidebarSimple, SquaresFour, Stamp, Sun } from "@phosphor-icons/react"
import type { DeskSnapshot, Link } from "../lib/api"
import { href, TITLES, type View } from "../lib/router"
import { useIndicator } from "./ui"

export type ShellProps = {
	view: View
	snapshot: DeskSnapshot | null
	link: Link
	counts: { inbox: number; queue: number; settled: number; running: boolean }
	collapsed: boolean
	onToggleNav: () => void
	theme: "light" | "dark"
	onToggleTheme: () => void
	canAct: boolean
	onAdd: () => void
	children: ReactNode
}

type Item = { view: View; icon: ReactNode; short: string; tab?: boolean }
const GROUPS: { label: string; items: Item[] }[] = [
	{ label: "Workspace", items: [
		{ view: "overview", icon: <SquaresFour size={18} />, short: "Overview", tab: true },
		{ view: "inbox", icon: <Receipt size={18} />, short: "Payments", tab: true },
		{ view: "queue", icon: <ListChecks size={18} />, short: "Review", tab: true },
		{ view: "showcase", icon: <Presentation size={18} />, short: "Showcase" },
	] },
	{ label: "Intelligence", items: [
		{ view: "firewall", icon: <ShieldCheck size={18} />, short: "Firewall" },
		{ view: "activity", icon: <Graph size={18} />, short: "Agents", tab: true },
	] },
	{ label: "Assurance", items: [
		{ view: "audit", icon: <Stamp size={18} />, short: "Audit" },
		{ view: "lab", icon: <Flask size={18} />, short: "Lab" },
	] },
]
const SETTINGS: Item = { view: "settings", icon: <GearSix size={18} />, short: "Settings" }
const SPLIT: View[] = ["inbox", "queue", "firewall"]

export function Shell(p: ShellProps) {
	const { snapshot, link, counts } = p
	const workspace = snapshot?.policy.debtor.name ?? "Workspace"
	const total = snapshot?.cases.length ?? 0
	const [more, setMore] = useState(false)
	const [nav, pill] = useIndicator<HTMLElement>(`${p.view}:${p.collapsed}`, '.nav-groups [aria-current="page"], .nav-foot [aria-current="page"]', "y")
	useEffect(() => setMore(false), [p.view])
	useEffect(() => {
		if (!more) return
		const off = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest(".nav")) setMore(false) }
		document.addEventListener("pointerdown", off)
		return () => document.removeEventListener("pointerdown", off)
	}, [more])

	const link_ = (it: Item, inSheet = false) => (
		<a key={it.view} className="nav-item" href={href(it.view)} aria-current={p.view === it.view ? "page" : undefined} data-tab={it.tab && !inSheet ? "" : undefined} data-tip={TITLES[it.view]} data-tip-side="right">
			{it.icon}
			<span data-short={it.short}>{TITLES[it.view]}</span>
			{it.view === "queue" && counts.queue > 0 && <i className="nav-count attn" aria-label={`${counts.queue} blocked or waiting for approval`}>{counts.queue}</i>}
			{it.view === "activity" && counts.running && <i className="nav-live" aria-label="agents are running" />}
		</a>
	)

	const state = link.state !== "live" ? (link.state === "connecting" ? "idle" : "down") : counts.running ? "busy" : "live"
	const mozaik = snapshot ? `Mozaik runtime in the desk server: ${snapshot.runtime.participants} participants joined. Cloud trace ${snapshot.cloudEnabled ? "on" : "off"}.${snapshot.modelMode === "scripted" ? " Scripted model." : ""}` : ""
	const stateText = link.state === "connecting" ? "Connecting" : link.state === "reconnecting" ? "Reconnecting" : counts.running ? `Processing ${counts.settled} of ${total}` : "Connected"
	const stateTitle = link.state === "live" ? `The event stream from the desk server is open. ${mozaik}` : `The event stream dropped. Reconnect attempt ${link.attempts}.`
	const pinned = SPLIT.includes(p.view)
	// One way into the guided demo, from every page. Its label says where the demo stands; it never starts anything by itself.
	const steps = snapshot?.showcase?.steps.filter((s) => !s.optional) ?? []
	const demo = !snapshot?.showcase ? "Start demo" : steps.every((s) => s.result !== "not_run" && s.result !== "running") ? "Demo summary" : "Continue demo"

	return (
		<div className="shell" data-nav={p.collapsed ? "collapsed" : "open"}>
			<nav className="nav" aria-label="Primary" ref={nav} data-more={more ? "" : undefined}>
				<span className="nav-pill" ref={pill} aria-hidden />
				<a className="nav-head" href={href("overview")} aria-label="Payment Desk, overview">
					<span className="nav-mark"><SealCheck size={17} weight="fill" /></span>
					<span className="nav-id"><b>Payment Desk</b><span className="truncate">{workspace}</span></span>
				</a>
				<div className="nav-groups">
					{GROUPS.map((g) => [<div className="nav-label" key={g.label}>{g.label}</div>, ...g.items.map((it) => link_(it))])}
				</div>
				<button type="button" className="nav-item nav-more" aria-expanded={more} aria-label="More places" onClick={() => setMore(!more)}><DotsThree size={18} weight="bold" /><span data-short="More">More</span></button>
				<div className="nav-sheet">{[...GROUPS.flatMap((g) => g.items).filter((it) => !it.tab), SETTINGS].map((it) => link_(it, true))}</div>
				<div className="nav-foot">
					{link_(SETTINGS)}
					<div className="nav-env" data-tip="Sandbox · synthetic data" data-tip-side="right"><i aria-hidden /><span>Sandbox workspace<small>Synthetic data. Nothing reaches a bank.</small></span></div>
				</div>
			</nav>

			<div className="frame">
				<header className="bar">
					<button className="btn btn-ghost btn-icon nav-toggle" onClick={p.onToggleNav} aria-label={p.collapsed ? "Expand the sidebar" : "Collapse the sidebar"} aria-pressed={p.collapsed}>
						<SidebarSimple size={17} />
					</button>
					{pinned ? <h1 className="bar-title" data-pinned>{TITLES[p.view]}</h1> : <span className="bar-title" aria-hidden>{TITLES[p.view]}</span>}

					<div className="bar-actions">
						<span className="conn" data-state={state} role="status" title={stateTitle}>
							<i aria-hidden /><span>{stateText}</span>
							{counts.running && <span className="conn-meter" aria-hidden><span style={{ transform: `scaleX(${total ? counts.settled / total : 0})` }} /></span>}
							<span className="sr-only">{stateTitle}</span>
						</span>
						<button className="btn btn-ghost btn-icon btn-round" onClick={p.onToggleTheme} aria-label={p.theme === "dark" ? "Switch to the light appearance" : "Switch to the dark appearance"} data-tip={p.theme === "dark" ? "Light appearance" : "Dark appearance"}>
							{p.theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
						</button>
						<button className="btn" disabled={!p.canAct} onClick={p.onAdd}><Plus size={14} weight="bold" /><span className="wide">Document</span></button>
						{p.view !== "showcase" && <a className="btn btn-primary" href={href("showcase")}><Play size={12} weight="fill" /><span>{demo}</span></a>}
					</div>
				</header>
				{p.children}
			</div>
		</div>
	)
}
