/**
 * Types of the Financial Stress Lab, shared by the server and the web UI. Types only: importing this file pulls in no code.
 */
import type { Configuration, IntegrityCounts, PaymentCase, Policy, PolicyRule, SourceDocument, Vendor, HistoricalPayment, PurchaseOrder } from "../domain.js"
import type { LabOutcome, LabScenario } from "./scenarios.js"

export type LabMode = "scripted" | "live"

export type Check = { kind: "outcome" | "control" | "evidence" | "invariant" | "integrity"; label: string; doc: string | null; expected: string; actual: string; pass: boolean; refs: string[] }

export type DocMetric = {
	doc: string
	expected: LabOutcome[]
	final: string
	/** What the recommending agent said before enforcement. null: no agent recommended (stopped at intake, or the run failed first). */
	recommended: string | null
	floor: string | null
	correct: boolean
	/** Critical fields compared with the hand-written reference reading. null in scripted mode, where the model replays that reference. */
	fields: { compared: number; matching: number; wrong: string[] } | null
}

export type ScenarioResult = {
	scenarioId: string
	config: Configuration
	mode: LabMode
	status: "pass" | "fail" | "error"
	error: string | null
	startedAt: string
	finishedAt: string
	durationMs: number
	checks: Check[]
	docs: DocMetric[]
	cases: PaymentCase[]
	documents: SourceDocument[]
	policy: Policy
	policyVersion: string
	models: Record<string, string>
	fault: string | null
	recovery: { outcome: string; afterMs: number } | null
	loops: number
	peakParallel: number
	/** Sum of what the provider reported. null when no loop reported usage; never shown as zero. */
	tokens: { input: number; output: number; reportedLoops: number } | null
	integrity: IntegrityCounts
	limitations: string[]
}

export type Ratio = { n: number; of: number } | null

export type ConfigMetrics = {
	config: Configuration
	scenarios: number
	/** Scenarios that produced no verdict (provider failure, timeout). They are excluded from every ratio below. */
	errored: number
	documents: number
	scenariosPassed: Ratio
	correctDecisions: Ratio
	unsafeRecommendations: Ratio
	unsafeEnforced: Ratio
	legitimateBlocked: Ratio
	criticalFields: Ratio
	controlsDetected: Ratio
	evidencePresent: Ratio
	evidenceCorrect: Ratio
	disagreements: number | null
	loops: number
	durationMs: number
	tokens: number | null
}


// ───────── what the HTTP API returns ─────────

export type ItemStatus = "queued" | "running" | "pass" | "fail" | "error" | "cancelled"
/** One scenario execution without its cases: enough for lists and the benchmark table. */
export type LabItemView = {
	key: string; scenarioId: string; config: Configuration; status: ItemStatus; startedAt: string | null; finishedAt: string | null; error: string | null
	result: { durationMs: number; checks: number; passed: number; docs: DocMetric[]; loops: number; peakParallel: number; tokens: ScenarioResult["tokens"]; integrity: IntegrityCounts; recovery: ScenarioResult["recovery"] } | null
}
export type LabRunView = { id: string; kind: "scenario" | "suite" | "benchmark"; mode: LabMode; createdAt: string; finishedAt: string | null; status: "running" | "done" | "cancelled"; items: LabItemView[] }
export type LabScenarioView = LabScenario & {
	sources: { id: string; fileName: string; from: string; note: string | null; hash: string; text: string }[]
	records: { vendors: Vendor[]; history: HistoricalPayment[]; purchaseOrders: PurchaseOrder[] }
	policyApplied: { name: string; currency: string; autoApproveLimit: number; dailyAutoApproveBudget: number; overridden: string[]; version: string; rules: PolicyRule[] }
}
export type BenchmarkView = {
	runId: string; createdAt: string; finishedAt: string | null; mode: LabMode
	single: ConfigMetrics; multi: ConfigMetrics; notes: Record<string, string>
	scenarios: { scenarioId: string; single: LabItemView; multi: LabItemView }[]
}
export type LabOverview = {
	scenarios: LabScenarioView[]
	runs: LabRunView[]
	active: string | null
	benchmark: BenchmarkView | null
	live: { available: boolean; models: { fast: string; careful: string }; baselineModel: string }
	limits: { concurrency: Record<LabMode, number>; timeoutMs: Record<LabMode, number>; maxItems: number; keptRuns: number }
}
export type LabDetail = { runId: string; mode: LabMode; kind: LabRunView["kind"]; item: Omit<LabItemView, "result">; result: ScenarioResult | null; cases: PaymentCase[] }
