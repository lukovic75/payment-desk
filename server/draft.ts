import type { PaymentCase, PaymentDraft, Policy } from "./domain.js"
import { formatMinor } from "./money.js"

/**
 * A structured payment draft for a case that is allowed to be paid. It is a sandbox record for a person to review:
 * it is not an ISO 20022 message, it is not validated against a bank schema, and nothing here can send it anywhere.
 */
export function buildDraft(c: PaymentCase, policy: Policy, approvalRef: string, createdAt: string): PaymentDraft {
	const x = c.extraction.result
	if (!x || x.gross == null || !x.iban || !x.creditorName || !x.currency) throw new Error(`case ${c.id} lacks a mandatory field for a payment draft`)
	if (x.currency !== "EUR") throw new Error(`case ${c.id} is in ${x.currency}; only EUR drafts are produced`)
	return {
		draftId: `PD-${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${c.id}`.slice(0, 48),
		sandbox: true,
		note: "Sandbox payment draft from synthetic data. Not an ISO 20022 message, not validated against a bank schema, never submitted anywhere.",
		caseId: c.id,
		approvalRef,
		creditor: { name: x.creditorName, iban: x.iban, bic: x.bic },
		debtor: policy.debtor,
		amount: { minor: x.gross, currency: x.currency, formatted: formatMinor(x.gross, x.currency) },
		reference: x.reference ?? x.invoiceNumber ?? c.id,
		requestedExecutionDate: x.dueDate,
		createdAt,
		evidence: Object.fromEntries(Object.entries({ amount: x.refs.gross, creditor: x.refs.creditorName, iban: x.refs.iban, reference: x.refs.reference ?? x.refs.invoiceNumber }).filter(([, v]) => v)) as Record<string, string>,
	}
}
