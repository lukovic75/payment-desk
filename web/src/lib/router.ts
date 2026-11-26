import { useEffect, useState } from "react"

export const VIEWS = ["overview", "inbox", "queue", "activity", "audit", "settings"] as const
export type View = (typeof VIEWS)[number]
export type Route = { view: View; id: string | null }

export const TITLES: Record<View, string> = {
	overview: "Overview",
	inbox: "Payment inbox",
	queue: "Review queue",
	activity: "Agent activity",
	audit: "Audit trail",
	settings: "Settings",
}

export const href = (view: View, id?: string | null) => `#/${view}${id ? `/${encodeURIComponent(id)}` : ""}`

function parse(hash: string): Route {
	const [, view, id] = hash.replace(/^#/, "").split("/")
	return { view: (VIEWS as readonly string[]).includes(view ?? "") ? (view as View) : "overview", id: id ? decodeURIComponent(id) : null }
}

/** Hash routing: every view and every selected payment has a URL, with no router dependency. */
export function useRoute(): Route {
	const [route, setRoute] = useState<Route>(() => parse(location.hash))
	useEffect(() => {
		const on = () => setRoute(parse(location.hash))
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
