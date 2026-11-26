import type { PaymentCase, Policy, SepaDraft } from "./domain.js"
import { normalizeIban } from "./lib/iban.js"

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!)

/** Builds a minimal ISO 20022 pain.001.001.09 credit transfer draft from a reviewed case. */
export function buildSepaDraft(c: PaymentCase, policy: Policy, createdAt: string): SepaDraft {
	const x = c.extraction.result
	if (!x || x.amount == null || !x.iban || !x.creditorName) throw new Error(`case ${c.id} is not ready for a SEPA draft`)
	const stamp = createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)
	const messageId = `PD-${stamp}-${c.id}`.slice(0, 35)
	const endToEndId = (x.reference ?? x.invoiceNumber ?? c.id).slice(0, 35)
	const amount = x.amount.toFixed(2)
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${esc(messageId)}</MsgId>
      <CreDtTm>${createdAt}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <CtrlSum>${amount}</CtrlSum>
      <InitgPty><Nm>${esc(policy.debtor.name)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${esc(messageId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <ReqdExctnDt><Dt>${(x.dueDate ?? createdAt).slice(0, 10)}</Dt></ReqdExctnDt>
      <Dbtr><Nm>${esc(policy.debtor.name)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${normalizeIban(policy.debtor.iban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BICFI>${esc(policy.debtor.bic)}</BICFI></FinInstnId></DbtrAgt>
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${esc(endToEndId)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="${esc(x.currency ?? policy.currency)}">${amount}</InstdAmt></Amt>
        ${x.bic ? `<CdtrAgt><FinInstnId><BICFI>${esc(x.bic)}</BICFI></FinInstnId></CdtrAgt>` : ""}
        <Cdtr><Nm>${esc(x.creditorName)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${normalizeIban(x.iban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${esc(x.reference ?? x.invoiceNumber ?? c.id)}</Ustrd></RmtInf>
      </CdtTrfTxInf>
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`
	return { messageId, endToEndId, xml, createdAt }
}
