import { useEffect } from "react"
import { Receipt } from "@phosphor-icons/react"
import type { DeskSnapshot, PaymentCase } from "../lib/api"
import { needsPerson, riskRank } from "../lib/derive"
import { go } from "../lib/router"
import { PaymentDetail } from "../components/PaymentDetail"
import { PaymentList } from "../components/PaymentList"
import { Empty } from "../components/ui"

/** Payments and the review queue share one workspace: the list on the left, the selected payment on the right. */
export function Payments({ snapshot, view, id }: { snapshot: DeskSnapshot; view: "inbox" | "queue"; id: string | null }) {
	const { cases } = snapshot
	const current = id ? cases.find((c) => c.id === id) ?? null : null
	const waiting = (skip?: string) => cases.filter((c) => needsPerson(c) && c.id !== skip).sort((a, b) => riskRank(b) - riskRank(a))

	// On a wide screen the queue opens its most serious payment, so the workspace is never empty when there is work.
	useEffect(() => {
		if (id || view !== "queue" || window.innerWidth < 900) return
		const first = waiting()[0]
		if (first) go("queue", first.id, true)
	}, [id, view, cases])

	// After a decision in the queue, move on to the next payment that needs one.
	const onDecided = (done: PaymentCase) => {
		if (view !== "queue") return
		go("queue", waiting(done.id)[0]?.id ?? done.id, true)
	}

	return (
		<main className="view split">
			<div className="split-wrap" data-show={current ? "detail" : "list"}>
				<PaymentList key={view} cases={cases} view={view} selected={id} />
				<div className="detail-pane">
					{current ? (
						<PaymentDetail c={current} snapshot={snapshot} view={view} onDecided={onDecided} />
					) : id ? (
						<Empty title="That payment is not on the desk" center>“{id}” is not a document in this run. It may be from before the demo was run again.</Empty>
					) : (
						<Empty icon={<Receipt size={18} />} title={view === "queue" ? "Select a payment to review" : "Select a payment"} center>
							You will see what it is, whether it is safe and what you can do. Verification, evidence and agent activity are one tab away. Use ↑ and ↓ to move through the list.
						</Empty>
					)}
				</div>
			</div>
		</main>
	)
}
