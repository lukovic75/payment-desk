import { ArrowCounterClockwise, CheckCircle, Desktop, Minus, Moon, Sun, XCircle } from "@phosphor-icons/react"
import { useState } from "react"
import { resetDemo, type DeskSnapshot, type Health, type Link } from "../lib/api"
import { iban, money } from "../lib/format"
import type { ThemeMode } from "../App"
import { Spinner } from "../components/bits"
import { PageHead, Seg } from "../components/ui"

type Props = { snapshot: DeskSnapshot; health: Health | null; link: Link; mode: ThemeMode; onMode: (m: ThemeMode) => void; still: boolean; onStill: (v: boolean) => void }

/** Only what really works here: appearance and demo reset are editable; policy, records and connections are shown as the server has them. */
export function Settings({ snapshot, health, link, mode, onMode, still, onStill }: Props) {
	const { policy, vendors, history } = snapshot
	const [busy, setBusy] = useState(false)
	const [err, setErr] = useState<string | null>(null)
	const demo = snapshot.cases.filter((c) => c.origin === "demo").length
	const yes = (ok: boolean | null, text: string) => (
		<span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
			{ok == null ? <Minus size={14} className="muted" /> : ok ? <CheckCircle size={14} weight="fill" style={{ color: "var(--good)" }} /> : <XCircle size={14} weight="fill" style={{ color: "var(--bad)" }} />}{text}
		</span>
	)
	return (
		<main className="view">
			<PageHead title="Settings" sub="Appearance and demo data can be changed here. Policy, records and connections are shown exactly as the server has them." />
			<div className="settings">
				<section className="sec">
					<div className="sec-title"><h2>Appearance and data</h2></div>
					<div className="panel">
						<div className="setrow">
							<div><b>Appearance</b><small>Stored in this browser only.</small></div>
							<Seg value={mode} onChange={onMode} label="Appearance" options={[{ value: "system", label: <><Desktop size={14} /> System</> }, { value: "light", label: <><Sun size={14} /> Light</> }, { value: "dark", label: <><Moon size={14} /> Dark</> }]} />
						</div>
						<div className="setrow">
							<div><b>Ambient motion</b><small>The background light drifts very slowly. It always stops while the tab is hidden and when your system asks for reduced motion.</small></div>
							<button type="button" className="switch" role="switch" aria-checked={!still} aria-label="Ambient motion" onClick={() => onStill(!still)} />
						</div>
						<div className="setrow">
							<div><b>Demo data</b><small>{demo} demo case{demo === 1 ? "" : "s"}, {snapshot.cases.length - demo} added by you. Removing clears only the scenario cases and the callbacks verified on them.</small></div>
							<button className="btn" disabled={busy || demo === 0 || link.state !== "live"} onClick={async () => { setBusy(true); setErr(null); try { await resetDemo() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }}>{busy ? <Spinner /> : <ArrowCounterClockwise size={14} />} Remove the demo cases</button>
						</div>
						{err && <div className="panel-body"><div className="errbox" role="alert">{err}</div></div>}
					</div>
				</section>

				<section className="sec">
					<div className="sec-title"><h2>Connections</h2><span className="right">live status</span></div>
					<div className="panel">
						<div className="panel-body">
							<dl className="kv">
								<div><dt>Desk server</dt><dd>{yes(link.state === "live", link.state === "live" ? "event stream open, heartbeat every 10 s" : `${link.state}, attempt ${link.attempts}`)}</dd></div>
								<div><dt>Model API key</dt><dd>{health ? yes(health.hasModelKey, health.hasModelKey ? "found in the server environment" : "missing: set ANTHROPIC_API_KEY in .env and restart") : yes(null, "unknown while the server is unreachable")}</dd></div>
								<div><dt>Models</dt><dd className="mono">{snapshot.models.fast} · {snapshot.models.careful}</dd></div>
								<div><dt>Mozaik runtime</dt><dd>{yes(link.state === "live" ? snapshot.runtime.participants > 0 : null, `${snapshot.runtime.participants} participants joined, in-process`)}</dd></div>
								<div><dt>Mozaik Cloud trace</dt><dd>{yes(snapshot.cloudEnabled, snapshot.cloudEnabled ? "this machine is paired; loops are visible at app.jigjoy.ai" : "not paired (optional): npx @mozaik-ai/cloud-sdk pair")}</dd></div>
								<div><dt>Case state</dt><dd>{yes(snapshot.persisted, snapshot.persisted ? "saved to .desk-state.json; survives a restart" : "in memory only")}</dd></div>
								<div><dt>Reviewer</dt><dd>{snapshot.reviewer} <span className="muted">(no sign-in in this build)</span></dd></div>
							</dl>
						</div>
					</div>
				</section>

				<section className="sec full">
					<div className="sec-title"><h2>Payment policy</h2><span className="right mono">server/data/policy.json</span></div>
					<div className="panel"><div className="panel-body" style={{ display: "grid", gap: 16 }}>
						<dl className="kv">
							<div><dt>Policy</dt><dd>{policy.name}</dd></div>
							<div><dt>Auto-approve limit</dt><dd>{money(policy.autoApproveLimit, policy.currency)} per payment</dd></div>
							<div><dt>Daily auto-approve budget</dt><dd>{money(policy.dailyAutoApproveBudget, policy.currency)}</dd></div>
							<div><dt>Payable currencies</dt><dd className="mono">{policy.currencies.join(", ")}</dd></div>
							<div><dt>Split window</dt><dd>{policy.splitWindowDays} days, per vendor and purchase order</dd></div>
							<div><dt>Paying account</dt><dd>{policy.debtor.name} <span className="mono muted">{iban(policy.debtor.iban)}</span></dd></div>
						</dl>
						<div className="grid-table" style={{ ["--cols" as string]: "52px 150px minmax(0, 1fr)" }}>
							<div className="tr h"><span>Rule</span><span>When it fails</span><span>Text</span></div>
							{policy.rules.map((r) => (
								<div className="tr" key={r.id}><span className="t">{r.id}</span><span><span className={`tag ${r.effect === "blocked" ? "bad" : "warn"}`}>{r.effect === "blocked" ? "blocks the payment" : "needs approval"}</span></span><span className="wide soft">{r.text}</span></div>
							))}
						</div>
						<p className="fine">Read-only here. These rules are enforced by code in <span className="mono">server/firewall.ts</span>; the Policy agent can recommend something stricter, never looser. Edit the file and restart to change them.</p>
					</div></div>
				</section>

				<section className="sec">
					<div className="sec-title"><h2>Vendor master</h2><span className="right mono">server/data/vendors.json</span></div>
					<div className="panel">
					<div className="grid-table" style={{ ["--cols" as string]: "64px minmax(140px, 1fr) minmax(200px, 1.2fr)" }}>
						<div className="tr h"><span>Id</span><span>Vendor</span><span>IBAN on file</span></div>
						{vendors.map((v) => (
							<div className="tr" key={v.id}><span className="t">{v.id}</span><span style={{ fontWeight: 500 }}>{v.name} <span className="muted" style={{ fontWeight: 400 }}>{v.country}</span></span><span className="mono wide">{iban(v.iban)}</span></div>
						))}
					</div>
					<div className="panel-foot">Synthetic vendors with valid test IBANs. Nothing in the app can change this file.</div>
					</div>
				</section>

				<section className="sec">
					<div className="sec-title"><h2>Payment history</h2><span className="right mono">server/data/history.json</span></div>
					<div className="panel">
					<div className="grid-table" style={{ ["--cols" as string]: "64px 64px minmax(110px, 1fr) minmax(110px, 1fr) 96px" }}>
						<div className="tr h"><span>Id</span><span>Vendor</span><span>Invoice</span><span className="num">Paid</span><span>Date</span></div>
						{history.map((h) => (
							<div className="tr" key={h.id}><span className="t">{h.id}</span><span className="t">{h.vendorId}</span><span className="mono">{h.invoiceNumber}</span><span className="num">{money(h.gross, h.currency)}</span><span className="t">{h.paidAt}</span></div>
						))}
					</div>
					<div className="panel-foot">Synthetic past payments. An invoice already here is blocked as a duplicate.</div>
					</div>
				</section>
			</div>
		</main>
	)
}
