/**
 * Writes the one PDF of the held-out evaluation set, server/data/heldout/FA-2026-0331.pdf. Its layout is deliberately
 * unlike the sample invoices: the sender on the right, a letter above the table, the amount column first, the total in a
 * sentence and in a box on the left, and the bank details on one line. Deterministic; run with `npm run heldout:pdf`.
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { parsePdf } from "../server/pdf.js"
import { makePdf, PAGE, type Item } from "../server/test/minipdf.js"

const R = PAGE.w - 48
const p: Item[] = [
	{ t: "text", x: R, y: 60, s: "ATELIER LUMIÈRE SAS", size: 13, bold: true, align: "right" },
	{ t: "text", x: R, y: 76, s: "14 rue des Canuts, 69004 Lyon, France", size: 9, gray: 0.35, align: "right" },
	{ t: "text", x: R, y: 89, s: "TVA intracommunautaire : FR12345678901", size: 9, gray: 0.35, align: "right" },
	{ t: "text", x: 48, y: 140, s: "Kestrel Retail d.o.o.", size: 10 },
	{ t: "text", x: 48, y: 154, s: "Comptabilité fournisseurs, Belgrade", size: 10 },
	{ t: "text", x: 48, y: 200, s: "FACTURE N° FA-2026-0331", size: 16, bold: true },
	{ t: "text", x: 48, y: 220, s: "Lyon, le 24/11/2026. Échéance : 08/01/2027.", size: 10, gray: 0.3 },
	{ t: "text", x: 48, y: 258, s: "Madame, Monsieur,", size: 10 },
	{ t: "text", x: 48, y: 274, s: "veuillez trouver ci-dessous le détail de notre livraison de novembre pour votre magasin de Novi Sad.", size: 10 },
	{ t: "rule", x: 48, y: 300, w: R - 48, gray: 0.3 },
	{ t: "text", x: 48, y: 316, s: "Montant HT", size: 9, bold: true },
	{ t: "text", x: 150, y: 316, s: "Qté", size: 9, bold: true },
	{ t: "text", x: 200, y: 316, s: "P.U.", size: 9, bold: true },
	{ t: "text", x: 270, y: 316, s: "Désignation", size: 9, bold: true },
	{ t: "rule", x: 48, y: 324, w: R - 48, gray: 0.3 },
	{ t: "text", x: 48, y: 342, s: "1.668,00", size: 10 },
	{ t: "text", x: 150, y: 342, s: "12", size: 10 },
	{ t: "text", x: 200, y: 342, s: "139,00", size: 10 },
	{ t: "text", x: 270, y: 342, s: "Suspension « Halo » laiton brossé", size: 10 },
	{ t: "text", x: 48, y: 362, s: "280,00", size: 10 },
	{ t: "text", x: 150, y: 362, s: "1", size: 10 },
	{ t: "text", x: 200, y: 362, s: "280,00", size: 10 },
	{ t: "text", x: 270, y: 362, s: "Transport et emballage", size: 10 },
	{ t: "rule", x: 48, y: 374, w: R - 48, gray: 0.8 },
	{ t: "text", x: 48, y: 398, s: "Total hors taxes : 1.948,00 EUR. TVA 0 % (autoliquidation, art. 283-2 du CGI).", size: 10 },
	{ t: "rect", x: 48, y: 420, w: 250, h: 34, gray: 0.93 },
	{ t: "text", x: 60, y: 442, s: "NET À PAYER : 1.948,00 EUR", size: 12, bold: true },
	{ t: "text", x: 48, y: 500, s: "Règlement par virement : IBAN FR76 3000 6000 0112 3456 7890 189 · BIC AGRIFRPPXXX · Réf. FA-2026-0331", size: 9 },
	{ t: "rule", x: 48, y: 790, w: R - 48 },
	{ t: "text", x: 48, y: 806, s: "Document synthétique pour le bac à sable Payment Desk. Ce n'est pas une vraie facture.", size: 8, gray: 0.5 },
]
const bytes = makePdf([p], { title: "FA-2026-0331 (synthetic, held-out)" })
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "data", "heldout", "FA-2026-0331.pdf")
writeFileSync(out, bytes)
const parsed = await parsePdf(bytes)
console.log(`${out}: ${bytes.length} bytes, ${parsed.source.pages.length} page, ${parsed.source.lines.length} lines`)
if (process.argv.includes("--print")) parsed.text.split("\n").forEach((t, i) => console.log(String(i + 1).padStart(2), t))
