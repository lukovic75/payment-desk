import { useEffect, useMemo, useRef, useState } from "react"
import { MagnifyingGlass } from "@phosphor-icons/react"
import type { PaymentCase } from "../lib/api"
import { exceptionsOf, isRunning, riskRank, titleOf } from "../lib/derive"
import { dueLabel } from "../lib/format"
import { go, href, type View } from "../lib/router"
import { ExceptionTags, Money, StageTag } from "./bits"

type Status = "all" | "awaiting_approval" | "approved" | "rejected" | "processing" | "not_a_payment" | "error"
type Sort = "received" | "risk" | "amount" | "due" | "vendor"

const STATUS: { key: Status; label: string; test: (c: PaymentCase) => boolean }[] = [
	{ key: "all", label: "All statuses", test: () => true },
	{ key: "awaiting_approval", label: "Needs approval", test: (c) => c.stage === "awaiting_approval" },
	{ key: "approved", label: "Approved", test: (c) => c.stage === "approved" },
	{ key: "rejected", label: "Rejected", test: (c) => c.stage === "rejected" },
	{ key: "processing", label: "Processing", test: isRunning },
	{ key: "not_a_payment", label: "Not a payment", test: (c) => c.stage === "not_a_payment" },
	{ key: "error", label: "Failed", test: (c) => c.stage === "error" },
]
const SORTS: { key: Sort; label: string }[] = [
	{ key: "received", label: "Received" },
	{ key: "risk", label: "Exceptions first" },
	{ key: "amount", label: "Amount, high to low" },
	{ key: "due", label: "Due date" },
	{ key: "vendor", label: "Vendor A to Z" },
]

function haystack(c: PaymentCase): string {
	const x = c.extraction.result
	return [titleOf(c), x?.creditorName, x?.invoiceNumber, x?.reference, x?.iban, x?.amount?.toFixed(2), c.id, c.fileName, ...exceptionsOf(c).map((e) => e.label)].filter(Boolean).join(" ").toLowerCase()
}

export function PaymentRow({ c, view, current }: { c: PaymentCase; view: View; current?: boolean }) {
	const x = c.extraction.result
	const ex = exceptionsOf(c)
	const due = x?.isPaymentRequest ? dueLabel(x.dueDate) : null
	return (
		<a className="row" href={href(view, c.id)} data-id={c.id} aria-current={current ? "true" : undefined}>
			<span className="name">{titleOf(c)}</span>
			<span className="amt"><Money value={x?.amount} ccy={x?.currency} /></span>
			<span className="meta">
				<StageTag stage={c.stage} />
				<ExceptionTags list={ex} max={1} />
				<span className="ref">{x?.invoiceNumber ?? c.id}</span>
				{due && <span className={`due${due.overdue ? " over" : ""}`}>{due.text}</span>}
			</span>
		</a>
	)
}

/** The transaction list: search, status filter, sort, keyboard navigation. `queue` locks the filter to what needs a person. */
export function PaymentList({ cases, view, selected }: { cases: PaymentCase[]; view: "inbox" | "queue"; selected: string | null }) {
	const queue = view === "queue"
	const [q, setQ] = useState("")
	const [status, setStatus] = useState<Status>("all")
	const [sort, setSort] = useState<Sort>(queue ? "risk" : "received")
	const ref = useRef<HTMLDivElement>(null)

	const pool = useMemo(() => (queue ? cases.filter((c) => c.stage === "awaiting_approval") : cases), [cases, queue])
	const shown = useMemo(() => {
		const needle = q.trim().toLowerCase()
		const test = STATUS.find((s) => s.key === status)!.test
		const list = pool.filter((c) => test(c) && (!needle || haystack(c).includes(needle)))
		const amt = (c: PaymentCase) => c.extraction.result?.amount ?? -1
		const due = (c: PaymentCase) => c.extraction.result?.dueDate ?? "9999"
		const by: Record<Sort, (a: PaymentCase, b: PaymentCase) => number> = {
			received: (a, b) => a.receivedAt.localeCompare(b.receivedAt),
			risk: (a, b) => riskRank(b) - riskRank(a) || amt(b) - amt(a),
			amount: (a, b) => amt(b) - amt(a),
			due: (a, b) => due(a).localeCompare(due(b)),
			vendor: (a, b) => titleOf(a).localeCompare(titleOf(b)),
		}
		return [...list].sort(by[sort])
	}, [pool, q, status, sort])

	// ↑ / ↓ move through the visible rows; the URL follows so the workspace updates.
	useEffect(() => {
		const el = ref.current
		if (!el) return
		const onKey = (e: KeyboardEvent) => {
			if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || shown.length === 0) return
			if ((e.target as HTMLElement).closest("input, select, textarea")) return
			e.preventDefault()
			const i = shown.findIndex((c) => c.id === selected)
			const next = shown[Math.max(0, Math.min(shown.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]!
			go(view, next.id, true)
			el.querySelector<HTMLAnchorElement>(`[data-id="${CSS.escape(next.id)}"]`)?.focus()
		}
		el.addEventListener("keydown", onKey)
		return () => el.removeEventListener("keydown", onKey)
	}, [shown, selected, view])

	const filtered = q.trim() !== "" || status !== "all"
	return (
		<div className="list-pane" ref={ref}>
			<div className="list-tools">
				<label className="search">
					<span className="sr-only">Search payments</span>
					<MagnifyingGlass size={14} />
					<input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vendor, invoice, IBAN, amount" spellCheck={false} />
				</label>
				<div className="filters">
					{!queue && (
						<select className="select" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
							{STATUS.map((s) => <option key={s.key} value={s.key}>{s.label} ({pool.filter(s.test).length})</option>)}
						</select>
					)}
					<select className="select" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
						{SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
					</select>
					<span className="n" aria-live="polite">{shown.length}/{pool.length}</span>
				</div>
			</div>
			<div className="list-scroll">
				{shown.length > 0 ? (
					<div className="rows" role="list" aria-label={queue ? "Payments waiting for approval" : "Payments"}>
						{shown.map((c) => <div role="listitem" key={c.id}><PaymentRow c={c} view={view} current={c.id === selected} /></div>)}
					</div>
				) : filtered ? (
					<div className="empty">
						<h2>No payments match</h2>
						<p>Nothing in {queue ? "the review queue" : "the inbox"} matches {q.trim() ? <>“{q.trim()}”</> : "this filter"}{q.trim() && status !== "all" ? " with this status" : ""}.</p>
						<div className="actions"><button className="btn" onClick={() => { setQ(""); setStatus("all") }}>Clear search and filters</button></div>
					</div>
				) : queue ? (
					<div className="empty">
						<h2>Nothing is waiting for you</h2>
						<p>{cases.length ? "Every payment is either approved, rejected or still with the agents." : "Process the inbox and payments that need a person will queue up here, exceptions first."}</p>
						{cases.length > 0 && <div className="actions"><a className="btn" href={href("inbox")}>Open the inbox</a></div>}
					</div>
				) : (
					<div className="empty">
						<h2>The inbox has not been processed</h2>
						<p>Press <b>Process inbox</b> in the top bar, or add a document of your own.</p>
					</div>
				)}
			</div>
		</div>
	)
}
