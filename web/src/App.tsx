import { useCallback, useEffect, useState } from "react"
import { ArrowsClockwise, WarningCircle } from "@phosphor-icons/react"
import { runDemo, useDesk } from "./lib/api"
import { isRunning, needsPerson } from "./lib/derive"
import { reduceMotion } from "./lib/format"
import { go, TITLES, useRoute, withTransition } from "./lib/router"
import { AddDocument } from "./components/AddDocument"
import { Shell } from "./components/Shell"
import { Activity } from "./views/Activity"
import { Audit } from "./views/Audit"
import { Firewall } from "./views/Firewall"
import { Lab } from "./views/Lab"
import { Overview } from "./views/Overview"
import { Payments } from "./views/Payments"
import { Settings } from "./views/Settings"
import { Showcase } from "./views/Showcase"

export type ThemeMode = "system" | "light" | "dark"

export function App() {
	const { snapshot, link, health } = useDesk()
	const route = useRoute()
	const [mode, setMode, theme] = useTheme()
	const [collapsed, setCollapsed] = usePersisted("pd-nav", false)
	const [still, setStill] = usePersisted("pd-ambient-still", false)
	const [adding, setAdding] = useState(false)
	const [starting, setStarting] = useState(false)
	const [runErr, setRunErr] = useState<string | null>(null)
	useInputMode()
	useChrome()
	useEffect(() => { still ? (document.documentElement.dataset.ambient = "still") : delete document.documentElement.dataset.ambient }, [still])

	useEffect(() => { document.title = `${TITLES[route.view]} · Payment Desk` }, [route.view])

	const cases = snapshot?.cases ?? []
	const running = cases.some(isRunning)
	const noKey = health != null && !health.hasModelKey
	const canAct = link.state === "live" && snapshot != null && !noKey

	const run = useCallback(async () => {
		if (starting) return
		setStarting(true); setRunErr(null)
		try { await runDemo(); if (route.view === "inbox" || route.view === "queue") go(route.view, null, true); if (route.view === "showcase") go("inbox") }
		catch (e) { setRunErr((e as Error).message) }
		finally { setStarting(false) }
	}, [starting, route.view])

	return (
		<>
			<div className="ambient" aria-hidden><i className="a" /><i className="b" /><i className="c" /></div>
			<Shell
				view={route.view} snapshot={snapshot} link={link}
				counts={{ inbox: cases.length, queue: cases.filter(needsPerson).length, settled: cases.filter((c) => !isRunning(c)).length, running }}
				collapsed={collapsed} onToggleNav={() => setCollapsed(!collapsed)}
				theme={theme} onToggleTheme={() => setMode(theme === "dark" ? "light" : "dark")}
				canAct={canAct} onAdd={() => setAdding(true)}
			>
				<div className="page">
					{((snapshot?.modelMode === "scripted" && route.view !== "showcase") || snapshot?.provider || link.state === "reconnecting" || noKey || runErr) && (
						<div className="banners">
							{/* The showcase states its mode in its own header, on every screen of it, so the banner is not repeated there. */}
							{snapshot?.modelMode === "scripted" && route.view !== "showcase" && (
								<div className="banner warn" role="status"><WarningCircle size={16} weight="bold" /><div><b>Scripted demo: real orchestration, predefined model responses.</b> The Mozaik runtime, the agent loops, the controls and the timings are real. The agents' answers are fixed text, not live AI.</div></div>
							)}
							{snapshot?.provider && (
								<div className="banner bad" role="alert">
									<WarningCircle size={16} weight="bold" />
									<div><b>The model provider is refusing calls: {snapshot.provider.kind.replace(/_/g, " ")}.</b> {snapshot.provider.advice} Agents are paused so that no further request is spent; everything already decided is kept.</div>
								</div>
							)}
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
									<div><b>The demo scenarios could not be started.</b> {runErr}</div>
									<button className="btn btn-sm" onClick={() => setRunErr(null)}>Dismiss</button>
								</div>
							)}
						</div>
					)}
					{snapshot == null ? <Loading failed={link.state === "reconnecting"} /> : (
						<div className="page page-enter" key={route.view === "queue" ? "inbox" : route.view}>
							{route.view === "showcase" && <Showcase snapshot={snapshot} health={health} canAct={canAct} id={route.id} loadingAll={starting} onLoadAll={run} />}
							{route.view === "overview" && <Overview snapshot={snapshot} canAct={canAct} starting={starting} onRun={run} onAdd={() => setAdding(true)} />}
							{(route.view === "inbox" || route.view === "queue") && <Payments snapshot={snapshot} view={route.view} id={route.id} />}
							{route.view === "firewall" && <Firewall snapshot={snapshot} id={route.id} />}
							{route.view === "activity" && <Activity snapshot={snapshot} id={route.id} sub={route.sub} />}
							{route.view === "lab" && <Lab id={route.id} />}
							{route.view === "audit" && <Audit snapshot={snapshot} id={route.id} />}
							{route.view === "settings" && <Settings snapshot={snapshot} health={health} link={link} mode={mode} onMode={setMode} still={still} onStill={setStill} />}
						</div>
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
			<div style={{ display: "grid", gap: 10 }}><div className="skel" style={{ height: 30, width: 180 }} /><div className="skel" style={{ height: 14, width: 320, maxWidth: "80%" }} /></div>
			<div className="metrics">{Array.from({ length: 4 }, (_, i) => <div className="metric glass" key={i}><div className="skel" style={{ height: 12, width: "50%" }} /><div className="skel" style={{ height: 34, width: "70%", marginTop: 10 }} /><div className="skel" style={{ height: 12, width: "60%", marginTop: 10 }} /></div>)}</div>
			<div className="panel"><div className="panel-body" style={{ display: "grid", gap: 12 }}><div className="skel" style={{ height: 14, width: "30%" }} /><div className="skel" style={{ height: 120 }} /></div></div>
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
	// The attribute is written inside the transition, so the old and the new appearance cross-fade instead of snapping.
	const change = (m: ThemeMode) => withTransition(() => {
		if (m === "system") delete document.documentElement.dataset.theme
		else document.documentElement.dataset.theme = m
		set(m)
	})
	return [mode, change, mode === "system" ? (systemDark ? "dark" : "light") : mode]
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

/** Two things the chrome reacts to without re-rendering React: how far the page has scrolled, and where the pointer is on a glass surface. */
function useChrome() {
	useEffect(() => {
		const root = document.documentElement
		const onScroll = () => {
			scrollY > 4 ? (root.dataset.scrolled = "") : delete root.dataset.scrolled
			scrollY > 64 ? (root.dataset.titled = "") : delete root.dataset.titled
		}
		onScroll()
		addEventListener("scroll", onScroll, { passive: true })
		let raf = 0
		let last: PointerEvent | null = null
		const paint = () => {
			raf = 0
			const el = (last?.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-glow]")
			if (!el || !last) return
			const r = el.getBoundingClientRect()
			el.style.setProperty("--mx", `${last.clientX - r.left}px`)
			el.style.setProperty("--my", `${last.clientY - r.top}px`)
		}
		const onMove = (e: PointerEvent) => { last = e; if (!raf) raf = requestAnimationFrame(paint) }
		const fine = matchMedia("(hover: hover) and (pointer: fine)").matches && !reduceMotion()
		if (fine) document.addEventListener("pointermove", onMove, { passive: true })
		return () => { removeEventListener("scroll", onScroll); document.removeEventListener("pointermove", onMove); cancelAnimationFrame(raf) }
	}, [])
}
