import { CheckCircle, Desktop, Minus, Moon, Sun, XCircle } from "@phosphor-icons/react"
import type { DeskSnapshot, Health, Link } from "../lib/api"
import { iban, money } from "../lib/format"
import type { ThemeMode } from "../App"

type Props = { snapshot: DeskSnapshot; health: Health | null; link: Link; mode: ThemeMode; onMode: (m: ThemeMode) => void }

/** Only what really works here: the theme is editable; policy, vendors and connections are shown as the server has them. */
export function Settings({ snapshot, health, link, mode, onMode }: Props) {
	const { policy, vendors } = snapshot
	const yes = (ok: boolean | null, text: string) => (
		<span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
			{ok == null ? <Minus size={14} className="muted" /> : ok ? <CheckCircle size={14} weight="bold" style={{ color: "var(--good)" }} /> : <XCircle size={14} weight="bold" style={{ color: "var(--bad)" }} />}{text}
		</span>
	)
	return (
		<main className="view">
			<div className="settings">
				<section className="panel">
					<div className="panel-head"><h2>Appearance</h2></div>
					<div className="panel-body" style={{ display: "grid", gap: 10 }}>
						<div className="seg" role="group" aria-label="Theme" style={{ justifySelf: "start" }}>
							<button aria-pressed={mode === "system"} onClick={() => onMode("system")}><Desktop size={14} /> System</button>
							<button aria-pressed={mode === "light"} onClick={() => onMode("light")}><Sun size={14} /> Light</button>
							<button aria-pressed={mode === "dark"} onClick={() => onMode("dark")}><Moon size={14} /> Dark</button>
						</div>
						<p className="muted" style={{ fontSize: "var(--fs-12)" }}>Stored in this browser only.</p>
					</div>
				</section>

				<section className="panel">
					<div className="panel-head"><h2>Connections</h2><span className="right">live status</span></div>
					<div className="panel-body">
						<dl className="kv">
							<div><dt>Desk server</dt><dd>{yes(link.state === "live", link.state === "live" ? "event stream open" : `${link.state}, attempt ${link.attempts}`)}</dd></div>
							<div><dt>Model API key</dt><dd>{health ? yes(health.hasModelKey, health.hasModelKey ? "found in the server environment" : "missing: set ANTHROPIC_API_KEY in .env and restart") : yes(null, "unknown while the server is unreachable")}</dd></div>
							<div><dt>Models</dt><dd className="mono">{snapshot.models.fast} · {snapshot.models.careful}</dd></div>
							<div><dt>Mozaik runtime</dt><dd>{yes(link.state === "live" ? snapshot.runtime.participants > 0 : null, `${snapshot.runtime.participants} participants joined, in-process`)}</dd></div>
							<div><dt>Mozaik Cloud trace</dt><dd>{yes(snapshot.cloudEnabled, snapshot.cloudEnabled ? "this machine is paired; loops are visible at app.jigjoy.ai" : "not paired (optional): npx @mozaik-ai/cloud-sdk pair")}</dd></div>
						</dl>
					</div>
				</section>

				<section className="panel">
					<div className="panel-head"><h2>Payment policy</h2><span className="right mono">server/data/policy.json</span></div>
					<div className="panel-body" style={{ display: "grid", gap: 14 }}>
						<dl className="kv">
							<div><dt>Policy</dt><dd>{policy.name}</dd></div>
							<div><dt>Auto-approve limit</dt><dd>{money(policy.autoApproveLimit, policy.currency)} per payment</dd></div>
							<div><dt>Daily auto-approve budget</dt><dd>{money(policy.dailyAutoApproveBudget, policy.currency)}</dd></div>
							<div><dt>Paying account</dt><dd>{policy.debtor.name} <span className="mono muted">{iban(policy.debtor.iban)}</span></dd></div>
						</dl>
						<div style={{ display: "grid", gap: 8 }}>
							<div className="sub-h">A person must approve when</div>
							<ul className="rules">{policy.requireHumanWhen.map((r) => <li key={r}><Minus size={14} />{r}</li>)}</ul>
						</div>
						<div style={{ display: "grid", gap: 8 }}>
							<div className="sub-h">Rejected outright when</div>
							<ul className="rules">{policy.rejectWhen.map((r) => <li key={r}><Minus size={14} />{r}</li>)}</ul>
						</div>
						<p className="muted" style={{ fontSize: "var(--fs-12)" }}>Read-only here. The deterministic guard enforces these rules; the Policy agent can be stricter, never looser. Edit the file and restart to change them.</p>
					</div>
				</section>

				<section className="panel">
					<div className="panel-head"><h2>Vendor master</h2><span className="right mono">server/data/vendors.json</span></div>
					<div className="grid-table" style={{ ["--cols" as string]: "64px minmax(140px, 1fr) minmax(200px, 1.2fr)" }}>
						<div className="tr h"><span>Id</span><span>Vendor</span><span>IBAN on file</span></div>
						{vendors.map((v) => (
							<div className="tr" key={v.id}>
								<span className="t">{v.id}</span>
								<span style={{ fontWeight: 500 }}>{v.name} <span className="muted" style={{ fontWeight: 400 }}>{v.country}</span></span>
								<span className="mono wide">{iban(v.iban)}</span>
							</div>
						))}
					</div>
					<div className="panel-body muted" style={{ borderTop: "1px solid var(--line)", fontSize: "var(--fs-12)" }}>Synthetic vendors with valid test IBANs. Read-only here.</div>
				</section>
			</div>
		</main>
	)
}
