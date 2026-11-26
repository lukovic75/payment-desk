import { useEffect, useRef, useState } from "react"
import { X } from "@phosphor-icons/react"
import { addDocument } from "./api"

const SAMPLES: { label: string; name: string; text: string }[] = [
	{
		label: "Clean invoice",
		name: "INV-NL-4471",
		text: `From: invoices@tulpcloud.example
To: ap@kestrel-retail.example
Subject: Tulp Cloud — invoice TC-20261125 (support hours)

TULP CLOUD B.V.
Keizersgracht 100, 1015 AA Amsterdam, The Netherlands
VAT: NL123456789B01

Invoice TC-20261125
Issued: 25 Nov 2026 · Due: 09 Dec 2026 (14 days)

Support engineering, 6 h x EUR 120.00                 EUR   720.00
VAT 0% (reverse charge)
Amount due                                            EUR   720.00

Bank: ABN AMRO
IBAN NL91 ABNA 0417 1643 00
BIC ABNANL2AXXX
Reference TC-20261125`,
	},
	{
		label: "Changed bank details",
		name: "INV-2026-1058",
		text: `From: billing@nordlicht-logistik.example
To: ap@kestrel-retail.example
Subject: Invoice INV-2026-1058 — IMPORTANT: new bank account

NORDLICHT LOGISTIK GmbH
Hafenstraße 12, 20457 Hamburg, Germany
VAT ID: DE811234567

INVOICE
Invoice number: INV-2026-1058
Invoice date: 25 November 2026
Due date: 25 December 2026

Freight Hamburg -> Belgrade, 2 pallets          2   410.00     820.00
                                                    TOTAL EUR 820.00

Please note our bank account has changed. Pay only to:
IBAN: DE02 1203 0000 0000 2020 51
BIC: BYLADEM1001
Payment reference: INV-2026-1058`,
	},
	{
		label: "Typo in the IBAN",
		name: "INV-ES-55831",
		text: `From: facturacion@iberia-office.example
To: ap@kestrel-retail.example
Subject: Factura 55831

IBERIA OFFICE SUPPLIES S.L.
Calle Mayor 8, 28013 Madrid, España
NIF: ESB12345678

FACTURA 55831
Fecha: 25/11/2026
Vencimiento: 25/12/2026

Papel A4 80g (caja 5 resmas)                  10     22.90     229.00
                                                     TOTAL EUR 229.00

IBAN: ES91 2100 0418 4502 0005 1333
BIC: CAIXESBBXXX
Referencia: 55831`,
	},
]

export function AddDocument({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: string) => void }) {
	const ref = useRef<HTMLDialogElement>(null)
	const [name, setName] = useState("")
	const [text, setText] = useState("")
	const [busy, setBusy] = useState(false)
	const [err, setErr] = useState<string | null>(null)

	useEffect(() => {
		const d = ref.current
		if (!d) return
		if (open && !d.open) d.showModal()
		if (!open && d.open) d.close()
	}, [open])

	const submit = async () => {
		setBusy(true); setErr(null)
		try {
			const c = await addDocument(name, text)
			setName(""); setText("")
			onAdded(c.id)
		} catch (e) {
			setErr((e as Error).message)
		} finally { setBusy(false) }
	}

	return (
		<dialog className="sheet" ref={ref} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose() }} aria-labelledby="add-doc-title">
			<form method="dialog" onSubmit={(e) => { e.preventDefault(); void submit() }}>
				<div className="sheet-head">
					<h2 id="add-doc-title">Add a document to the inbox</h2>
					<button type="button" className="btn btn-ghost btn-icon close" aria-label="Close" onClick={onClose}><X size={16} /></button>
				</div>
				<div className="sheet-body">
					<div className="samples" aria-label="Examples">
						{SAMPLES.map((s) => (
							<button key={s.name} type="button" className="btn" onClick={() => { setName(s.name); setText(s.text); setErr(null) }}>{s.label}</button>
						))}
					</div>
					<label>
						Name (optional)
						<input value={name} onChange={(e) => setName(e.target.value)} placeholder="INV-2026-1099" autoComplete="off" spellCheck={false} />
					</label>
					<label>
						Document text
						<textarea value={text} onChange={(e) => { setText(e.target.value); if (err) setErr(null) }} placeholder="Paste an invoice, a reminder or any email the accounts-payable inbox would receive. Synthetic data only." spellCheck={false} />
					</label>
					{err && <div className="step-error">{err}</div>}
				</div>
				<div className="sheet-foot">
					<span className="hint">The four agents start on it immediately and the case appears in the list.</span>
					<div className="buttons">
						<button type="button" className="btn" onClick={onClose}>Cancel</button>
						<button type="submit" className="btn btn-primary" disabled={busy || text.trim().length < 20}>{busy ? "Sending" : "Run through the desk"}</button>
					</div>
				</div>
			</form>
		</dialog>
	)
}
