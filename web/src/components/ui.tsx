import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { X } from "@phosphor-icons/react"
import { moneyParts } from "../lib/format"

/**
 * One indicator that moves to the active child, so a selection travels instead of blinking from place to place.
 * The container must be the indicator's offset parent. It is placed before first paint and only animates afterwards.
 */
export function useIndicator<B extends HTMLElement>(active: unknown, selector: string, axis: "x" | "y" = "x") {
	const box = useRef<B>(null)
	const ind = useRef<HTMLSpanElement>(null)
	useLayoutEffect(() => {
		const b = box.current, i = ind.current
		if (!b || !i) return
		const place = () => {
			const el = b.querySelector<HTMLElement>(selector)
			if (!el || el.offsetWidth === 0) { delete i.dataset.on; return }
			if (axis === "x") { i.style.setProperty("--x", `${el.offsetLeft}px`); i.style.setProperty("--w", `${el.offsetWidth}px`) }
			else { i.style.setProperty("--y", `${el.offsetTop}px`); i.style.setProperty("--h", `${el.offsetHeight}px`) }
			i.dataset.on = ""
		}
		place()
		const raf = requestAnimationFrame(() => { i.dataset.ready = "" })
		const ro = new ResizeObserver(place)
		ro.observe(b)
		return () => { cancelAnimationFrame(raf); ro.disconnect() }
	}, [active, selector, axis])
	return [box, ind] as const
}

export type Option<T extends string> = { value: T; label: ReactNode; count?: number; disabled?: boolean }

export function Seg<T extends string>({ value, onChange, options, label, fill }: { value: T; onChange: (v: T) => void; options: Option<T>[]; label: string; fill?: boolean }) {
	const [box, ind] = useIndicator<HTMLDivElement>(`${value}:${options.map((o) => o.count ?? "").join()}`, 'button[aria-pressed="true"]')
	return (
		<div className={`seg${fill ? " fill" : ""}`} role="group" aria-label={label} ref={box}>
			<span className="ind" ref={ind} aria-hidden />
			{options.map((o) => (
				<button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>{o.label}{o.count != null && <small>{o.count}</small>}</button>
			))}
		</div>
	)
}

export function Tabs<T extends string>({ value, onChange, tabs, label }: { value: T; onChange: (v: T) => void; tabs: (Option<T> & { attn?: boolean })[]; label: string }) {
	const [box, ind] = useIndicator<HTMLDivElement>(`${value}:${tabs.map((o) => o.count ?? "").join()}`, 'button[aria-selected="true"]')
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
		const i = tabs.findIndex((t) => t.value === value)
		const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!
		e.preventDefault()
		onChange(next.value)
		requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
	}
	return (
		<div className="tabs" role="tablist" aria-label={label} ref={box} onKeyDown={onKey}>
			{tabs.map((t) => (
				<button key={t.value} type="button" role="tab" aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1} onClick={() => onChange(t.value)}>{t.label}{t.count != null && t.count > 0 && <small className={t.attn ? "attn" : ""}>{t.count}</small>}</button>
			))}
			<span className="ind" ref={ind} aria-hidden />
		</div>
	)
}

/**
 * A floating panel beside the work, not over it: no scrim on a wide screen, so the page stays readable while a
 * source or an agent is inspected. It leaves the way it came, and can be reopened mid-close without a jump.
 */
export function Drawer({ open, onClose, title, kicker, label, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; kicker?: ReactNode; label: string; children: ReactNode; wide?: boolean }) {
	const ref = useRef<HTMLElement>(null)
	const close = useRef(onClose)
	close.current = onClose
	const last = useRef<{ title: ReactNode; kicker?: ReactNode; children: ReactNode } | null>(null)
	if (open) last.current = { title, kicker, children }
	const shown = last.current

	useEffect(() => {
		if (!open) return
		const before = document.activeElement as HTMLElement | null
		const byKey = document.documentElement.dataset.input === "key"
		const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close.current() } }
		const onDown = (e: PointerEvent) => {
			const t = e.target as HTMLElement
			if (ref.current?.contains(t) || t.closest?.("[data-drawer-keep]")) return
			close.current()
		}
		document.addEventListener("keydown", onKey)
		document.addEventListener("pointerdown", onDown)
		if (byKey) ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true })
		return () => {
			document.removeEventListener("keydown", onKey)
			document.removeEventListener("pointerdown", onDown)
			if (byKey && before?.isConnected) before.focus({ preventScroll: true })
		}
	}, [open])

	return createPortal(
		<>
			<div className="drawer-scrim" data-open={open} aria-hidden />
			<aside className="drawer" ref={ref} data-open={open} data-wide={wide ? "" : undefined} inert={!open} aria-label={label}>
				<div className="drawer-head">
					<h2 className="grow">{shown?.kicker && <span className="kicker">{shown.kicker}</span>}{shown?.title}</h2>
					<button type="button" className="btn btn-ghost btn-icon btn-round" aria-label="Close" data-autofocus onClick={() => close.current()}><X size={16} /></button>
				</div>
				<div className="drawer-body">{shown?.children}</div>
			</aside>
		</>,
		document.body,
	)
}

export function PageHead({ title, sub, kicker, children }: { title: string; sub?: ReactNode; kicker?: string; children?: ReactNode }) {
	return (
		<header className="page-head">
			<div className="grow">{kicker && <span className="page-kicker">{kicker}</span>}<h1>{title}</h1>{sub && <p>{sub}</p>}</div>
			{children && <div className="page-actions">{children}</div>}
		</header>
	)
}

/** A financial figure set as type: the symbol and the cents step back so the whole units read first. */
export function Figure({ minor, ccy }: { minor: number | null | undefined; ccy?: string | null }) {
	if (minor == null) return <span className="fig none">Unavailable</span>
	const p = moneyParts(minor, ccy)
	return <span className="fig">{p.symbol && <span className="sym">{p.symbol}</span>}{p.int}<span className="dec">.{p.dec}</span>{!p.symbol && p.code && <span className="code">{p.code}</span>}</span>
}

export function Empty({ icon, title, children, actions, center }: { icon?: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; center?: boolean }) {
	return (
		<div className={`empty${center ? " center" : ""}`}>
			{icon && <span className="ico" aria-hidden>{icon}</span>}
			<h2>{title}</h2>
			{children && <p>{children}</p>}
			{actions && <div className="actions">{actions}</div>}
		</div>
	)
}

/** Long agent prose starts short. The whole text is one press away and never cut for good. */
export function Clamp({ text, className = "say" }: { text: string; className?: string }) {
	const [open, setOpen] = useState(false)
	if (text.length < 240) return <p className={className}>{text}</p>
	return (
		<p className={className}>
			<span className={open ? undefined : "clamp"}>{text}</span>{" "}
			<button type="button" className="more-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</button>
		</p>
	)
}

/** Raw technical text (a provider error, a long trigger) is cut to its start; the rest is there on request, never dropped. */
export function Long({ text, max = 150 }: { text: string; max?: number }) {
	const [open, setOpen] = useState(false)
	if (text.length <= max + 20) return <>{text}</>
	return <>{open ? text : `${text.slice(0, max).trimEnd()}…`} <button type="button" className="more-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</button></>
}
