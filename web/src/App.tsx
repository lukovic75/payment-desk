import { useCallback, useEffect, useState } from "react"
import { ArrowsClockwise, WarningCircle } from "@phosphor-icons/react"
import { startRun, useDesk } from "./lib/api"
import { isRunning } from "./lib/derive"
import { go, TITLES, useRoute } from "./lib/router"
import { AddDocument } from "./components/AddDocument"
import { Shell } from "./components/Shell"
import { Activity } from "./views/Activity"
import { Audit } from "./views/Audit"
import { Overview } from "./views/Overview"
import { Payments } from "./views/Payments"
import { Settings } from "./views/Settings"

export type ThemeMode = "system" | "light" | "dark"

export function App() {
	const { snapshot, tokens, link, health } = useDesk()
	const route = useRoute()
	const [mode, setMode, theme] = useTheme()
	const [collapsed, setCollapsed] = usePersisted("pd-nav", false)
	const [adding, setAdding] = useState(false)
	const [starting, setStarting] = useState(false)
	const [runErr, setRunErr] = useState<string | null>(null)
	useInputMode()

	useEffect(() => { document.title = `${TITLES[route.view]} · Payment Desk` }, [route.view])

	const cases = snapshot?.cases ?? []
	const running = cases.some(isRunning)
	const noKey = health != null && !health.hasModelKey
	const canAct = link.state === "live" && snapshot != null && !noKey

	const run = useCallback(async () => {
		if (starting) return
		setStarting(true); setRunErr(null)
		try { await startRun(); if (route.view === "inbox" || route.view === "queue") go(route.view, null, true) }
		catch (e) { setRunErr((e as Error).message) }
		finally { setStarting(false) }
	}, [starting, route.view])

	return (
		<>
			<Shell
				view={route.view} snapshot={snapshot} link={link}
				counts={{ inbox: cases.length, queue: cases.filter((c) => c.stage === "awaiting_approval").length, settled: cases.filter((c) => !isRunning(c)).length, running }}
				collapsed={collapsed} onToggleNav={() => setCollapsed(!collapsed)}
				theme={theme} onToggleTheme={() => setMode(theme === "dark" ? "light" : "dark")}
				canAct={canAct} starting={starting} onRun={run} onAdd={() => setAdding(true)}
			>
				<div style={{ minWidth: 0, display: "grid", alignContent: "start" }}>
					{(link.state === "reconnecting" || noKey || runErr) && (
						<div style={{ display: "grid", gap: 8, padding: "12px 20px 0" }}>
							{link.state === "reconnecting" && (
								<div className="banner bad" role="alert">
									<WarningCircle size={16} weight="bold" />
									<div><b>Lost the connection to the desk server.</b> Retrying (attempt {link.attempts}). What you see is the last state received; actions are paused. Check that <code>npm run dev</code> is still running.</div>
									<button className="btn btn-sm" onClick={() => location.reload()}><ArrowsClockwise size={13} /> Reload</button>
								</div>
							)}
							{noKey && link.state === "live" && (
								<div className="banner bad" role="alert">
									<WarningCircle size={16} weight="bold" />
									<div><b>No model API key on the server</b>, so the agents cannot run. Copy <code>.env.example</code> to <code>.env</code>, set <code>ANTHROPIC_API_KEY</code>, and restart <code>npm run dev</code>.</div>
								</div>
							)}
							{runErr && (
								<div className="banner bad" role="alert">
									<WarningCircle size={16} weight="bold" />
									<div><b>The inbox could not be processed.</b> {runErr}</div>
									<button className="btn btn-sm" onClick={() => setRunErr(null)}>Dismiss</button>
								</div>
							)}
						</div>
					)}
					{snapshot == null ? <Loading failed={link.state === "reconnecting"} /> : (
						<>
							{route.view === "overview" && <Overview snapshot={snapshot} tokens={tokens} canAct={canAct} starting={starting} onRun={run} onAdd={() => setAdding(true)} />}
							{(route.view === "inbox" || route.view === "queue") && <Payments snapshot={snapshot} view={route.view} id={route.id} />}
							{route.view === "activity" && <Activity snapshot={snapshot} tokens={tokens} id={route.id} />}
							{route.view === "audit" && <Audit snapshot={snapshot} />}
							{route.view === "settings" && <Settings snapshot={snapshot} health={health} link={link} mode={mode} onMode={setMode} />}
						</>
					)}
				</div>
			</Shell>
			<AddDocument open={adding} onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); go("inbox", id) }} />
		</>
	)
}

/** First paint before the server has answered: the shape of the overview, not a spinner. */
function Loading({ failed }: { failed: boolean }) {
	return (
		<main className="view" aria-busy="true" aria-label="Loading the desk">
			<div className="kpis">{Array.from({ length: 6 }, (_, i) => <div className="kpi" key={i}><div className="skel" style={{ height: 11, width: "55%" }} /><div className="skel" style={{ height: 22, width: "40%", marginTop: 6 }} /><div className="skel" style={{ height: 11, width: "70%", marginTop: 6 }} /></div>)}</div>
			<div className="panel"><div className="panel-body" style={{ display: "grid", gap: 10 }}><div className="skel" style={{ height: 14, width: "30%" }} /><div className="skel" style={{ height: 120 }} /></div></div>
			{failed && <p className="muted">Still trying to reach the desk server on this machine.</p>}
		</main>
	)
}

function usePersisted(key: string, initial: boolean): [boolean, (v: boolean) => void] {
	const [v, set] = useState(() => { try { return (localStorage.getItem(key) ?? String(initial)) === "true" } catch { return initial } })
	return [v, (n) => { set(n); try { localStorage.setItem(key, String(n)) } catch { /* private mode: keep in memory */ } }]
}

function useTheme(): [ThemeMode, (m: ThemeMode) => void, "light" | "dark"] {
	const [mode, set] = useState<ThemeMode>(() => { try { return (localStorage.getItem("pd-theme") as ThemeMode) || "system" } catch { return "system" } })
	const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches)
	useEffect(() => {
		const mq = matchMedia("(prefers-color-scheme: dark)")
		const on = () => setSystemDark(mq.matches)
		mq.addEventListener("change", on)
		return () => mq.removeEventListener("change", on)
	}, [])
	useEffect(() => {
		if (mode === "system") delete document.documentElement.dataset.theme
		else document.documentElement.dataset.theme = mode
		try { mode === "system" ? localStorage.removeItem("pd-theme") : localStorage.setItem("pd-theme", mode) } catch { /* private mode */ }
	}, [mode])
	return [mode, set, mode === "system" ? (systemDark ? "dark" : "light") : mode]
}

/** Keyboard-driven changes skip entrance motion, and nothing animates while the tab is hidden. */
function useInputMode() {
	useEffect(() => {
		const root = document.documentElement
		const key = (e: KeyboardEvent) => { if (!e.metaKey && !e.ctrlKey && !e.altKey) root.dataset.input = "key" }
		const pointer = () => { root.dataset.input = "pointer" }
		const vis = () => { document.hidden ? (root.dataset.hidden = "") : delete root.dataset.hidden }
		addEventListener("keydown", key, true)
		addEventListener("pointerdown", pointer, true)
		document.addEventListener("visibilitychange", vis)
		vis()
		return () => { removeEventListener("keydown", key, true); removeEventListener("pointerdown", pointer, true); document.removeEventListener("visibilitychange", vis) }
	}, [])
}
