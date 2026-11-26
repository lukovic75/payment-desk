import { useEffect } from "react"
import type { DeskSnapshot, PaymentCase } from "../lib/api"
import { riskRank } from "../lib/derive"
import { go } from "../lib/router"
import { PaymentDetail } from "../components/PaymentDetail"
import { PaymentList } from "../components/PaymentList"

/** Inbox and review queue share one workspace: the list on the left, the selected payment on the right. */
export function Payments({ snapshot, view, id }: { snapshot: DeskSnapshot; view: "inbox" | "queue"; id: string | null }) {
	const { cases } = snapshot
	const current = id ? cases.find((c) => c.id === id) ?? null : null
	const wide = () => window.innerWidth >= 900

	// On a wide screen the queue opens its most urgent payment, so the workspace is never empty when there is work.
	useEffect(() => {
		if (id || view !== "queue" || !wide()) return
		const first = cases.filter((c) => c.stage === "awaiting_approval").sort((a, b) => riskRank(b) - riskRank(a))[0]
		if (first) go("queue", first.id, true)
	}, [id, view, cases])

	// After a decision in the queue, move on to the next payment that needs one.
	const onDecided = (done: PaymentCase) => {
		if (view !== "queue") return
		const next = cases.filter((c) => c.stage === "awaiting_approval" && c.id !== done.id).sort((a, b) => riskRank(b) - riskRank(a))[0]
		go("queue", next?.id ?? done.id, true)
	}

	return (
		<main className="view split">
			<div className="split-wrap" data-show={current ? "detail" : "list"}>
				<PaymentList key={view} cases={cases} view={view} selected={id} />
				<div className="detail-pane">
					{current ? (
						<PaymentDetail c={current} snapshot={snapshot} view={view} onDecided={onDecided} />
					) : id ? (
						<div className="empty"><h2>That payment is not in the inbox</h2><p>“{id}” is not a document in this run. It may be from before the inbox was processed again.</p></div>
					) : (
						<div className="empty">
							<h2>{view === "queue" ? "Select a payment to review" : "Select a payment"}</h2>
							<p>The workspace shows what the desk decided and why, each agent's work, and the original document side by side. Use ↑ and ↓ to move through the list.</p>
						</div>
					)}
				</div>
			</div>
		</main>
	)
}
