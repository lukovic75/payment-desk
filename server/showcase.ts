/**
 * The interactive showcase: four synthetic scenarios (and one optional one), each run through the same workflow as any
 * other document. Nothing here decides anything. A scenario's result is read from its payment case: the outcome the
 * controls enforced, compared with what the scenario file expects.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { DATA_DIR, contentHash, loadDocuments } from "./data.js"
import type { PaymentCase, Recording, Scenario, ShowcaseKey, ShowcaseStep } from "./domain.js"

/** The curated sequence. Every document is one of the existing synthetic fixtures in data/documents. */
export const SHOWCASE: { key: ShowcaseKey; docId: string; optional: boolean }[] = [
	{ key: "legitimate", docId: "INV-2026-1041", optional: false },
	{ key: "beneficiary", docId: "INV-ES-55820", optional: false },
	{ key: "challenge", docId: "INV-2026-1049", optional: false },
	{ key: "duplicate", docId: "INV-7701-rappel", optional: false },
	{ key: "injection", docId: "INV-ADR-0101", optional: true },
]

const RUNNING = new Set(["received", "extracting", "checking", "investigating", "deciding"])

/** What the workflow itself decided, before any person acted on it. Null when it never reached a decision. */
export function enforcedOutcome(c: PaymentCase): string | null {
	if (c.stage === "not_a_payment") return "NOT_A_PAYMENT"
	return c.decision.result?.final ?? null
}

export const blankSteps = (scenarios: Scenario[]): ShowcaseStep[] =>
	SHOWCASE.map((s) => ({ ...s, expected: scenarios.find((k) => k.docId === s.docId)?.expect ?? [], startedAt: null, result: "not_run", actual: null }))

/** Each step with its result read from the case as it stands. A failed run is failed, never confirmed. */
export function refreshSteps(steps: ShowcaseStep[], find: (docId: string) => PaymentCase | undefined): ShowcaseStep[] {
	return steps.map((s) => {
		const c = s.startedAt ? find(s.docId) : undefined
		if (!c) return { ...s, result: "not_run", actual: null }
		if (RUNNING.has(c.stage)) return { ...s, result: "running", actual: null }
		const actual = enforcedOutcome(c)
		if (c.stage === "error" || actual == null || actual === "PROCESSING_ERROR") return { ...s, result: "failed", actual: "PROCESSING_ERROR" }
		return { ...s, result: s.expected.includes(actual) ? "confirmed" : "unexpected", actual }
	})
}

// ───────── recorded execution ─────────

const RECORDING_FILE = join(DATA_DIR, "recordings", "live-2026-11-26.json")
/** A stored run of the current version of the code, when one has been captured (see scripts/capture-recording.mjs). */
const CURRENT_RECORDING_FILE = join(DATA_DIR, "recordings", "current.json")
let recording: Recording | null | undefined
let current: Recording | null | undefined

function readRecording(file: string, id: "earlier" | "current", scenarios: Scenario[]): Recording | null {
	if (!existsSync(file)) return null
	const raw = JSON.parse(readFileSync(file, "utf8")) as { recordedAt: string; note: string; version?: string; models: Recording["models"]; cases: PaymentCase[] }
	const steps = blankSteps(scenarios).map((s) => {
		const c = raw.cases.find((k) => k.id === s.docId)
		return { ...s, startedAt: c?.runs[0]?.startedAt ?? null, fileName: c?.fileName }
	})
	return { id, recordedAt: raw.recordedAt, note: raw.note, version: raw.version ?? (id === "earlier" ? "earlier version of the code" : "this version of the code"), models: raw.models, cases: raw.cases, steps: refreshSteps(steps, (k) => raw.cases.find((c) => c.id === k)) }
}
/** The stored run of the current version, or null when none ships. Loaded once and never written; like the earlier one, it cannot be acted on. */
export function loadCurrentRecording(scenarios: Scenario[]): Recording | null {
	if (current !== undefined) return current
	current = null
	try { current = readRecording(CURRENT_RECORDING_FILE, "current", scenarios) } catch (err) { console.error("could not load the recorded execution of the current version:", err) }
	return current
}

/**
 * The stored cases of an earlier run with live models, for the showcase documents only. Loaded once and never written.
 * A recorded case is served as it was stored; it is not on the desk, cannot be acted on and starts no agent.
 */
export function loadRecording(scenarios: Scenario[]): Recording | null {
	if (recording !== undefined) return recording
	recording = null
	try {
		recording = readRecording(RECORDING_FILE, "earlier", scenarios)
	} catch (err) { console.error("could not load the recorded execution:", err) }
	return recording
}

/** The source text of a recorded case: the synthetic fixture, and only if it is byte-for-byte the document that was recorded. */
/**
 * Documents exactly as they were when a stored run read them, for the ones whose current file has changed since.
 * A stored run is never edited, so its replay needs the text it was recorded on (server/data/recordings/documents).
 */
function archivedDocuments(): { id: string; text: string }[] {
	const dir = join(DATA_DIR, "recordings", "documents")
	try { return readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => ({ id: f.replace(/\.txt$/, ""), text: readFileSync(join(dir, f), "utf8") })) } catch { return [] }
}

export function recordedDocumentText(id: string, scenarios: Scenario[], hash?: string | null, others: { id: string; text: string }[] = []): string | null {
	// the same document id can be in both stored runs with different text (once as text, once as the text of its PDF): the hash says which
	const cases = [loadRecording(scenarios), loadCurrentRecording(scenarios)].flatMap((r) => r?.cases ?? []).filter((k) => k.id === id && (!hash || k.hash === hash))
	for (const c of cases) {
		const d = [...loadDocuments(), ...archivedDocuments(), ...others].find((x) => x.id === id && contentHash(x.text) === c.hash)
		if (d) return d.text
	}
	return null
}
