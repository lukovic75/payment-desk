/**
 * Runs one stress scenario through the real workflow and judges it against what the scenario declared beforehand.
 *
 * This module drives the desk singleton, so whoever calls it must own the process: the lab forks one worker process per
 * scenario (server/lab/worker.ts), the tests and the CLI call it directly in their own process. Either way the payment
 * inbox of the running app is never touched.
 */
import { createHash } from "node:crypto"
import type { Configuration, Control, IntegrityReport, Minor, PaymentCase, Policy, Reading, ReadingField, SourceDocument } from "../domain.js"
import { outcomeOf } from "../domain.js"
import { contentHash, loadDocuments } from "../data.js"
import * as desk from "../desk.js"
import { buildReading, matchVendor } from "../firewall.js"
import { integrityCounts } from "../integrity.js"
import { formatMinor, parseMoney } from "../money.js"
import type { Invariant, LabOutcome, LabScenario } from "./scenarios.js"
import type { Check, DocMetric, LabMode, ScenarioResult } from "./types.js"

export type { Check, DocMetric, LabMode, ScenarioResult } from "./types.js"

const DOCS = Object.fromEntries(loadDocuments().map((d) => [d.id, d]))
const PROVIDER_FAILURE = /credit balance|api[_ -]?key|authentication|unauthori[sz]ed|\b40[13]\b|\b429\b|rate.?limit|overloaded|ECONN|ENOTFOUND|fetch failed|network/i

export const policyVersion = (p: Policy) => `${p.name} · sha256:${createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 12)}`

/** The documents of a scenario as they enter the sandbox. A copy keeps the text, and so the content hash, of its source. */
export function documentsOf(s: LabScenario): SourceDocument[] {
	return s.documents.map((d, i) => {
		const src = DOCS[d.from]
		if (!src) throw new Error(`scenario ${s.id}: no synthetic document "${d.from}"`)
		return { id: d.id, fileName: `${d.id}.txt`, text: src.text, hash: contentHash(src.text), receivedAt: new Date(Date.parse("2026-11-26T08:00:00Z") + i * 60_000).toISOString() }
	})
}

const peakOf = (cases: PaymentCase[]) => {
	const edges: [number, number][] = []
	for (const c of cases) for (const r of c.runs) { if (!r.finishedAt) continue; edges.push([Date.parse(r.startedAt), 1], [Date.parse(r.finishedAt), -1]) }
	edges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
	let live = 0, peak = 0
	for (const [, d] of edges) { live += d; if (live > peak) peak = live }
	return peak
}

/** Compares what an agent read with the hand-written reference reading of the same synthetic document. */
function fieldAccuracy(c: PaymentCase, from: string, doc: SourceDocument, gold: Record<string, unknown>): DocMetric["fields"] {
	const reference = gold[from]
	const x = c.extraction.result
	if (!reference || !x) return null
	const want: Reading = buildReading(reference as never, doc, "Extractor").reading
	const vendors = desk.snapshot().vendors
	const alnum = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
	const fields: ReadingField[] = ["creditorName", "invoiceNumber", "currency", "gross", "iban"]
	const wrong: string[] = []
	let compared = 0
	for (const f of fields) {
		if (want[f] == null) continue
		compared++
		const same = f === "creditorName" ? (matchVendor(String(want[f]), vendors).vendor?.id ?? alnum(want[f])) === (matchVendor(String(x[f] ?? ""), vendors).vendor?.id ?? alnum(x[f]))
			: typeof want[f] === "number" ? want[f] === x[f] : alnum(want[f]) === alnum(x[f])
		if (!same) wrong.push(f)
	}
	return { compared, matching: compared - wrong.length, wrong }
}

/** Judges the final state of a scenario against its declared expectations. Pure: no model, no clock. */
export function judge(s: LabScenario, cases: PaymentCase[], config: Configuration, policy: Policy, recovery: ScenarioResult["recovery"]): Check[] {
	const checks: Check[] = []
	const by = Object.fromEntries(cases.map((c) => [c.id, c]))
	const flagged = (r: IntegrityReport | undefined, ref: string) => r?.findings.some((f) => f.ref === ref) ?? false

	for (const [doc, allowed] of Object.entries(s.expected.outcomes)) {
		const c = by[doc]
		const actual = c ? outcomeOf(c) : "missing from the sandbox"
		checks.push({ kind: "outcome", label: "Final decision", doc, expected: allowed.join(" or "), actual, pass: allowed.includes(actual as LabOutcome), refs: c?.exposure ? [c.exposure.ref] : [] })
	}
	for (const k of s.expected.controls) {
		if (k.multiOnly && config === "single") continue
		const control: Control | undefined = by[k.doc]?.controls.find((x) => x.id === k.control)
		checks.push({ kind: "control", label: `Control "${control?.label ?? k.control}": ${k.why}`, doc: k.doc, expected: k.status.join(" or "), actual: control?.status ?? "not evaluated", pass: !!control && k.status.includes(control.status), refs: control?.refs ?? [] })
	}
	for (const e of s.expected.evidence) {
		if (e.ref.startsWith("C:compare") && config === "single") continue
		const c = by[e.doc]
		const ids = c ? Object.keys(c.ledger).filter((id) => (e.ref.endsWith(":") ? id.startsWith(e.ref) : id === e.ref)) : []
		const bad = ids.filter((id) => flagged(c?.integrity, id))
		checks.push({ kind: "evidence", label: `Evidence ${e.ref}${e.ref.endsWith(":") ? "…" : ""}: ${e.why}`, doc: e.doc, expected: "in the ledger and verified against its source", actual: ids.length === 0 ? "not in the ledger" : bad.length ? `in the ledger, but verification failed for ${bad.join(", ")}` : "in the ledger and verified", pass: ids.length > 0 && bad.length === 0, refs: ids })
	}

	const auto = cases.filter((c) => outcomeOf(c) === "AUTO_APPROVED")
	const invariant = (id: Invariant, label: string, expected: string, actual: string, pass: boolean, refs: string[] = []) => checks.push({ kind: "invariant", label, doc: null, expected, actual, pass, refs })
	for (const inv of s.expected.invariants) {
		if (inv === "draft_for_every_approval") {
			const wrong = cases.filter((c) => (c.stage === "approved") !== (c.draft != null)).map((c) => c.id)
			invariant(inv, "A sandbox draft exists for every approved payment and for nothing else", "drafts match approvals", wrong.length ? `mismatch on ${wrong.join(", ")}` : `${cases.filter((c) => c.draft).length} draft(s), ${cases.filter((c) => c.stage === "approved").length} approval(s)`, wrong.length === 0)
		} else if (inv === "never_auto_approved") {
			invariant(inv, "Nothing in this scenario is approved without a person", "0 automatic approvals", `${auto.length} automatic approval(s)`, auto.length === 0)
		} else if (inv === "single_authorisation") {
			const authorised = cases.filter((c) => c.stage === "approved")
			invariant(inv, "The invoice is authorised exactly once", "1 authorisation", `${authorised.length} authorisation(s)`, authorised.length === 1)
		} else if (inv === "daily_budget_respected") {
			const total = auto.reduce((sum: Minor, c) => sum + (c.exposure?.minor ?? 0), 0)
			const held = cases.filter((c) => outcomeOf(c) === "NEEDS_APPROVAL" && c.controls.some((k) => k.id === "daily_limit" && k.status === "review"))
			invariant(inv, "The automatically approved total stays within the daily budget", `at most ${formatMinor(policy.dailyAutoApproveBudget, policy.currency)}, and at least one request held on the daily budget`, `${formatMinor(total, policy.currency)} approved automatically, ${held.length} held on the daily budget`, total <= policy.dailyAutoApproveBudget && held.length >= 1, auto.flatMap((c) => (c.exposure ? [c.exposure.ref] : [])))
		} else if (inv === "investigator_called") {
			if (config === "single") continue
			const called = cases.filter((c) => c.runs.some((r) => r.agent === "Investigator"))
			invariant(inv, "The exception was sent to the Investigator", "an Investigator loop on the case", called.length ? `Investigator ran on ${called.map((c) => c.id).join(", ")}` : "no Investigator loop", called.length > 0)
		} else if (inv === "recoverable") {
			invariant(inv, "With the fault removed, running the document again reaches a decision", "a decision (not a processing error)", recovery ? recovery.outcome : "not attempted", !!recovery && !["PROCESSING_ERROR", "PROCESSING"].includes(recovery.outcome))
		}
	}

	const broken = auto.filter((c) => !c.integrity?.ok).map((c) => c.id)
	checks.push({ kind: "integrity", label: "No payment was approved on evidence that fails re-verification", doc: null, expected: "every critical value of an approved payment verifies", actual: broken.length ? `critical findings on ${broken.join(", ")}` : `${auto.length} approved payment(s), 0 critical findings`, pass: broken.length === 0, refs: [] })
	return checks
}

export async function runScenario(s: LabScenario, opts: { mode: LabMode; config: Configuration; timeoutMs: number; onProgress?: (cases: PaymentCase[]) => void }): Promise<ScenarioResult> {
	const started = Date.now()
	const startedAt = new Date(started).toISOString()
	desk.resetDesk()
	desk.setConfiguration(opts.config)
	const budget = s.policy.dailyAutoApproveBudget ? parseMoney(s.policy.dailyAutoApproveBudget) : null
	if (budget != null) desk.setPolicy({ dailyAutoApproveBudget: budget })

	let gold: Record<string, unknown> = {}
	try { gold = (await import("../test/fixtures.js")).READINGS } catch { /* reference readings are optional */ }
	if (opts.mode === "scripted") {
		const { scriptedModel } = await import("../test/scripted.js")
		// The scripted Policy agent recommends approval for everything, on purpose: a pass then means the controls held without help.
		desk.setModelRunner(scriptedModel({ readings: Object.fromEntries(s.documents.map((d) => [d.id, gold[d.from]]).filter(([, r]) => r)) as never, policy: "AUTO_APPROVED" }), "scripted")
	}
	// A fault aimed at an agent the baseline does not have is aimed at its one agent instead.
	const fault = s.fault ? { agent: opts.config === "single" ? ("Solo" as const) : s.fault.agent, kind: s.fault.kind } : null
	desk.setFault(fault)

	const documents = documentsOf(s)
	const progress = opts.onProgress ? setInterval(() => opts.onProgress!(desk.snapshot().cases), 350) : undefined
	let error: string | null = null
	let recovery: ScenarioResult["recovery"] = null
	try {
		for (const d of documents) desk.addDocument(d.id, d.text, "demo", d.receivedAt)
		await desk.whenSettled(opts.timeoutMs)
		if (s.expected.invariants.includes("recoverable")) {
			const failed = desk.snapshot().cases.find((c) => outcomeOf(c) === "PROCESSING_ERROR")
			if (failed) {
				const t = Date.now()
				// Judge the failed state first, then show that it can be recovered.
				const frozen = structuredClone(desk.snapshot().cases)
				desk.setFault(null)
				desk.act(failed.id, "reprocess", { reason: "Stress Lab: fault removed, running the document again" })
				await desk.whenSettled(opts.timeoutMs)
				recovery = { outcome: outcomeOf(desk.peek(failed.id)), afterMs: Date.now() - t }
				return finish(frozen)
			}
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err)
	} finally {
		clearInterval(progress)
		desk.setFault(null)
	}
	return finish(structuredClone(desk.snapshot().cases))

	function finish(cases: PaymentCase[]): ScenarioResult {
		const policy = desk.snapshot().policy
		const checks = judge(s, cases, opts.config, policy, recovery)
		const byId = Object.fromEntries(cases.map((c) => [c.id, c]))
		const docs: DocMetric[] = s.documents.map((d) => {
			const c = byId[d.id]
			const final = c ? outcomeOf(c) : "missing"
			const allowed = s.expected.outcomes[d.id] ?? []
			return {
				doc: d.id, expected: allowed, final, recommended: c?.decision.result?.recommended?.disposition ?? null, floor: c?.decision.result?.floor ?? null, correct: allowed.includes(final as LabOutcome),
				fields: opts.mode === "live" && c ? fieldAccuracy(c, d.from, documents.find((x) => x.id === d.id)!, gold) : null,
			}
		})
		// A provider failure the scenario did not ask for says nothing about the system under test: report it as an error, not a verdict.
		const unexpected = cases.filter((c) => outcomeOf(c) === "PROCESSING_ERROR" && !(s.expected.outcomes[c.id] ?? []).includes("PROCESSING_ERROR"))
		const provider = unexpected.flatMap((c) => c.runs.map((r) => r.error ?? "")).find((e) => PROVIDER_FAILURE.test(e) && !e.startsWith("fault injection"))
		if (!error && provider) error = `The model provider failed, so this run says nothing about the scenario: ${provider.slice(0, 240)}`
		const runs = cases.flatMap((c) => c.runs)
		const reported = runs.filter((r) => r.tokens)
		const finishedAt = new Date().toISOString()
		return {
			scenarioId: s.id, config: opts.config, mode: opts.mode,
			status: error ? "error" : checks.every((k) => k.pass) ? "pass" : "fail",
			error, startedAt, finishedAt, durationMs: Date.now() - started,
			checks, docs, cases, documents, policy, policyVersion: policyVersion(policy),
			models: Object.fromEntries(runs.map((r) => [r.agent, r.model])),
			fault: s.fault?.label ?? null, recovery,
			loops: runs.length, peakParallel: peakOf(cases),
			tokens: reported.length ? { input: reported.reduce((n, r) => n + r.tokens!.input, 0), output: reported.reduce((n, r) => n + r.tokens!.output, 0), reportedLoops: reported.length } : null,
			integrity: integrityCounts(cases.flatMap((c) => (c.integrity ? [c.integrity] : []))),
			limitations: [
				"All documents, vendors, accounts and payments are synthetic. Nothing was sent to a bank.",
				opts.mode === "scripted" ? "Scripted model: the agents' words are a fixed fixture (server/test/fixtures.ts). This run exercises the Mozaik workflow, the controls and enforcement, not a language model." : "Live models are non-deterministic: a repeat of this run can word things differently, and can differ where an agent is stricter than the controls require.",
				...(s.fault ? [s.fault.label] : []),
				...(opts.config === "single" ? ["Single-agent baseline: one agent with the same document, trusted records, controls and enforcement, and no independent second reading."] : []),
			],
		}
	}
}
