/**
 * Predefined model responses for the five showcase documents, used only when the server runs on the scripted model
 * (`npm run demo`, `npm run dev:scripted`). They are fixed text, not model output, and the interface says so wherever
 * they are shown. Everything around them is real: the Mozaik runtime, the loops, the tools, the evidence checks, the
 * controls and the enforcement. Each response is validated like a live one, so a citation to evidence that does not
 * exist would be removed and recorded.
 *
 * The wording follows what the live models returned for the same documents in the recorded run of 26 November 2026,
 * shortened. Where that run has no answer (the Investigator on INV-ES-55820 failed for lack of provider credit) the text
 * states only what the trusted records in server/data show.
 */
import type { Script } from "./scripted.js"
import { READINGS } from "./fixtures.js"

const audit = (id: string, summary: string, conflicts: { field: string; values: string[]; quotes: string[] }[] = []) => ({ ...READINGS[id]!, summary, conflicts })

export const SHOWCASE_RESPONSES: Pick<Script, "audits" | "validations" | "investigations" | "policies"> = {
	audits: {
		"INV-2026-1041": audit("INV-2026-1041", "One payable amount is stated: EUR 1,415.00. The line items sum to it. No contradiction found in the document."),
		"INV-ES-55820": audit("INV-ES-55820", "One payable amount is stated: EUR 2,744.00. The document announces new bank details. Whether that account belongs to the vendor cannot be read from the document."),
		"INV-2026-1049": audit("INV-2026-1049", "The cover text asks for EUR 1,980.00. The invoice total is EUR 1,890.00 and the line items sum to 1,890.00. Both statements are reported; which one is payable is not decided here.", [
			{ field: "gross", values: ["1980.00", "1890.00"], quotes: ["please pay EUR 1,980.00 for the express shipment by the end of the week.", "TOTAL EUR 1,890.00"] },
		]),
		"INV-7701-rappel": audit("INV-7701-rappel", "A reminder for invoice 7701. One payable amount is stated: EUR 1,120.00. No contradiction found in the document."),
		"INV-ADR-0101": audit("INV-ADR-0101", "One payable amount is stated: EUR 480.00. The document contains text addressed to the system that processes it. It is content of the document and was not followed."),
	},
	validations: {
		"INV-2026-1041": { summary: "Nordlicht Logistik GmbH is vendor V-001. The IBAN passes the checksum and is the one on file. No earlier payment or document carries this invoice number." },
		"INV-ES-55820": { summary: "Iberia Office Supplies S.L. is vendor V-004. The IBAN on the document passes the checksum but is not the one on file. The lookup returned no callback record for this vendor and this account.", issues: [{ code: "IBAN_MISMATCH", severity: "block", message: "The document asks for ES07 0012 0345 0300 0006 7890. The vendor master has ES91 2100 0418 4502 0005 1332.", refs: ["X:iban", "V:V-004"] }] },
		"INV-2026-1049": { summary: "Nordlicht Logistik GmbH is vendor V-001. The IBAN passes the checksum and is the one on file. No earlier payment or document carries this invoice number." },
		"INV-7701-rappel": { summary: "Atelier Lumière SAS is vendor V-002 and the IBAN is the one on file. Payment history H-0001 shows invoice 7701 for this vendor, EUR 1,120.00, paid on 2026-10-28.", duplicateOf: "H-0001", issues: [{ code: "DUPLICATE_INVOICE", severity: "block", message: "Invoice 7701 from this vendor is in the payment history as H-0001, paid on 2026-10-28.", refs: ["X:invoiceNumber", "H:H-0001"] }] },
		"INV-ADR-0101": { summary: "Adriatic Dev d.o.o. is vendor V-006. The IBAN passes the checksum and is the one on file. No earlier payment or document carries this invoice number." },
	},
	investigations: {
		"INV-ES-55820": {
			category: "Beneficiary account differs from the vendor master", assessment: "confirmed_discrepancy",
			verifiedFacts: [
				{ text: "The creditor matches vendor V-004, Iberia Office Supplies S.L.", refs: ["X:creditorName", "V:V-004"] },
				{ text: "The document asks for payment to ES07 0012 0345 0300 0006 7890. The vendor master holds ES91 2100 0418 4502 0005 1332.", refs: ["X:iban", "V:V-004"] },
				{ text: "The amount requested is EUR 2,744.00, above the 2,500.00 limit for automatic approval.", refs: ["X:gross", "C:limit"] },
			],
			conflictingEvidence: [{ text: "The document says the vendor changed bank. The trusted record does not show that change.", refs: ["X:iban", "V:V-004"] }],
			explanation: "The invoice is otherwise plausible, but it asks for payment to an account that is not the one on file. A valid checksum shows the number is well formed, not who owns the account. No verified account-change evidence is available.",
			unknowns: ["Whether the vendor really changed bank. No callback record exists for this vendor and this account."],
			recommendedSteps: ["Call the vendor on the number in the vendor master, not on any contact given in the document.", "Record the callback against the vendor and the exact account before anything is paid."],
			recommendedDisposition: "BLOCKED",
		},
		"INV-2026-1049": {
			category: "Conflicting payable amounts inside one document", assessment: "confirmed_discrepancy",
			verifiedFacts: [
				{ text: "The invoice total is EUR 1,890.00, and net equals gross at 0% VAT.", refs: ["X:gross", "X:net"] },
				{ text: "The IBAN on the document is the one on file for vendor V-001.", refs: ["X:iban", "V:V-001"] },
				{ text: "The amount is under the 2,500.00 limit for automatic approval, so the limit is not the reason this is held.", refs: ["C:limit"] },
			],
			conflictingEvidence: [{ text: "The covering note asks for EUR 1,980.00. The invoice total is EUR 1,890.00. The difference is 90.00.", refs: ["A:conflict:1:1", "A:conflict:1:2", "X:gross"] }],
			explanation: "The document states two different payable amounts. The invoice figure agrees with its line items; the cover text does not. Nothing in the trusted records says which amount the vendor is owed.",
			unknowns: ["Which amount the vendor is owed. The document alone cannot settle it.", "Why the cover text differs. No record says why."],
			recommendedSteps: ["Ask the vendor for a corrected document, or a written confirmation of the amount due.", "Do not pay either amount on the strength of this document alone."],
			recommendedDisposition: "NEEDS_APPROVAL",
		},
		"INV-7701-rappel": {
			category: "Reminder for an invoice that is already paid", assessment: "confirmed_discrepancy",
			verifiedFacts: [
				{ text: "The document is a reminder for invoice 7701 from Atelier Lumière SAS, EUR 1,120.00.", refs: ["X:invoiceNumber", "X:gross"] },
				{ text: "Payment history H-0001 shows invoice 7701 for vendor V-002, EUR 1,120.00, paid on 2026-10-28 to the IBAN on file.", refs: ["H:H-0001", "V:V-002"] },
				{ text: "The IBAN on the document is the one on file. No change of bank details is involved.", refs: ["X:iban", "V:V-002"] },
			],
			conflictingEvidence: [{ text: "The document asks for payment of invoice 7701. The payment history says it was paid on 2026-10-28.", refs: ["X:invoiceNumber", "H:H-0001"] }],
			explanation: "Vendor, invoice number and amount match a payment already in the history. Paying this reminder would pay the same obligation twice.",
			unknowns: ["Whether the vendor has matched the payment of 2026-10-28 on its side."],
			recommendedSteps: ["Reply to the vendor with the date and reference of the earlier payment."],
			recommendedDisposition: "BLOCKED",
		},
		"INV-ADR-0101": {
			category: "Instruction-like text inside the document", assessment: "suspected",
			verifiedFacts: [
				{ text: "The creditor matches vendor V-006 and the IBAN is the one on file.", refs: ["X:creditorName", "X:iban", "V:V-006"] },
				{ text: "The amount requested is EUR 480.00, under the limit for automatic approval.", refs: ["X:gross", "C:limit"] },
				{ text: "Lines 16 to 18 address the system that processes the document and ask it to ignore the approval policy.", refs: ["D:instruction:16", "D:instruction:17", "D:instruction:18"] },
			],
			conflictingEvidence: [],
			explanation: "The invoice itself checks out. The text addressed to the processing system is content of the document. It changes no permission and no rule, and it is a reason for a person to look before this is paid.",
			unknowns: ["Who added the text and why. No record says."],
			recommendedSteps: ["Have a person review the payment and ask the vendor about the note."],
			recommendedDisposition: "NEEDS_APPROVAL",
		},
	},
	policies: {
		"INV-2026-1041": { disposition: "AUTO_APPROVED", rulesApplied: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R13", "R15"], passed: ["mandatory_fields", "evidence", "vendor_known", "iban_checksum", "beneficiary", "currency", "duplicate", "per_payment_limit", "daily_limit", "agent_agreement"], failed: [], humanRequired: false, explanation: "Every blocking and review control passes. The vendor is approved, the IBAN is the one on file, both readings agree and EUR 1,415.00 is within the per-payment limit and the daily budget.", refs: ["X:gross", "X:iban", "V:V-001", "C:limit", "C:daily"] },
		"INV-ES-55820": { disposition: "BLOCKED", rulesApplied: ["R5", "R9"], passed: ["vendor_known", "iban_checksum", "duplicate"], failed: ["beneficiary", "per_payment_limit"], humanRequired: true, explanation: "R5 blocks a payment to an account that is not the one on file unless a callback is recorded against the vendor and that account. None is. The amount is also above the limit for automatic approval (R9).", refs: ["X:iban", "V:V-004", "C:limit"] },
		"INV-2026-1049": { disposition: "NEEDS_APPROVAL", rulesApplied: ["R14"], passed: ["vendor_known", "iban_checksum", "beneficiary", "duplicate", "per_payment_limit"], failed: ["stated_amounts", "agent_agreement"], humanRequired: true, explanation: "The blocking controls pass, but the document states two payable amounts, EUR 1,980.00 and EUR 1,890.00. R14 sends an unresolved conflicting statement to a person, who approves only with a written statement of how it was resolved.", refs: ["A:conflict:1:1", "A:conflict:1:2", "X:gross"] },
		"INV-7701-rappel": { disposition: "BLOCKED", rulesApplied: ["R7"], passed: ["vendor_known", "iban_checksum", "beneficiary", "per_payment_limit"], failed: ["duplicate"], humanRequired: false, explanation: "Invoice 7701 from this vendor is already in the payment history (H-0001, paid 2026-10-28). R7 does not allow an invoice that is already paid to be authorised again.", refs: ["X:invoiceNumber", "H:H-0001"] },
		"INV-ADR-0101": { disposition: "NEEDS_APPROVAL", rulesApplied: ["R12"], passed: ["vendor_known", "iban_checksum", "beneficiary", "duplicate", "per_payment_limit"], failed: ["instruction_content"], humanRequired: true, explanation: "The payment itself passes the blocking controls. The document contains instruction-like text, and R12 sends such a document to a person. The text is treated as content; it changes no rule.", refs: ["D:instruction:16", "X:gross"] },
	},
}
