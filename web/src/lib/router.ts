import { useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { reduceMotion } from "./format"

export const VIEWS = ["overview", "showcase", "inbox", "queue", "firewall", "activity", "audit", "lab", "settings"] as const
export type View = (typeof VIEWS)[number]
export type Route = { view: View; id: string | null; sub: string | null }

export const TITLES: Record<View, string> = {
	overview: "Overview",
	showcase: "Interactive Showcase",
	inbox: "Payments",
	queue: "Review Queue",
	firewall: "Payment Firewall",
	activity: "Agent Activity",
	audit: "Evidence & Audit",
	lab: "Financial Stress Lab",
	settings: "Settings",
}

export const href = (view: View, id?: string | null, sub?: string | null) => `#/${view}${id ? `/${encodeURIComponent(id)}${sub ? `/${sub}` : ""}` : ""}`

function parse(hash: string): Route {
	const [, view, id, sub] = hash.replace(/^#/, "").split("/")
	return { view: (VIEWS as readonly string[]).includes(view ?? "") ? (view as View) : "overview", id: id ? decodeURIComponent(id) : null, sub: sub || null }
}

type Transition = { ready?: Promise<unknown>; finished?: Promise<unknown> }
type Doc = Document & { startViewTransition?: (update: () => void) => Transition }

/** Runs a state change inside a view transition where the browser has one and motion is welcome; otherwise just runs it. */
export function withTransition(update: () => void) {
	const doc = document as Doc
	if (!doc.startViewTransition || reduceMotion() || document.hidden || document.documentElement.dataset.input === "key") return update()
	// The update always runs. A transition the browser skips (a resize, a second one starting) rejects its promises; that is not an error here.
	const t = doc.startViewTransition(() => flushSync(update))
	t.ready?.catch(() => {})
	t.finished?.catch(() => {})
}

/** Hash routing: every view and every selected payment has a URL, with no router dependency. */
export function useRoute(): Route {
	const [route, setRoute] = useState<Route>(() => parse(location.hash))
	const view = useRef(route.view)
	useEffect(() => {
		const on = () => {
			const next = parse(location.hash)
			if (next.view === view.current) return setRoute(next)
			view.current = next.view
			// A new page cross-fades in from the top; a new selection inside a page changes in place.
			withTransition(() => { setRoute(next); scrollTo(0, 0) })
		}
		addEventListener("hashchange", on)
		return () => removeEventListener("hashchange", on)
	}, [])
	return route
}

export const go = (view: View, id?: string | null, replace = false) => {
	const h = href(view, id)
	if (replace) history.replaceState(null, "", h), dispatchEvent(new HashChangeEvent("hashchange"))
	else location.hash = h
}
