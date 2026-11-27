/**
 * The synthetic PDF invoices. Each one is written by `npm run fixtures:pdf` into server/data/documents/pdf from the
 * description here, so the files in the repository can always be regenerated and compared.
 *
 * Five are PDF versions of documents that already exist as text, with the same values (they are what the equivalence
 * tests compare). Three are new invoices for the "Try a sample invoice" list, with numbers that are not in the text
 * inbox, so they can be added next to it without being duplicates. Every company, account and amount is invented.
 */
import type { InvoiceSpec } from "./minipdf.js"

const NORDLICHT = { name: "NORDLICHT LOGISTIK GmbH", lines: ["Hafenstraße 12, 20457 Hamburg, Germany", "VAT ID: DE811234567"] }
const IBERIA = { name: "IBERIA OFFICE SUPPLIES S.L.", lines: ["Calle Mayor 8, 28013 Madrid, España", "NIF: ESB12345678"] }
const NORDLICHT_PAY = ["Please pay to:", "IBAN: DE89 3704 0044 0532 0130 00", "BIC: COBADEFFXXX"]
const EN: [string, string, string, string] = ["Description", "Qty", "Unit", "Total"]

export type PdfFixture = { docId: string; file: string; label?: string; sample?: boolean; spec: InvoiceSpec }

export const PDF_FIXTURES: PdfFixture[] = [
	// ───────── PDF versions of existing text documents ─────────
	{
		docId: "INV-2026-1041", file: "INV-2026-1041.pdf",
		spec: {
			vendor: NORDLICHT, title: "INVOICE",
			meta: [["Invoice number:", "INV-2026-1041"], ["Invoice date:", "18 November 2026"], ["Due date:", "18 December 2026"], ["Customer:", "Kestrel Retail d.o.o., Belgrade"]],
			columns: EN,
			rows: [["Freight Hamburg -> Belgrade, 3 pallets", "3", "410.00", "1,230.00"], ["Customs handling", "1", "185.00", "185.00"]],
			totals: [["Net", "1,415.00"], ["VAT 0% (reverse charge)", ""], ["TOTAL EUR", "1,415.00", true]],
			payment: [...NORDLICHT_PAY, "Payment reference: INV-2026-1041"],
		},
	},
	{
		docId: "INV-ES-55820", file: "INV-ES-55820.pdf",
		spec: {
			vendor: IBERIA, title: "FACTURA 55820",
			meta: [["Fecha:", "21/11/2026"], ["Vencimiento:", "21/12/2026"]],
			columns: ["Concepto", "Cant.", "Precio", "Importe"],
			rows: [["Papel A4 80g (caja 5 resmas)", "40", "22.90", "916.00"], ["Tóner HP 59X", "6", "98.00", "588.00"], ["Sillas ergonómicas \"Lira\"", "4", "310.00", "1,240.00"]],
			totals: [["Base", "2,744.00"], ["IVA 0% (operación intracomunitaria)", ""], ["TOTAL EUR", "2,744.00", true]],
			notes: ["IMPORTANTE: hemos cambiado de banco. Nuevos datos de pago:"],
			payment: ["IBAN: ES66 2100 0418 4012 3456 7891", "BIC: CAIXESBBXXX", "Referencia: 55820"],
		},
	},
	{
		docId: "INV-2026-1049", file: "INV-2026-1049.pdf",
		spec: {
			cover: { from: "billing@nordlicht-logistik.example", to: "ap@kestrel-retail.example", subject: "Invoice INV-2026-1049 - express freight", body: ["Dear accounts payable team,", "", "please pay EUR 1,980.00 for the express shipment by the end of the week.", "", "The invoice is on the next page.", "", "Nordlicht Logistik, billing"] },
			vendor: NORDLICHT, title: "INVOICE",
			meta: [["Invoice number:", "INV-2026-1049"], ["Invoice date:", "21 November 2026"], ["Due date:", "21 December 2026"]],
			columns: EN,
			rows: [["Express freight Hamburg -> Belgrade, 4 pallets", "4", "410.00", "1,640.00"], ["Express surcharge", "1", "250.00", "250.00"]],
			totals: [["Net", "1,890.00"], ["VAT 0% (reverse charge)", ""], ["TOTAL EUR", "1,890.00", true]],
			payment: [...NORDLICHT_PAY, "Payment reference: INV-2026-1049"],
		},
	},
	{
		docId: "INV-7701-rappel", file: "INV-7701-rappel.pdf",
		spec: {
			vendor: { name: "ATELIER LUMIÈRE SAS", lines: ["14 rue des Arts, 69001 Lyon, France", "TVA: FR12345678901"] }, title: "FACTURE N° 7701 (RAPPEL)",
			meta: [["Date:", "12/10/2026"], ["Échéance:", "26/11/2026"]],
			columns: ["Désignation", "Quantité", "PU HT", "Total HT"],
			rows: [["Lampe de table \"Brume\"", "8", "140.00", "1,120.00"]],
			totals: [["Total HT", "1,120.00"], ["TVA 0% (livraison intracommunautaire)", ""], ["NET À PAYER EUR", "1,120.00", true]],
			payment: ["Coordonnées bancaires:", "IBAN: FR76 3000 6000 0112 3456 7890 189", "BIC: AGRIFRPPXXX", "Référence: 7701"],
		},
	},
	{
		docId: "INV-BP-2291", file: "INV-BP-2291.pdf",
		spec: {
			vendor: { name: "BALTIC PRINT OÜ", lines: ["Telliskivi 60a, 10412 Tallinn, Estonia", "VAT: EE101234567"] }, title: "INVOICE BP-2291",
			meta: [["Invoice date:", "20 November 2026"], ["Due date:", "20 December 2026"]],
			columns: EN,
			rows: [["Catalogue A5, 32 pages, 1,000 copies", "3", "400.00", "1,200.00"], ["Shelf talkers, set of 500", "2", "150.00", "300.00"]],
			totals: [["Net", "1,500.00"], ["VAT 20%", "300.00"], ["TOTAL EUR", "1,900.00", true]],
			payment: ["Bank details:", "IBAN: EE38 2200 2210 2014 5685", "BIC: HABAEE2XXXX", "Payment reference: BP-2291"],
		},
	},
	// ───────── new invoices, offered as samples in Add document ─────────
	{
		docId: "INV-2026-1062", file: "INV-2026-1062.pdf", label: "Valid invoice", sample: true,
		spec: {
			vendor: NORDLICHT, title: "INVOICE",
			meta: [["Invoice number:", "INV-2026-1062"], ["Invoice date:", "25 November 2026"], ["Due date:", "25 December 2026"], ["Customer:", "Kestrel Retail d.o.o., Belgrade"]],
			columns: EN,
			rows: [["Freight Hamburg -> Belgrade, 2 pallets", "2", "410.00", "820.00"], ["Customs handling", "1", "185.00", "185.00"]],
			totals: [["Net", "1,005.00"], ["VAT 0% (reverse charge)", ""], ["TOTAL EUR", "1,005.00", true]],
			payment: [...NORDLICHT_PAY, "Payment reference: INV-2026-1062"],
		},
	},
	{
		docId: "FACTURA-56012", file: "FACTURA-56012.pdf", label: "Changed bank details", sample: true,
		spec: {
			vendor: IBERIA, title: "FACTURA 56012",
			meta: [["Fecha:", "25/11/2026"], ["Vencimiento:", "25/12/2026"]],
			columns: ["Concepto", "Cant.", "Precio", "Importe"],
			rows: [["Papel A4 80g (caja 5 resmas)", "20", "22.90", "458.00"], ["Tóner HP 59X", "4", "98.00", "392.00"]],
			totals: [["Base", "850.00"], ["IVA 0% (operación intracomunitaria)", ""], ["TOTAL EUR", "850.00", true]],
			notes: ["IMPORTANTE: hemos cambiado de banco. Nuevos datos de pago:"],
			payment: ["IBAN: ES66 2100 0418 4012 3456 7891", "BIC: CAIXESBBXXX", "Referencia: 56012"],
		},
	},
	{
		docId: "INV-2026-1064", file: "INV-2026-1064.pdf", label: "Conflicting amounts, two pages", sample: true,
		spec: {
			cover: { from: "billing@nordlicht-logistik.example", to: "ap@kestrel-retail.example", subject: "Invoice INV-2026-1064 - express freight", body: ["Dear accounts payable team,", "", "please pay EUR 2,150.00 for the express shipment by Friday.", "", "The invoice is on the next page.", "", "Nordlicht Logistik, billing"] },
			vendor: NORDLICHT, title: "INVOICE",
			meta: [["Invoice number:", "INV-2026-1064"], ["Invoice date:", "26 November 2026"], ["Due date:", "26 December 2026"]],
			columns: EN,
			rows: [["Express freight Hamburg -> Belgrade, 4 pallets", "4", "410.00", "1,640.00"], ["Express surcharge", "1", "465.00", "465.00"]],
			totals: [["Net", "2,105.00"], ["VAT 0% (reverse charge)", ""], ["TOTAL EUR", "2,105.00", true]],
			payment: [...NORDLICHT_PAY, "Payment reference: INV-2026-1064"],
		},
	},
]
