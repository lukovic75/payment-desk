/**
 * What a careful reader takes from the three sample PDF invoices, and the predefined agent answers for them. Used by the
 * scripted model only (`npm run demo`, the tests). They are fixed text, not model output, and each answer is validated
 * like a live one: a quote that is not in the parsed PDF, or a citation to evidence that does not exist, is caught.
 * The five PDFs that mirror existing text documents use the readings those documents already have (fixtures.ts).
 */
import type { ReadingInput } from "../firewall.js"
import type { Script } from "./scripted.js"

const f = (value: string, quote: string) => ({ value, quote })

export const PDF_READINGS: Record<string, ReadingInput> = {
	"INV-2026-1062": { fields: { creditorName: f("NORDLICHT LOGISTIK GmbH", "NORDLICHT LOGISTIK GmbH"), invoiceNumber: f("INV-2026-1062", "Invoice number: INV-2026-1062"), invoiceDate: f("2026-11-25", "Invoice date: 25 November 2026"), dueDate: f("2026-12-25", "Due date: 25 December 2026"), currency: f("EUR", "TOTAL EUR 1,005.00"), gross: f("1005.00", "TOTAL EUR 1,005.00"), net: f("1005.00", "Net 1,005.00"), iban: f("DE89370400440532013000", "IBAN: DE89 3704 0044 0532 0130 00"), bic: f("COBADEFFXXX", "BIC: COBADEFFXXX"), reference: f("INV-2026-1062", "Payment reference: INV-2026-1062") }, lines: [{ label: "Freight", amount: "820.00", quote: "Freight Hamburg -> Belgrade, 2 pallets 2 410.00 820.00" }, { label: "Customs handling", amount: "185.00", quote: "Customs handling 1 185.00 185.00" }] },
	"FACTURA-56012": { fields: { creditorName: f("IBERIA OFFICE SUPPLIES S.L.", "IBERIA OFFICE SUPPLIES S.L."), invoiceNumber: f("56012", "FACTURA 56012"), invoiceDate: f("2026-11-25", "Fecha: 25/11/2026"), currency: f("EUR", "TOTAL EUR 850.00"), gross: f("850.00", "TOTAL EUR 850.00"), iban: f("ES0700120345030000067890", "IBAN: ES07 0012 0345 0300 0006 7890") } },
	"INV-2026-1064": { fields: { creditorName: f("NORDLICHT LOGISTIK GmbH", "NORDLICHT LOGISTIK GmbH"), invoiceNumber: f("INV-2026-1064", "Invoice number: INV-2026-1064"), invoiceDate: f("2026-11-26", "Invoice date: 26 November 2026"), currency: f("EUR", "TOTAL EUR 2,105.00"), gross: f("2105.00", "TOTAL EUR 2,105.00"), net: f("2105.00", "Net 2,105.00"), iban: f("DE89370400440532013000", "IBAN: DE89 3704 0044 0532 0130 00") } },
}

export const PDF_RESPONSES: Required<Pick<Script, "audits" | "validations" | "investigations" | "policies">> = {
	audits: {
		"INV-2026-1062": { ...PDF_READINGS["INV-2026-1062"]!, conflicts: [], summary: "One payable amount is stated: EUR 1,005.00. The line items sum to it. No contradiction found in the document." },
		"FACTURA-56012": { ...PDF_READINGS["FACTURA-56012"]!, conflicts: [], summary: "One payable amount is stated: EUR 850.00. The document announces new bank details. Whether that account belongs to the vendor cannot be read from the document." },
		"INV-2026-1064": { ...PDF_READINGS["INV-2026-1064"]!, summary: "Page 1 asks for EUR 2,150.00. The invoice total on page 2 is EUR 2,105.00. Both statements are reported; which one is payable is not decided here.", conflicts: [{ field: "gross", values: ["2150.00", "2105.00"], quotes: ["please pay EUR 2,150.00 for the express shipment by Friday.", "TOTAL EUR 2,105.00"] }] },
	},
	validations: {
		"INV-2026-1062": { summary: "Nordlicht Logistik GmbH is vendor V-001. The IBAN passes the checksum and is the one on file. No earlier payment or document carries this invoice number." },
		"FACTURA-56012": { summary: "Iberia Office Supplies S.L. is vendor V-004. The IBAN on the document passes the checksum but is not the one on file. The lookup returned no callback record for this vendor and this account.", issues: [{ code: "IBAN_MISMATCH", severity: "block", message: "The document asks for ES07 0012 0345 0300 0006 7890. The vendor master has ES91 2100 0418 4502 0005 1332.", refs: ["X:iban", "V:V-004"] }] },
		"INV-2026-1064": { summary: "Nordlicht Logistik GmbH is vendor V-001. The IBAN passes the checksum and is the one on file. No earlier payment or document carries this invoice number." },
	},
	investigations: {
		"FACTURA-56012": {
			category: "Beneficiary account differs from the vendor master", assessment: "confirmed_discrepancy",
			verifiedFacts: [{ text: "The creditor matches vendor V-004, Iberia Office Supplies S.L.", refs: ["X:creditorName", "V:V-004"] }, { text: "The document asks for payment to ES07 0012 0345 0300 0006 7890. The vendor master holds ES91 2100 0418 4502 0005 1332.", refs: ["X:iban", "V:V-004"] }],
			conflictingEvidence: [{ text: "The document says the vendor changed bank. The trusted record does not show that change.", refs: ["X:iban", "V:V-004"] }],
			explanation: "The invoice is otherwise plausible, but it asks for payment to an account that is not the one on file. A valid checksum shows the number is well formed, not who owns the account. No verified account-change evidence is available.",
			unknowns: ["Whether the vendor really changed bank. No callback record exists for this vendor and this account."],
			recommendedSteps: ["Call the vendor on the number in the vendor master, not on any contact given in the document."],
			recommendedDisposition: "BLOCKED",
		},
		"INV-2026-1064": {
			category: "Conflicting payable amounts inside one document", assessment: "confirmed_discrepancy",
			verifiedFacts: [{ text: "The invoice total on page 2 is EUR 2,105.00, and net equals gross at 0% VAT.", refs: ["X:gross", "X:net"] }, { text: "The IBAN on the document is the one on file for vendor V-001.", refs: ["X:iban", "V:V-001"] }],
			conflictingEvidence: [{ text: "The covering note on page 1 asks for EUR 2,150.00. The invoice total on page 2 is EUR 2,105.00. The difference is 45.00.", refs: ["A:conflict:1:1", "A:conflict:1:2", "X:gross"] }],
			explanation: "The document states two different payable amounts on two pages. Nothing in the trusted records says which amount the vendor is owed.",
			unknowns: ["Which amount the vendor is owed. The document alone cannot settle it."],
			recommendedSteps: ["Ask the vendor for a corrected document, or a written confirmation of the amount due."],
			recommendedDisposition: "NEEDS_APPROVAL",
		},
	},
	policies: {
		"INV-2026-1062": { disposition: "AUTO_APPROVED", rulesApplied: ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R13", "R15"], passed: ["mandatory_fields", "evidence", "vendor_known", "iban_checksum", "beneficiary", "currency", "duplicate", "per_payment_limit", "daily_limit", "agent_agreement"], failed: [], humanRequired: false, explanation: "Every blocking and review control passes. The vendor is approved, the IBAN is the one on file, both readings agree and EUR 1,005.00 is within the per-payment limit and the daily budget.", refs: ["X:gross", "X:iban", "V:V-001", "C:limit", "C:daily"] },
		"FACTURA-56012": { disposition: "BLOCKED", rulesApplied: ["R5"], passed: ["vendor_known", "iban_checksum", "duplicate", "per_payment_limit"], failed: ["beneficiary"], humanRequired: true, explanation: "R5 blocks a payment to an account that is not the one on file unless a callback is recorded against the vendor and that account. None is.", refs: ["X:iban", "V:V-004"] },
		"INV-2026-1064": { disposition: "NEEDS_APPROVAL", rulesApplied: ["R14"], passed: ["vendor_known", "iban_checksum", "beneficiary", "duplicate", "per_payment_limit"], failed: ["stated_amounts", "agent_agreement"], humanRequired: true, explanation: "The blocking controls pass, but the document states two payable amounts, EUR 2,150.00 and EUR 2,105.00. R14 sends an unresolved conflicting statement to a person.", refs: ["A:conflict:1:1", "A:conflict:1:2", "X:gross"] },
	},
}
