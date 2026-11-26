/**
 * The Financial Stress Lab on the server: a queue of scenario runs, each in its own worker process, with bounded
 * concurrency, a timeout per scenario, one active run at a time, and results that are only ever what a run recorded.
 */
import { fork, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Configuration, PaymentCase } from "../domain.js"
import { nowIso } from "../domain.js"
import { loadHistory, loadPolicy, loadPurchaseOrders, loadVendors } from "../data.js"
import { DeskError, MODELS } from "../desk.js"
import { parseMoney } from "../money.js"
import { METRIC_NOTES, metricsOf } from "./metrics.js"
import { documentsOf, policyVersion } from "./run.js"
import type { BenchmarkView, LabDetail, LabItemView, LabMode, LabOverview, LabScenarioView, ScenarioResult } from "./types.js"
import { LAB_SCENARIOS, scenarioById, type LabScenario } from "./scenarios.js"

export type LabItem = { key: string; scenarioId: string; config: Configuration; status: "queued" | "running" | "pass" | "fail" | "error" | "cancelled"; startedAt: string | null; finishedAt: string | null; error: string | null; result: ScenarioResult | null }
export type LabRun = { id: string; kind: "scenario" | "suite" | "benchmark"; mode: LabMode; createdAt: string; finishedAt: string | null; status: "running" | "done" | "cancelled"; items: LabItem[] }

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, "..", "..")
const FILE = process.env.LAB_RESULTS_FILE ?? join(ROOT, ".lab-results.json")
const PERSIST = process.env.LAB_PERSIST !== "off"
export const LIMITS = { concurrency: { scripted: 4, live: 3 }, timeoutMs: { scripted: 30_000, live: 240_000 }, maxItems: 24, keptRuns: 6 }

let runs: LabRun[] = []
const progress = new Map<string, PaymentCase[]>()
const children = new Map<string, ChildProcess>()

if (PERSIST && existsSync(FILE)) {
	try {
		runs = JSON.parse(readFileSync(FILE, "utf8")).runs ?? []
		// A worker cannot survive a restart: whatever was in flight is recorded as cancelled, never as a result.
		for (const r of runs) if (r.status === "running") { r.status = "cancelled"; r.finishedAt = nowIso(); for (const i of r.items) if (i.status === "queued" || i.status === "running") { i.status = "cancelled"; i.error = "the server restarted" } }
	} catch (err) { console.error("could not read saved lab results:", err) }
}
function save() {
	if (!PERSIST) return
	try { writeFileSync(`${FILE}.tmp`, JSON.stringify({ v: 1, runs })); renameSync(`${FILE}.tmp`, FILE) } catch (err) { console.error("could not save lab results:", err) }
}

const active = () => runs.find((r) => r.status === "running") ?? null
const keyOf = (scenarioId: string, config: Configuration) => `${scenarioId}:${config}`

function pump(run: LabRun) {
	if (run.status !== "running") return
	const running = run.items.filter((i) => i.status === "running").length
	const next = run.items.filter((i) => i.status === "queued").slice(0, Math.max(0, LIMITS.concurrency[run.mode] - running))
	for (const item of next) launch(run, item)
	if (run.items.every((i) => i.status !== "queued" && i.status !== "running")) {
		run.status = "done"
		run.finishedAt = nowIso()
		save()
	}
}

function launch(run: LabRun, item: LabItem) {
	item.status = "running"
	item.startedAt = nowIso()
	const id = `${run.id}/${item.key}`
	const job = { scenarioId: item.scenarioId, mode: run.mode, config: item.config, timeoutMs: LIMITS.timeoutMs[run.mode] }
	const child = fork(join(here, "worker.ts"), [JSON.stringify(job)], { cwd: ROOT, execArgv: ["--import", "tsx"], env: { ...process.env, DESK_PERSIST: "off" }, stdio: ["ignore", "inherit", "inherit", "ipc"] })
	children.set(id, child)
	const done = (status: LabItem["status"], error: string | null, result: ScenarioResult | null) => {
		if (item.status !== "running") return
		clearTimeout(timer)
		item.status = status
		item.error = error
		item.result = result
		item.finishedAt = nowIso()
		children.delete(id)
		progress.delete(id)
		save()
		pump(run)
	}
	// A worker that outlives its scenario's own timeout is killed; the item is an error, not a verdict.
	const timer = setTimeout(() => { child.kill("SIGKILL"); done("error", `The scenario did not finish within ${Math.round((job.timeoutMs + 15_000) / 1000)} s and its worker was stopped.`, null) }, job.timeoutMs + 15_000)
	child.on("message", (m: { type: string; cases?: PaymentCase[]; result?: ScenarioResult; error?: string }) => {
		if (m.type === "progress" && m.cases) progress.set(id, m.cases)
		else if (m.type === "result" && m.result) done(m.result.status, m.result.error, m.result)
		else if (m.type === "failed") done("error", m.error ?? "the worker failed", null)
	})
	child.on("exit", (code) => done("error", `The worker process ended without a result (exit code ${code}).`, null))
	child.on("error", (err) => done("error", `The worker process could not start: ${err.message}`, null))
}

export function startRun(input: { kind?: unknown; mode?: unknown; scenarioIds?: unknown; confirmLive?: unknown }, hasKey: boolean): LabRun {
	const kind = input.kind === "benchmark" ? "benchmark" : input.kind === "suite" ? "suite" : "scenario"
	const mode: LabMode = input.mode === "live" ? "live" : "scripted"
	if (active()) throw new DeskError(409, "A stress run is already in progress. Wait for it to finish or cancel it.")
	if (kind === "benchmark" && mode !== "live") throw new DeskError(400, "The benchmark compares what language models do, so it only runs with live models. The scripted model replays a fixed reading and would make both configurations look identical.")
	if (mode === "live" && !hasKey) throw new DeskError(503, "A live run needs a model API key. Copy .env.example to .env, set ANTHROPIC_API_KEY (or OPENAI_API_KEY / GEMINI_API_KEY with matching FAST_MODEL and CAREFUL_MODEL), and restart. The deterministic path needs no key.")
	if (mode === "live" && input.confirmLive !== true) throw new DeskError(400, "A live run spends API credit. Confirm it explicitly.")
	const wanted = Array.isArray(input.scenarioIds) && input.scenarioIds.length ? input.scenarioIds.map(String) : LAB_SCENARIOS.map((s) => s.id)
	const scenarios = wanted.map((id) => { const s = scenarioById(id); if (!s) throw new DeskError(404, `There is no scenario "${id}".`); return s }).filter((s) => kind !== "benchmark" || s.benchmark)
	if (kind === "scenario" && scenarios.length !== 1) throw new DeskError(400, "Run one scenario, or the whole suite.")
	const configs: Configuration[] = kind === "benchmark" ? ["single", "multi"] : ["multi"]
	const items: LabItem[] = configs.flatMap((config) => scenarios.map((s) => ({ key: keyOf(s.id, config), scenarioId: s.id, config, status: "queued" as const, startedAt: null, finishedAt: null, error: null, result: null })))
	if (items.length === 0) throw new DeskError(400, "Nothing to run.")
	if (items.length > LIMITS.maxItems) throw new DeskError(400, `A run is limited to ${LIMITS.maxItems} scenario executions.`)
	const run: LabRun = { id: `lab_${randomUUID().slice(0, 8)}`, kind, mode, createdAt: nowIso(), finishedAt: null, status: "running", items }
	runs = [run, ...runs].slice(0, LIMITS.keptRuns)
	pump(run)
	return run
}

export function cancelRun(): LabRun | null {
	const run = active()
	if (!run) return null
	run.status = "cancelled"
	run.finishedAt = nowIso()
	for (const item of run.items) {
		if (item.status !== "queued" && item.status !== "running") continue
		children.get(`${run.id}/${item.key}`)?.kill("SIGKILL")
		children.delete(`${run.id}/${item.key}`)
		progress.delete(`${run.id}/${item.key}`)
		item.status = "cancelled"
		item.error = "cancelled by the user"
		item.finishedAt = nowIso()
	}
	save()
	return run
}

const slim = (i: LabItem): LabItemView => ({
	key: i.key, scenarioId: i.scenarioId, config: i.config, status: i.status, startedAt: i.startedAt, finishedAt: i.finishedAt, error: i.error,
	result: i.result ? { durationMs: i.result.durationMs, checks: i.result.checks.length, passed: i.result.checks.filter((k) => k.pass).length, docs: i.result.docs, loops: i.result.loops, peakParallel: i.result.peakParallel, tokens: i.result.tokens, integrity: i.result.integrity, recovery: i.result.recovery } : null,
})

function describe(s: LabScenario): LabScenarioView {
	const vendors = loadVendors().filter((v) => s.trusted.vendors.includes(v.id))
	const base = loadPolicy()
	const budget = s.policy.dailyAutoApproveBudget ? parseMoney(s.policy.dailyAutoApproveBudget) : null
	const policy = budget != null ? { ...base, dailyAutoApproveBudget: budget } : base
	return {
		...s,
		sources: documentsOf(s).map((d, i) => ({ id: d.id, fileName: d.fileName, from: s.documents[i]!.from, note: s.documents[i]!.note ?? null, hash: d.hash, text: d.text })),
		records: { vendors, history: loadHistory().filter((h) => s.trusted.vendors.includes(h.vendorId)), purchaseOrders: loadPurchaseOrders().filter((p) => s.trusted.purchaseOrders.includes(p.po)) },
		policyApplied: { name: policy.name, currency: policy.currency, autoApproveLimit: policy.autoApproveLimit, dailyAutoApproveBudget: policy.dailyAutoApproveBudget, overridden: Object.keys(s.policy), version: policyVersion(policy), rules: policy.rules },
	}
}
const SCENARIO_VIEWS = LAB_SCENARIOS.map(describe)

function benchmarkView(): BenchmarkView | null {
	const run = runs.find((r) => r.kind === "benchmark" && r.status === "done")
	if (!run) return null
	const results = run.items.flatMap((i) => (i.result ? [i.result] : []))
	return {
		runId: run.id, createdAt: run.createdAt, finishedAt: run.finishedAt, mode: run.mode,
		single: metricsOf(results, "single"), multi: metricsOf(results, "multi"), notes: METRIC_NOTES,
		scenarios: [...new Set(run.items.map((i) => i.scenarioId))].map((id) => ({ scenarioId: id, single: slim(run.items.find((i) => i.key === keyOf(id, "single"))!), multi: slim(run.items.find((i) => i.key === keyOf(id, "multi"))!) })),
	}
}

export function overview(hasKey: boolean): LabOverview {
	return {
		scenarios: SCENARIO_VIEWS,
		runs: runs.map((r) => ({ id: r.id, kind: r.kind, mode: r.mode, createdAt: r.createdAt, finishedAt: r.finishedAt, status: r.status, items: r.items.map(slim) })),
		active: active()?.id ?? null,
		benchmark: benchmarkView(),
		live: { available: hasKey, models: MODELS, baselineModel: MODELS.careful },
		limits: LIMITS,
	}
}

function find(runId: string, key: string) {
	const run = runs.find((r) => r.id === runId)
	const item = run?.items.find((i) => i.key === key)
	if (!run || !item) throw new DeskError(404, "There is no such scenario run.")
	return { run, item }
}

/** The full record of one scenario execution: the final result, or the cases as they stand while it is still running. */
export function detail(runId: string, key: string): LabDetail {
	const { run, item } = find(runId, key)
	const { result: _summary, ...head } = slim(item)
	return { runId: run.id, mode: run.mode, kind: run.kind, item: head, result: item.result, cases: item.result?.cases ?? progress.get(`${run.id}/${key}`) ?? [] }
}

/** A structured audit report of a run, or of one scenario execution in it. */
export function report(runId: string, key: string | null) {
	const run = runs.find((r) => r.id === runId)
	if (!run) throw new DeskError(404, "There is no such run.")
	const items = key ? [find(runId, key).item] : run.items
	return {
		report: "Payment Desk · Financial Stress Lab audit report",
		notice: "SYNTHETIC DATA, SANDBOX OUTPUT. No real company, account or payment is involved, and nothing was sent to a bank. Not financial advice.",
		generatedAt: nowIso(),
		run: { id: run.id, kind: run.kind, mode: run.mode, modelPath: run.mode === "live" ? "live models through the Mozaik runtime" : "scripted model on the Mozaik runtime (fixed agent output)", createdAt: run.createdAt, finishedAt: run.finishedAt, status: run.status },
		executions: items.map((i) => {
			const s = SCENARIO_VIEWS.find((v) => v.id === i.scenarioId)!
			const r = i.result
			return {
				scenario: { id: s.id, name: s.name, problem: s.problem, faultInjection: s.fault?.label ?? null },
				configuration: i.config === "single" ? "single-agent baseline" : "multi-agent workflow",
				testStatus: i.status, error: i.error, startedAt: i.startedAt, finishedAt: i.finishedAt,
				sourceDocuments: s.sources.map((d) => ({ id: d.id, fileName: d.fileName, syntheticSource: `server/data/documents/${d.from}.txt`, contentHash: d.hash, text: d.text })),
				trustedRecords: { vendors: s.records.vendors.map((v) => ({ ref: `V:${v.id}`, ...v })), paymentHistory: s.records.history.map((h) => ({ ref: `H:${h.id}`, ...h })), purchaseOrders: s.records.purchaseOrders.map((p) => ({ ref: `PO:${p.po}`, ...p })) },
				policy: { version: r?.policyVersion ?? s.policyApplied.version, overriddenForThisScenario: s.policyApplied.overridden, autoApproveLimitMinor: s.policyApplied.autoApproveLimit, dailyAutoApproveBudgetMinor: s.policyApplied.dailyAutoApproveBudget, rules: s.policyApplied.rules },
				expectedOutcome: s.expected,
				actualOutcome: r ? r.docs : null,
				checks: r?.checks ?? [],
				recovery: r?.recovery ?? null,
				cases: (r?.cases ?? []).map((c) => ({
					caseId: c.id, contentHash: c.hash, finalState: c.stage,
					deterministicEnforcement: c.decision.result ? { agentRecommended: c.decision.result.recommended?.disposition ?? null, controlsAllow: c.decision.result.floor, inForce: c.decision.result.final, agentOverridden: c.decision.result.overridden } : null,
					controls: c.controls,
					agentExecutions: c.runs.map((x) => ({ executionId: x.id ?? null, agent: x.agent, model: x.model, attempt: x.attempt, startedAt: x.startedAt, finishedAt: x.finishedAt, durationMs: x.finishedAt ? Date.parse(x.finishedAt) - Date.parse(x.startedAt) : null, status: x.status, retries: x.retry, trigger: x.trigger, tokens: x.tokens, error: x.error })),
					structuredFindings: { reading: c.extraction.result, validation: c.validation.result, independentReading: c.audit.result, investigation: c.investigation.result, recommendation: c.decision.result?.recommended ?? null },
					evidenceLedger: c.ledger,
					evidenceIntegrity: c.integrity ?? null,
					sharedStateWrites: c.version,
					review: c.review, draft: c.draft, timeline: c.timeline,
				})),
				execution: r ? { durationMs: r.durationMs, loops: r.loops, peakParallel: r.peakParallel, tokens: r.tokens, models: r.models } : null,
				knownLimitations: r?.limitations ?? ["This execution produced no result."],
			}
		}),
	}
}
