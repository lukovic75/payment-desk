import { useCallback, useEffect, useMemo, useState } from "react"
import { CloudCheck, Moon, Play, Plus, Sun, Tray, WarningCircle } from "@phosphor-icons/react"
import { isRunning, money, reduceMotion, startRun, useDesk, type PaymentCase } from "./api"
import { CaseList } from "./CaseList"
import { CaseDetail } from "./CaseDetail"
import { Timeline } from "./Timeline"
import { AddDocument } from "./AddDocument"

export function App() {
	const { snapshot, tokens, connected, health } = useDesk()
	const [selected, setSelected] = useState<string | null>(null)
	const [runErr, setRunErr] = useState<string | null>(null)
	const [starting, setStarting] = useState(false)
	const [adding, setAdding] = useState(false)
	const [theme, setTheme] = useTheme()

	const cases = snapshot?.cases ?? []
	const current = useMemo(() => cases.find((c) => c.id === selected) ?? null, [cases, selected])
	const running = cases.some(isRunning)
	const awaiting = cases.filter((c) => c.stage === "awaiting_approval")
	const approved = cases.filter((c) => c.stage === "approved")
	const total = (list: PaymentCase[]) => list.reduce((s, c) => s + (c.extraction.result?.amount ?? 0), 0)
	const tokenTotal = Object.values(tokens).reduce((s, t) => s + t.input + t.output, 0)
	const calls = Object.values(tokens).reduce((s, t) => s + t.calls, 0)
	const budgetPct = snapshot ? Math.min(100, (snapshot.dailyAutoApproved / snapshot.policy.dailyAutoApproveBudget) * 100) : 0

	// The first case that needs a person is the one to open.
	useEffect(() => {
		if (!selected && awaiting.length > 0) setSelected(awaiting[0]!.id)
	}, [awaiting.length, selected])

	const select = useCallback((id: string) => {
		setSelected(id)
		if (window.innerWidth < 1024) requestAnimationFrame(() => document.getElementById("case-detail")?.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" }))
	}, [])

	const run = async () => {
		setStarting(true); setRunErr(null); setSelected(null)
		try { await startRun() } catch (e) { setRunErr((e as Error).message) } finally { setStarting(false) }
	}

	const noKey = health !== null && !health.hasModelKey
	const canAct = !noKey && connected

	return (
		<div className="app">
			<header className="chrome">
				<div className="brand"><span className="mark"><Tray size={15} weight="bold" /></span>Payment Desk <span className="org">· Kestrel Retail, accounts payable</span></div>
				<div className="grow" />
				<div className="status">
					{snapshot && <span className="mono">{snapshot.models.fast} + {snapshot.models.careful}</span>}
					{snapshot?.cloudEnabled && <><span className="sep" /><span title="Mozaik Cloud trace is on: every loop is visible at app.jigjoy.ai" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><CloudCheck size={14} /> Mozaik Cloud</span></>}
					<span className="sep" />
					<span className={`live${connected ? "" : " off"}`}><i aria-hidden />{connected ? "live" : "reconnecting"}</span>
				</div>
				<button className="btn btn-icon" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
					{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
				</button>
				<button className="btn" disabled={!canAct} onClick={() => setAdding(true)}><Plus size={14} weight="bold" /><span className="long">Add document</span></button>
				<button className="btn btn-primary" disabled={!canAct || running || starting} onClick={run}>
					<Play size={14} weight="fill" /><span>Process</span><span className="long">inbox{snapshot?.startedAt ? " again" : ""}</span>
				</button>
			</header>

			<main className="main">
				{noKey && (
					<div className="banner banner-bad">
						<WarningCircle size={18} weight="bold" />
						<div>No model API key found, so the agents cannot think. Copy <code>.env.example</code> to <code>.env</code>, set <code>ANTHROPIC_API_KEY</code> and restart <code>npm run dev</code>.</div>
					</div>
				)}
				{runErr && <div className="banner banner-bad"><WarningCircle size={18} weight="bold" /><div>{runErr}</div></div>}

				<div className="ledger" aria-label="Desk totals">
					<div><span className="k">Inbox</span><span className="v">{cases.length || 9} <small>documents</small></span></div>
					<div><span className="k">Needs approval</span><span className="v">{awaiting.length} <small>{awaiting.length ? money(total(awaiting), "EUR") : ""}</small></span></div>
					<div><span className="k">Approved</span><span className="v">{approved.length} <small>{approved.length ? money(total(approved), "EUR") : ""}</small></span></div>
					<div>
						<span className="k">Auto-approved today</span>
						<span className="v">{snapshot ? money(snapshot.dailyAutoApproved) : "0.00"} <small>of {snapshot ? money(snapshot.policy.dailyAutoApproveBudget, "EUR") : ""}</small></span>
						<span className="bar" aria-hidden><i style={{ width: `${budgetPct}%` }} /></span>
					</div>
					<div className="tokens"><span className="k">Model usage</span><span className="v">{tokenTotal ? `${(tokenTotal / 1000).toFixed(0)}k` : "0"} <small>tokens{calls ? ` · ${calls} calls` : ""}</small></span></div>
				</div>

				<div className="cols">
					<aside className="panel">
						<div className="panel-head"><h2>Cases</h2><span className="right">{running ? "processing" : snapshot?.startedAt ? "settled" : "not started"}</span></div>
						{cases.length === 0 ? (
							<div className="empty">
								<h2>Nine documents are waiting</h2>
								<p>Invoices in five languages, a reminder that duplicates one of them, one with "new bank details", one from a vendor nobody knows, and a newsletter.</p>
								<ol>
									<li>Extractor reads all nine at once.</li>
									<li>Validator and Auditor check each one in parallel.</li>
									<li>Policy routes; you approve the exceptions.</li>
								</ol>
								<div className="actions">
									<button className="btn btn-primary" disabled={!canAct || starting} onClick={run}><Play size={14} weight="fill" /> Process inbox</button>
									<button className="btn" disabled={!canAct} onClick={() => setAdding(true)}><Plus size={14} weight="bold" /> Add your own</button>
								</div>
							</div>
						) : (
							<CaseList cases={cases} selected={selected} onSelect={select} />
						)}
					</aside>

					<section style={{ display: "grid", gap: 16, minWidth: 0 }}>
						<div className="panel">
							<div className="panel-head">
								<h2>Agents on one clock</h2>
								<span className="right">{running ? "running" : snapshot?.startedAt ? "overlapping bars ran at the same time" : "one lane per agent, one bar per loop"}</span>
							</div>
							{snapshot && (
								<div className="agents">
									{snapshot.agents.map((a) => (
										<div key={a.id} className={`agent agent-${a.name}`}>
											<span className="swatch" />
											<span className="name">{a.name} <small>{a.model}{tokens[a.name] ? ` · ${tokens[a.name]!.calls} calls` : ""}</small></span>
											<span className="role">{a.role}</span>
										</div>
									))}
								</div>
							)}
							{snapshot && <Timeline snapshot={snapshot} selected={selected} onSelect={select} />}
						</div>

						<div className="panel" id="case-detail" style={{ minHeight: 280, scrollMarginTop: 68 }}>
							{current ? (
								<CaseDetail c={current} />
							) : (
								<div className="empty">
									<h2>{cases.length ? "Pick a case" : "Nothing to review yet"}</h2>
									<p>{cases.length ? "Every number in a case links to the line of the document it came from. Use ↑ and ↓ in the list." : "Once the inbox is processed, the first case that needs a person opens here."}</p>
								</div>
							)}
						</div>
					</section>
				</div>
			</main>

			<AddDocument open={adding} onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); select(id) }} />
		</div>
	)
}

function useTheme(): ["light" | "dark", (t: "light" | "dark") => void] {
	const [theme, set] = useState<"light" | "dark">(() => {
		try { return (localStorage.getItem("pd-theme") as "light" | "dark") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") } catch { return "light" }
	})
	const setTheme = (t: "light" | "dark") => {
		set(t)
		document.documentElement.dataset.theme = t
		try { localStorage.setItem("pd-theme", t) } catch { /* private mode */ }
	}
	return [theme, setTheme]
}
