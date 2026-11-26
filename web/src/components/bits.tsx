import type { ReactNode } from "react"
import { CheckCircle, FileText, Function as Fn, Hourglass, Prohibit, Question, Robot, User, Warning, XCircle } from "@phosphor-icons/react"
import type { PaymentCase } from "../lib/api"
import type { Exception } from "../lib/derive"
import { amount } from "../lib/format"

/** Re-mounts on change so the new value settles in with one short motion; no misleading count-up. */
export function Tick({ value, children }: { value: string | number; children?: ReactNode }) {
	return <span key={value} className="tick">{children ?? value}</span>
}

export function Money({ value, ccy }: { value: number | null | undefined; ccy?: string | null }) {
	if (value == null) return null
	return <>{amount(value)}{ccy && <small className="ccy">{ccy}</small>}</>
}

const STAGE: Record<PaymentCase["stage"], { label: string; tone: string; icon?: ReactNode; live?: boolean }> = {
	received: { label: "Received", tone: "run", live: true },
	extracting: { label: "Extracting", tone: "run", live: true },
	checking: { label: "Checking", tone: "run", live: true },
	deciding: { label: "Routing", tone: "run", live: true },
	awaiting_approval: { label: "Needs approval", tone: "warn", icon: <Hourglass size={11} weight="bold" /> },
	approved: { label: "Approved", tone: "good", icon: <CheckCircle size={11} weight="bold" /> },
	rejected: { label: "Rejected", tone: "bad", icon: <XCircle size={11} weight="bold" /> },
	not_a_payment: { label: "Not a payment", tone: "", icon: <Prohibit size={11} weight="bold" /> },
	error: { label: "Failed", tone: "bad", icon: <Warning size={11} weight="bold" /> },
}
export const stageLabel = (s: PaymentCase["stage"]) => STAGE[s].label

export function StageTag({ stage }: { stage: PaymentCase["stage"] }) {
	const m = STAGE[stage]
	return <span className={`tag ${m.tone}`}>{m.live ? <span className="dot" aria-hidden /> : m.icon}{m.label}</span>
}

export function ExceptionTag({ e }: { e: Exception }) {
	return (
		<span className={`tag ${e.severity === "block" ? "bad" : "warn"}`} title={e.detail}>
			{e.severity === "block" ? <XCircle size={11} weight="bold" /> : <Warning size={11} weight="bold" />}{e.label}
		</span>
	)
}

/** Shows up to `max` exceptions and counts the rest, so a narrow row never clips a tag. */
export function ExceptionTags({ list, max = 1 }: { list: Exception[]; max?: number }) {
	if (list.length === 0) return null
	return (
		<>
			{list.slice(0, max).map((e) => <ExceptionTag key={e.code} e={e} />)}
			{list.length > max && <span className="more" title={list.slice(max).map((e) => e.label).join(", ")}>+{list.length - max}</span>}
		</>
	)
}

export type ProvKind = "source" | "computed" | "agent" | "human" | "missing"
const PROV: Record<ProvKind, { label: string; title: string; icon: ReactNode }> = {
	source: { label: "Source", title: "Quoted verbatim from the document; the line was located by the server.", icon: <FileText size={12} /> },
	computed: { label: "Computed", title: "Derived by code from the document, the vendor master and the policy. No model involved.", icon: <Fn size={12} /> },
	agent: { label: "Agent", title: "An agent's reading. Treat it as an interpretation until a source or a computed check backs it.", icon: <Robot size={12} /> },
	human: { label: "Human", title: "Decided by a person.", icon: <User size={12} /> },
	missing: { label: "Missing", title: "Not present in the document, or no source could be located.", icon: <Question size={12} /> },
}

/** Says where a statement comes from, so an agent's claim is never dressed as a verified fact. */
export function Prov({ kind, label }: { kind: ProvKind; label?: string }) {
	const p = PROV[kind]
	return <span className="prov" title={p.title}>{p.icon}{label ?? p.label}</span>
}

export const Spinner = () => <span className="spinner" aria-hidden />
