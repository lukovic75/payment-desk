import { useEffect, useRef } from "react"
import { Warning } from "@phosphor-icons/react"
import { isRunning, money, type PaymentCase } from "./api"
import { StageChip } from "./StageChip"

type Group = { key: string; label: string; cases: PaymentCase[] }

export function groupCases(cases: PaymentCase[]): Group[] {
	const by = (pred: (c: PaymentCase) => boolean) => cases.filter(pred)
	return [
		{ key: "running", label: "Processing", cases: by(isRunning) },
		{ key: "awaiting", label: "Needs approval", cases: by((c) => c.stage === "awaiting_approval") },
		{ key: "approved", label: "Approved", cases: by((c) => c.stage === "approved") },
		{ key: "rejected", label: "Rejected", cases: by((c) => c.stage === "rejected") },
		{ key: "error", label: "Failed", cases: by((c) => c.stage === "error") },
		{ key: "other", label: "Not a payment", cases: by((c) => c.stage === "not_a_payment") },
	].filter((g) => g.cases.length > 0)
}

export function CaseList({ cases, selected, onSelect }: { cases: PaymentCase[]; selected: string | null; onSelect: (id: string) => void }) {
	const groups = groupCases(cases)
	const order = groups.flatMap((g) => g.cases.map((c) => c.id))
	const ref = useRef<HTMLDivElement>(null)

	// ↑ / ↓ move through the list in display order; the focused row is selected.
	useEffect(() => {
		const el = ref.current
		if (!el) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
			const i = order.indexOf(selected ?? "")
			const next = order[(i + (e.key === "ArrowDown" ? 1 : -1) + order.length) % order.length]
			if (!next) return
			e.preventDefault()
			onSelect(next)
			el.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(next)}"]`)?.focus()
		}
		el.addEventListener("keydown", onKey)
		return () => el.removeEventListener("keydown", onKey)
	}, [order.join("|"), selected, onSelect])

	return (
		<div className="groups" ref={ref} role="listbox" aria-label="Cases">
			{groups.map((g) => (
				<div key={g.key} role="group" aria-label={g.label}>
					<div className="group-h">{g.label} <span className="n">{g.cases.length}</span></div>
					{g.cases.map((c) => {
						const x = c.extraction.result
						const title = c.validation.result?.vendorName ?? x?.creditorName ?? (x ? capitalize(x.documentKind) : c.id)
						const flag = c.validation.result?.issues.some((i) => i.code === "iban_differs_from_master" || i.code === "iban_invalid")
						return (
							<button key={c.id} data-id={c.id} role="option" aria-selected={selected === c.id} className="case-row" aria-current={selected === c.id ? "true" : undefined} onClick={() => onSelect(c.id)}>
								<span className="title">{title}</span>
								<span className="amount">{x?.amount != null ? money(x.amount, x.currency) : ""}</span>
								<span className="sub">
									<StageChip stage={c.stage} />
									{flag && <span className="flag" title="Bank details differ from the vendor master"><Warning size={12} weight="bold" /></span>}
									<span className="file">{x ? c.fileName : `received ${new Date(c.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span>
								</span>
							</button>
						)
					})}
				</div>
			))}
		</div>
	)
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
