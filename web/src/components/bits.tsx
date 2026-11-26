import type { ReactNode } from "react"
import { CheckCircle, FileText, Function as Fn, Hourglass, Minus, Prohibit, Question, Robot, ShieldWarning, User, Warning, XCircle } from "@phosphor-icons/react"
import type { Control, PaymentCase } from "../lib/api"
import { isBlocking } from "../lib/derive"
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
	investigating: { label: "Investigating", tone: "run", live: true },
	deciding: { label: "Routing", tone: "run", live: true },
	awaiting_approval: { label: "Needs approval", tone: "warn", icon: <Hourglass size={11} weight="bold" /> },
	blocked: { label: "Blocked", tone: "bad", icon: <ShieldWarning size={11} weight="bold" /> },
	approved: { label: "Approved", tone: "good", icon: <CheckCircle size={11} weight="bold" /> },
	rejected: { label: "Rejected", tone: "", icon: <XCircle size={11} weight="bold" /> },
	not_a_payment: { label: "Not a payment", tone: "", icon: <Prohibit size={11} weight="bold" /> },
	error: { label: "Processing error", tone: "bad", icon: <Warning size={11} weight="bold" /> },
}
export const stageLabel = (s: PaymentCase["stage"]) => STAGE[s].label

export function StageTag({ stage }: { stage: PaymentCase["stage"] }) {
	const m = STAGE[stage]
	return <span className={`tag ${m.tone}`}>{m.live ? <span className="dot" aria-hidden /> : m.icon}{m.label}</span>
}

const SHORT: Record<string, string> = {
	mandatory_fields: "Missing field", evidence: "Unsupported value", vendor_known: "Unknown vendor", iban_checksum: "Invalid IBAN", beneficiary: "Bank details differ",
	beneficiary_name: "Beneficiary name", currency: "Currency", duplicate: "Duplicate", arithmetic: "Total does not add up", line_items: "Line items", per_payment_limit: "Over limit",
	daily_limit: "Daily budget", split_payment: "Possible split", purchase_order: "Purchase order", instruction_content: "Instruction-like text", stated_amounts: "Conflicting amounts",
	agent_agreement: "Agents disagree", stages: "Agent failed",
}
export const controlShort = (k: Control) => SHORT[k.id] ?? k.label

export function ControlTag({ k }: { k: Control }) {
	const block = isBlocking(k)
	return <span className={`tag ${block ? "bad" : "warn"}`} title={k.detail}>{block ? <XCircle size={11} weight="bold" /> : <Warning size={11} weight="bold" />}{controlShort(k)}</span>
}

/** Shows the most serious flagged controls and counts the rest, so a narrow row never clips a tag. */
export function ControlTags({ list, max = 1 }: { list: Control[]; max?: number }) {
	if (list.length === 0) return null
	return (
		<>
			{list.slice(0, max).map((k) => <ControlTag key={k.id} k={k} />)}
			{list.length > max && <span className="more" title={list.slice(max).map(controlShort).join(", ")}>+{list.length - max}</span>}
		</>
	)
}

export function StatusIcon({ status, block }: { status: Control["status"]; block?: boolean }) {
	if (status === "pass") return <CheckCircle size={14} weight="bold" />
	if (status === "na") return <Minus size={14} />
	if (status === "unknown") return <Question size={14} weight="bold" />
	return block ? <XCircle size={14} weight="bold" /> : <Warning size={14} weight="bold" />
}

export type ProvKind = "source" | "computed" | "agent" | "human" | "missing"
const PROV: Record<ProvKind, { label: string; title: string; icon: ReactNode }> = {
	source: { label: "Source", title: "Quoted from the document; the line was located by the server.", icon: <FileText size={12} /> },
	computed: { label: "Computed", title: "A deterministic check in code, from the document, the trusted records and the policy. No model involved.", icon: <Fn size={12} /> },
	agent: { label: "Agent", title: "An agent's reading or recommendation. Advisory until a source or a deterministic check backs it.", icon: <Robot size={12} /> },
	human: { label: "Human", title: "Decided or verified by a person.", icon: <User size={12} /> },
	missing: { label: "Missing", title: "Not present in the document, or no source could be located.", icon: <Question size={12} /> },
}

/** Says where a statement comes from, so an agent's claim is never dressed as a verified fact. */
export function Prov({ kind, label }: { kind: ProvKind; label?: string }) {
	const p = PROV[kind]
	return <span className="prov" title={p.title}>{p.icon}{label ?? p.label}</span>
}

export const Spinner = () => <span className="spinner" aria-hidden />

const DISPOSITION: Record<string, { label: string; tone: string }> = {
	AUTO_APPROVED: { label: "Auto-approved", tone: "good" }, APPROVED_BY_HUMAN: { label: "Approved by a person", tone: "good" }, NEEDS_APPROVAL: { label: "Needs approval", tone: "warn" },
	BLOCKED: { label: "Blocked", tone: "bad" }, PROCESSING_ERROR: { label: "Processing error", tone: "bad" }, REJECTED: { label: "Rejected", tone: "" }, NOT_A_PAYMENT: { label: "Not a payment", tone: "" }, PROCESSING: { label: "Processing", tone: "run" },
}
export const dispositionLabel = (d: string) => DISPOSITION[d]?.label ?? d
export function DispositionTag({ value }: { value: string }) {
	const d = DISPOSITION[value] ?? { label: value, tone: "" }
	return <span className={`tag ${d.tone}`}>{d.label}</span>
}
