import { useEffect, useMemo, useState } from "react"
import { Play, Moon, Sun, Tray, WarningCircle, Cloud } from "@phosphor-icons/react"
import { money, startRun, useDesk, type PaymentCase } from "./api"
import { CaseList } from "./CaseList"
import { CaseDetail } from "./CaseDetail"
import { Timeline } from "./Timeline"

export function App() {
	const { snapshot, tokens, connected, health } = useDesk()
	const [selected, setSelected] = useState<string | null>(null)
	const [runErr, setRunErr] = useState<string | null>(null)
	const [starting, setStarting] = useState(false)
	const [theme, setTheme] = useTheme()

	const cases = snapshot?.cases ?? []
	const current = useMemo(() => cases.find((c) => c.id === selected) ?? null, [cases, selected])
	const running = cases.some((c) => ["extracting", "checking", "deciding"].includes(c.stage))
	const awaiting = cases.filter((c) => c.stage === "awaiting_approval")
	const approved = cases.filter((c) => c.stage === "approved")
	const total = (list: PaymentCase[]) => list.reduce((s, c) => s + (c.extraction.result?.amount ?? 0), 0)
	const tokenTotal = Object.values(tokens).reduce((s, t) => s + t.input + t.output, 0)

	useEffect(() => {
		if (!selected && awaiting.length > 0) setSelected(awaiting[0]!.id)
	}, [awaiting.length, selected])

	const run = async () => {
		setStarting(true); setRunErr(null); setSelected(null)
		const r = await startRun()
		if (r.error) setRunErr(r.error)
		setStarting(false)
	}

	const noKey = health && !health.hasModelKey

	return (
		<div className="app">
			<header className="topbar">
				<div className="brand"><Tray size={20} weight="bold" /> Payment Desk <small>Kestrel Retail · accounts payable</small></div>
				<div className="spacer" />
				<div className="meta">
					{snapshot && <span>{snapshot.models.fast} + {snapshot.models.careful}</span>}
					{snapshot?.cloudEnabled && <span title="Mozaik Cloud trace is on: every loop is visible at app.jigjoy.ai"><Cloud size={14} style={{ verticalAlign: "-2px" }} /> Mozaik Cloud</span>}
					<span>{connected ? "live" : "reconnecting"}</span>
				</div>
				<button className="btn btn-icon" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
					{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
				</button>
				<button className="btn btn-primary" disabled={!!noKey || running || starting || !connected} onClick={run}>
					<Play size={14} weight="fill" /> Process<span className="long">&nbsp;inbox{snapshot?.startedAt ? " again" : ""}</span>
				</button>
			</header>

			<main className="main">
				<aside className="list-col">
					{noKey && (
						<div className="banner banner-bad" style={{ marginBottom: 16 }}>
							<WarningCircle size={18} weight="bold" />
							<div>No model API key found, so the agents cannot think. Copy <code>.env.example</code> to <code>.env</code>, set <code>ANTHROPIC_API_KEY</code>, restart <code>npm run dev</code>.</div>
						</div>
					)}
					{runErr && <div className="banner banner-bad" style={{ marginBottom: 16 }}><WarningCircle size={18} weight="bold" /><div>{runErr}</div></div>}

					<div className="panel">
						<div className="stats">
							<div className="stat"><span className="label">Inbox</span><span className="value num">{cases.length || "9"}</span><span className="sub">documents</span></div>
							<div className="stat"><span className="label">Needs approval</span><span className="value num">{awaiting.length}</span><span className="sub">{money(total(awaiting), "EUR")}</span></div>
							<div className="stat"><span className="label">Approved</span><span className="value num">{approved.length}</span><span className="sub">{money(total(approved), "EUR")}</span></div>
							<div className="stat">
								<span className="label">Auto-approved today</span>
								<span className="value num">{snapshot ? Math.round((snapshot.dailyAutoApproved / snapshot.policy.dailyAutoApproveBudget) * 100) : 0}%</span>
								<span className="sub">{snapshot ? `${money(snapshot.dailyAutoApproved)} of ${money(snapshot.policy.dailyAutoApproveBudget, "EUR")}` : ""}</span>
								<div className="budget" aria-hidden><span style={{ width: `${snapshot ? Math.min(100, (snapshot.dailyAutoApproved / snapshot.policy.dailyAutoApproveBudget) * 100) : 0}%` }} /></div>
							</div>
						</div>
					</div>

					<div className="panel" style={{ marginTop: 16 }}>
						<div className="panel-head"><h2>Cases</h2><span className="right">{running ? "processing" : snapshot?.startedAt ? "settled" : "not started"}</span></div>
						{cases.length === 0 ? (
							<div className="empty">
								<Tray size={28} />
								<h2>Nine documents are waiting</h2>
								<p>Invoices in five languages, one payment reminder and one newsletter. Press <strong>Process inbox</strong> and four agents read them at the same time.</p>
							</div>
						) : (
							<CaseList cases={cases} selected={selected} onSelect={(id) => { setSelected(id); if (window.innerWidth < 1024) requestAnimationFrame(() => document.getElementById("case-detail")?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })) }} />
						)}
					</div>
				</aside>

				<section style={{ display: "grid", gap: 16, minWidth: 0 }}>
					<div className="panel">
						<div className="panel-head">
							<h2>Agents on one clock</h2>
							<span className="right">{tokenTotal > 0 ? `${tokenTotal.toLocaleString()} tokens across ${Object.values(tokens).reduce((s, t) => s + t.calls, 0)} calls` : "overlapping bars ran at the same time"}</span>
						</div>
						{snapshot && (
							<div className="agents">
								{snapshot.agents.map((a) => (
									<div key={a.id} className={`agent agent-${a.name}`}>
										<span className="agent-dot" style={{ marginTop: 6 }} />
										<span className="name">{a.name}</span>
										<span className="role">{a.role}</span>
										<span className="model mono">{a.model}{tokens[a.name] ? ` · ${tokens[a.name]!.calls} calls` : ""}</span>
									</div>
								))}
							</div>
						)}
						{snapshot && <Timeline snapshot={snapshot} />}
					</div>

					<div className="panel" style={{ minHeight: 320, scrollMarginTop: 72 }} id="case-detail">
						{current ? (
							<CaseDetail c={current} onChanged={() => { /* SSE delivers the update */ }} />
						) : (
							<div className="empty">
								<h2>{cases.length ? "Pick a case" : "Nothing to review yet"}</h2>
								<p>{cases.length ? "Every number in a case links back to the line of the document it came from." : "Once the inbox is processed, cases that need a human land here first."}</p>
							</div>
						)}
					</div>
				</section>
			</main>
		</div>
	)
}

function useTheme(): ["light" | "dark" | "system", (t: "light" | "dark") => void] {
	const [theme, set] = useState<"light" | "dark" | "system">(() => {
		try { return (localStorage.getItem("pd-theme") as "light" | "dark") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") } catch { return "light" }
	})
	const setTheme = (t: "light" | "dark") => {
		set(t)
		document.documentElement.dataset.theme = t
		try { localStorage.setItem("pd-theme", t) } catch { /* private mode */ }
	}
	return [theme, setTheme]
}
