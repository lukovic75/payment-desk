import type { ReactNode } from "react"
import { ClockCounterClockwise, GearSix, ListChecks, Moon, Play, Plus, Pulse, SidebarSimple, SquaresFour, Sun, Tray } from "@phosphor-icons/react"
import type { DeskSnapshot, Link } from "../lib/api"
import { href, TITLES, type View } from "../lib/router"
import { Spinner } from "./bits"

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
	starting: boolean
	onRun: () => void
	onAdd: () => void
	children: ReactNode
}

const NAV: { view: View; icon: ReactNode }[] = [
	{ view: "overview", icon: <SquaresFour size={16} /> },
	{ view: "inbox", icon: <Tray size={16} /> },
	{ view: "queue", icon: <ListChecks size={16} /> },
	{ view: "activity", icon: <Pulse size={16} /> },
	{ view: "audit", icon: <ClockCounterClockwise size={16} /> },
]
const SHORT: Record<View, string> = { overview: "Overview", inbox: "Inbox", queue: "Review", activity: "Agents", audit: "Audit", settings: "Settings" }

export function Shell(p: ShellProps) {
	const { snapshot, link, counts } = p
	const workspace = snapshot?.policy.debtor.name ?? "Workspace"
	const live = link.state === "live"
	const total = snapshot?.cases.length ?? 0

	return (
		<div className="shell" data-nav={p.collapsed ? "collapsed" : "open"}>
			<nav className="nav" aria-label="Primary">
				<a className="nav-head" href={href("overview")} aria-label="Payment Desk, overview">
					<span className="nav-mark"><Tray size={15} weight="bold" /></span>
					<span className="nav-id"><b>Payment Desk</b><span className="truncate">{workspace}</span></span>
				</a>
				<div className="nav-list">
					{NAV.map(({ view, icon }) => (
						<a key={view} className="nav-item" href={href(view)} aria-current={p.view === view ? "page" : undefined} title={p.collapsed ? TITLES[view] : undefined}>
							{icon}
							<span data-short={SHORT[view]}>{TITLES[view]}</span>
							{view === "inbox" && counts.inbox > 0 && <i className="nav-count">{counts.inbox}</i>}
							{view === "queue" && counts.queue > 0 && <i className="nav-count attn" aria-label={`${counts.queue} waiting for approval`}>{counts.queue}</i>}
							{view === "activity" && counts.running && <i className="nav-live" aria-label="agents are running" />}
						</a>
					))}
				</div>
				<div className="nav-foot">
					<a className="nav-item" href={href("settings")} aria-current={p.view === "settings" ? "page" : undefined} title={p.collapsed ? "Settings" : undefined}>
						<GearSix size={16} /><span data-short="Settings">Settings</span>
					</a>
					<p className="nav-note">Synthetic data. Nothing is sent to a bank.</p>
				</div>
			</nav>

			<div className="frame">
				<header className="bar">
					<button className="btn btn-ghost btn-icon nav-toggle" onClick={p.onToggleNav} aria-label={p.collapsed ? "Expand navigation" : "Collapse navigation"} aria-pressed={p.collapsed}>
						<SidebarSimple size={16} />
					</button>
					<h1>{TITLES[p.view]}</h1>
					<span className="bar-crumb">{workspace}</span>

					<div className="bar-sys" role="status" aria-live="polite">
						<span className={`sys ${live ? "ok" : "down"}`} title={live ? "Server-sent event stream from the desk server is open." : `The event stream dropped. Reconnect attempt ${link.attempts}.`}>
							<i aria-hidden />Server <b>{link.state === "live" ? "live" : link.state === "connecting" ? "connecting" : "reconnecting"}</b>
						</span>
						{snapshot && (
							<span className={`sys ${live ? "ok" : ""}`} title="The Mozaik runtime runs inside the desk server: four agents, the desk and an observer are joined to it. Cloud trace shows whether this machine is paired with Mozaik Cloud.">
								<i aria-hidden />Mozaik <b>{live ? `${snapshot.runtime.participants} participants` : "unknown"}</b>
								<span className="muted sys-extra">· cloud trace {snapshot.cloudEnabled ? "on" : "off"}</span>
							</span>
						)}
						<span className={`sys ${counts.running ? "busy" : ""}`}>
							<i aria-hidden />
							{counts.running
								? <>Processing <b>{counts.settled}/{total}</b><span className="sys-meter" aria-hidden><span style={{ transform: `scaleX(${total ? counts.settled / total : 0})` }} /></span></>
								: total ? <>Settled <b>{total}</b></> : <>Idle</>}
						</span>
					</div>

					<div className="bar-actions">
						<button className="btn btn-ghost btn-icon" onClick={p.onToggleTheme} aria-label={p.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
							{p.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
						</button>
						<button className="btn" disabled={!p.canAct} onClick={p.onAdd}><Plus size={14} weight="bold" /><span className="wide">Add document</span></button>
						<button className="btn btn-primary" disabled={!p.canAct || counts.running || p.starting} onClick={p.onRun}>
							{p.starting ? <Spinner /> : <Play size={13} weight="fill" />}<span>Process<span className="wide"> inbox{snapshot?.startedAt ? " again" : ""}</span></span>
						</button>
					</div>
				</header>
				{p.children}
			</div>
		</div>
	)
}

