import { CheckCircle, Hourglass, Prohibit, Warning, XCircle } from "@phosphor-icons/react"
import type { PaymentCase } from "./api"

const MAP: Record<PaymentCase["stage"], { label: string; cls: string; icon?: React.ReactNode; live?: boolean }> = {
	received: { label: "Received", cls: "chip-run", live: true },
	extracting: { label: "Extracting", cls: "chip-run", live: true },
	checking: { label: "Validating + auditing", cls: "chip-run", live: true },
	deciding: { label: "Routing", cls: "chip-run", live: true },
	awaiting_approval: { label: "Needs approval", cls: "chip-warn", icon: <Hourglass size={12} weight="bold" /> },
	approved: { label: "Approved", cls: "chip-good", icon: <CheckCircle size={12} weight="bold" /> },
	rejected: { label: "Rejected", cls: "chip-bad", icon: <XCircle size={12} weight="bold" /> },
	not_a_payment: { label: "Not a payment", cls: "", icon: <Prohibit size={12} weight="bold" /> },
	error: { label: "Failed", cls: "chip-bad", icon: <Warning size={12} weight="bold" /> },
}

export function StageChip({ stage }: { stage: PaymentCase["stage"] }) {
	const m = MAP[stage]
	return (
		<span className={`chip ${m.cls}`}>
			{m.live ? <span className="dot" aria-hidden /> : m.icon}
			{m.label}
		</span>
	)
}
