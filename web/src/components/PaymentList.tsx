import { useEffect, useMemo, useRef, useState } from "react"
import { MagnifyingGlass, Tray, Warning, XCircle } from "@phosphor-icons/react"
import type { PaymentCase } from "../lib/api"
import { flagged, isBlocking, isRunning, needsPerson, riskRank, titleOf } from "../lib/derive"
import { amount } from "../lib/format"
import { go, href, type View } from "../lib/router"
import { Money, StageStatus, controlShort } from "./bits"
import { Empty, Seg, type Option } from "./ui"

type Status = "all" | "pending" | "approved" | "blocked" | "other"
type Sort = "received" | "risk" | "amount" | "due" | "vendor"

const TEST: Record<Status, (c: PaymentCase) => boolean> = {
	all: () => true,
	pending: (c) => c.stage === "awaiting_approval",
	approved: (c) => c.stage === "approved",
	blocked: (c) => c.stage === "blocked",
	// everything that is neither waiting, approved nor blocked: still processing, rejected, not a payment, failed
	other: (c) => isRunning(c) || c.stage === "rejected" || c.stage === "not_a_payment" || c.stage === "error",
}
const LABEL: Record<Status, string> = { all: "All", pending: "Pending", approved: "Approved", blocked: "Blocked", other: "Other" }
const SORTS: { key: Sort; label: string }[] = [
	{ key: "received", label: "Received" },
	{ key: "risk", label: "Exceptions first" },
	{ key: "amount", label: "Amount" },
	{ key: "due", label: "Due date" },
	{ key: "vendor", label: "Vendor" },
]

function haystack(c: PaymentCase): string {
	const x = c.extraction.result
	return [titleOf(c), x?.creditorName, x?.invoiceNumber, x?.reference, x?.iban, x?.poReference, c.exposure ? amount(c.exposure.minor) : "", c.id, c.fileName, ...flagged(c).map(controlShort)].filter(Boolean).join(" ").toLowerCase()
}

/** One payment in a list: who, which invoice, how much, where it stands, and the one exception that matters most. */
export function PaymentRow({ c, view, current }: { c: PaymentCase; view: View; current?: boolean }) {
	const x = c.extraction.result
	const flags = flagged(c)
	const top = flags[0]
	return (
		<a className="row" href={href(view, c.id)} data-id={c.id} aria-current={current ? "true" : undefined}>
			<span className="row-main">
				<span className="name">{titleOf(c)}</span>
				<span className="sub"><span className="ref">{x?.invoiceNumber ?? c.id}</span></span>
			</span>
			<span className="row-side">
				<span className="amt">{c.exposure ? <Money value={c.exposure.minor} ccy={c.exposure.currency} /> : <span className="muted">no amount</span>}</span>
				{/* one signal per row: the exception that matters most while a person is needed, the status otherwise */}
				{top && needsPerson(c)
					? <span className={`why ${isBlocking(top) ? "tone-bad" : "tone-warn"}`} title={`${c.stage === "blocked" ? "Blocked" : "Needs approval"}. ${flags.map((k) => `${controlShort(k)}: ${k.detail}`).join(" ")}`}>{isBlocking(top) ? <XCircle size={12} weight="fill" /> : <Warning size={12} weight="fill" />}{controlShort(top)}<span className="sr-only">, {c.stage === "blocked" ? "blocked" : "needs approval"}</span></span>
					: <StageStatus stage={c.stage} />}
			</span>
		</a>
	)
}

/** The transaction list: search, status filter, sort, keyboard navigation. `queue` holds what needs a person: blocked and waiting. */
export function PaymentList({ cases, view, selected }: { cases: PaymentCase[]; view: "inbox" | "queue"; selected: string | null }) {
	const queue = view === "queue"
	const [q, setQ] = useState("")
	const [status, setStatus] = useState<Status>("all")
	const [sort, setSort] = useState<Sort>(queue ? "risk" : "received")
	const ref = useRef<HTMLDivElement>(null)

	const pool = useMemo(() => (queue ? cases.filter(needsPerson) : cases), [cases, queue])
	const shown = useMemo(() => {
		const needle = q.trim().toLowerCase()
		// An IBAN is shown in groups of four and stored without spaces: a search matches either way.
		const tight = needle.replace(/\s+/g, "")
		const hit = (c: PaymentCase) => { const h = haystack(c); return h.includes(needle) || (tight.length >= 4 && h.replace(/\s+/g, "").includes(tight)) }
		const list = pool.filter((c) => TEST[status](c) && (!needle || hit(c)))
		const amt = (c: PaymentCase) => c.exposure?.minor ?? -1
		const due = (c: PaymentCase) => c.extraction.result?.dueDate ?? "9999"
		const by: Record<Sort, (a: PaymentCase, b: PaymentCase) => number> = {
			received: (a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id),
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
	const keys: Status[] = queue ? ["all", "blocked", "pending"] : ["all", "pending", "approved", "blocked", "other"]
	const options: Option<Status>[] = keys.map((k) => ({ value: k, label: LABEL[k], disabled: k !== "all" && k !== status && !pool.some(TEST[k]) }))
	return (
		<div className="list-pane glass" ref={ref}>
			<div className="list-tools">
				<label className="search">
					<span className="sr-only">Search payments</span>
					<MagnifyingGlass size={15} />
					<input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, invoice, IBAN" spellCheck={false} />
				</label>
				<Seg value={status} onChange={setStatus} options={options} label="Filter by status" fill />
				<div className="list-meta">
					<span aria-live="polite">{shown.length === pool.length ? `${pool.length} payment${pool.length === 1 ? "" : "s"}` : `${shown.length} of ${pool.length}`}</span>
					<select className="select quiet" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
						{SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
					</select>
				</div>
			</div>
			<div className="list-scroll">
				{shown.length > 0 ? (
					<div className="rows" role="list" aria-label={queue ? "Payments that need a person" : "Payments"}>
						{shown.map((c) => <div role="listitem" key={c.id}><PaymentRow c={c} view={view} current={c.id === selected} /></div>)}
					</div>
				) : filtered ? (
					<Empty icon={<MagnifyingGlass size={18} />} title="No payments match" actions={<button className="btn" onClick={() => { setQ(""); setStatus("all") }}>Clear search and filter</button>}>
						Nothing in {queue ? "the review queue" : "the inbox"} matches {q.trim() ? <>“{q.trim()}”</> : "this filter"}{q.trim() && status !== "all" ? " with this status" : ""}.
					</Empty>
				) : queue ? (
					<Empty icon={<Tray size={18} />} title="Nothing is waiting for you" actions={cases.length > 0 ? <a className="btn" href={href("inbox")}>Open payments</a> : undefined}>
						{cases.length ? "Every payment is approved, rejected or still with the agents." : "Run the demo and payments that are blocked or need approval queue up here, the most serious first."}
					</Empty>
				) : (
					<Empty icon={<Tray size={18} />} title="No payments yet">Run the demo from the top bar, or add a document of your own.</Empty>
				)}
			</div>
		</div>
	)
}
