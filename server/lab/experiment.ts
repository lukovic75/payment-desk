/**
 * Controlled architecture fault-injection test.
 *
 * Real Mozaik orchestration. Deliberately injected synthetic agent errors. NOT a language-model benchmark.
 *
 * The question it answers: when one agent is wrong, which component notices? Each case scripts one specific error into
 * one agent's answer and runs the same synthetic document, trusted records, policy, controls and enforcement twice:
 *   - "single": the one-agent baseline, which has no independent second reading;
 *   - "multi":  the five-agent workflow, where the Auditor reads the document without seeing the first reading.
 * Nothing is weakened in either configuration. What is reported is what the case state held after the run: the
 * decision in force, the controls that did not pass, the challenges and who raised them. Where the code controls
 * catch the error on their own, the result says so; that is not credited to the agents.
 *
 * This module drives the desk singleton, so the caller must own the process (the CLI, a worker, a test).
 */
import type { Challenge, Configuration, PaymentCase } from "../domain.js"
import { outcomeOf } from "../domain.js"
import { loadDocuments } from "../data.js"
import * as desk from "../desk.js"
import type { ReadingInput } from "../firewall.js"
import { formatMinor } from "../money.js"

export const EXPERIMENT_LABEL = "Controlled architecture fault-injection test. Real Mozaik orchestration. Deliberately injected synthetic agent errors."

type Outcome = ReturnType<typeof outcomeOf>
export type ExperimentCase = {
	id: string
	title: string
	/** The synthetic document in server/data/documents. */
	doc: string
	/** The agent whose answer is wrong, and in plain words what is wrong with it. */
	agent: "Extractor" | "Validator" | "Policy" | "Extractor and Auditor" | "none"
	injected: string
	/** The amount the document really asks for, as written in the reference reading. */
	correctAmount: string
	/** Declared before the run: the outcomes the five-agent workflow may end in. The baseline is observed, not prescribed. */
	expectMulti: Outcome[]
	/** The document is a copy whose total line is labelled in words the code's total-line detector does not know. */
	unlabelled?: boolean
	/** Both readers are given the same wrong reading: the second reading is not independent of the error. */
	both?: boolean
	/** A limit of the design, declared as one: this case is expected to get through, and the result says so. */
	knownLimit?: boolean
}

export type ExperimentSide = {
	config: Configuration
	outcome: Outcome
	/** What the Policy agent (or the single agent) recommended, and the strictest outcome the controls allow. */
	recommended: string | null
	floor: string | null
	/** The amount on the case, as the desk holds it. */
	amount: string | null
	/** True when the payment was approved without a person for an amount other than the one the document asks for. */
	wrongAmountApproved: boolean
	draft: boolean
	/** Controls that did not pass, as evaluated by code. */
	controls: { id: string; label: string; status: string }[]
	challenges: Pick<Challenge, "id" | "raisedBy" | "category" | "field" | "challenged" | "observed" | "status">[]
	/** Conflicts the independent Auditor reported itself (multi only). */
	auditorConflicts: number
	investigator: boolean
	loops: { agent: string; startedAt: string; finishedAt: string | null; status: string }[]
}

export type ExperimentRow = ExperimentCase & {
	single: ExperimentSide
	multi: ExperimentSide
	/** Derived from the two sides, never written by hand. */
	caughtBy: "nothing to catch" | "code controls, in both configurations" | "only the independent second reading" | "not caught"
	detail: string
	pass: boolean
}

export type ExperimentResult = {
	label: string
	ranAt: string
	durationMs: number
	policy: string
	rows: ExperimentRow[]
	summary: { injected: number; caughtByCodeInBoth: number; caughtOnlyBySecondReading: number; notCaught: number; baselineWrongApprovals: number; multiWrongApprovals: number }
	limitations: string[]
}

export const EXPERIMENT_CASES: ExperimentCase[] = [
	{ id: "F0", title: "Control: nothing injected", doc: "INV-2026-1041", agent: "none", injected: "No error. A valid invoice from a known vendor, read correctly.", correctAmount: "1415.00", expectMulti: ["AUTO_APPROVED"] },
	{ id: "F1", title: "Wrong amount, unsupported by its quote", doc: "INV-2026-1041", agent: "Extractor", injected: "The first reading reports 1,514.00 and cites the line that says 1,415.00.", correctAmount: "1415.00", expectMulti: ["BLOCKED", "NEEDS_APPROVAL"] },
	{ id: "F2", title: "A line item reported as the total", doc: "INV-2026-1041", agent: "Extractor", injected: "The first reading reports the freight line, 1,230.00, as the amount to pay, cites that line correctly, and leaves out the other line.", correctAmount: "1415.00", expectMulti: ["BLOCKED", "NEEDS_APPROVAL"] },
	{ id: "F7", title: "The same error where the total is labelled in words code does not know", doc: "INV-2026-1041", agent: "Extractor", injected: "As F2, on a copy of the invoice whose total line reads \"Razem\" instead of \"TOTAL\".", correctAmount: "1415.00", expectMulti: ["BLOCKED", "NEEDS_APPROVAL"], unlabelled: true },
	{ id: "F8", title: "Both readers make the same mistake", doc: "INV-2026-1041", agent: "Extractor and Auditor", injected: "Both readings report the freight line, 1,230.00, as the amount to pay. The second reading does not help.", correctAmount: "1415.00", expectMulti: ["BLOCKED", "NEEDS_APPROVAL"], both: true },
	{ id: "F9", title: "Both readers make the same mistake, and the total is labelled in words code does not know", doc: "INV-2026-1041", agent: "Extractor and Auditor", injected: "As F8, on the copy whose total line reads \"Razem\". Declared in advance as a limit of the design.", correctAmount: "1415.00", expectMulti: ["AUTO_APPROVED"], unlabelled: true, both: true, knownLimit: true },
	{ id: "F3", title: "A second payable amount is missed", doc: "INV-2026-1049", agent: "Extractor", injected: "The first reading reports the invoice total, 1,890.00, and says nothing about the 1,980.00 the cover text asks for.", correctAmount: "1890.00", expectMulti: ["BLOCKED", "NEEDS_APPROVAL"] },
	{ id: "F4", title: "Validator overlooks a changed bank account", doc: "INV-ES-55820", agent: "Validator", injected: "The Validator reports that the IBAN matches the vendor master. It does not.", correctAmount: "2744.00", expectMulti: ["BLOCKED"] },
	{ id: "F5", title: "Validator does not report an earlier payment", doc: "INV-7701-rappel", agent: "Validator", injected: "The Validator reports no duplicate. The invoice is already in the payment history.", correctAmount: "1120.00", expectMulti: ["BLOCKED"] },
	{ id: "F6", title: "Policy agent recommends approval of a blocked payment", doc: "INV-ES-55820", agent: "Policy", injected: "The recommendation is \"approve\" although the bank account is not the one on file.", correctAmount: "2744.00", expectMulti: ["BLOCKED"] },
]

const f = (value: string, quote: string) => ({ value, quote })
const TOTAL_LINE = "TOTAL EUR 1,415.00"
const UNKNOWN_LABEL_LINE = "Razem EUR 1,415.00"
const FREIGHT = "Freight Hamburg -> Belgrade, 3 pallets          3   410.00   1,230.00"

/** The scripted answers of one case. Only the injected part differs from the reference reading. */
function scriptOf(k: ExperimentCase, gold: Record<string, ReadingInput>) {
	const good = gold[k.doc]!
	const wrong = (fields: NonNullable<ReadingInput["fields"]>, lines = good.lines): ReadingInput => ({ ...good, fields: { ...good.fields, ...fields }, lines })
	const readings: Record<string, ReadingInput> =
		k.id === "F1" ? { [k.doc]: wrong({ gross: f("1514.00", "TOTAL EUR 1,415.00") }) }
		: ["F2", "F7", "F8", "F9"].includes(k.id) ? { [k.doc]: wrong({ gross: f("1230.00", FREIGHT), net: f("1230.00", FREIGHT) }, [{ label: "Freight", amount: "1230.00", quote: FREIGHT }]) }
		: { [k.doc]: good }
	const script = {
		readings,
		// The Auditor is never given the first reading. It reports what a careful reader finds in the document, except where a case gives both readers the same wrong reading on purpose.
		audits: { [k.doc]: k.both ? readings[k.doc]! : k.id === "F3" ? { ...good, conflicts: [{ field: "gross", values: ["1980.00", "1890.00"], quotes: ["please pay EUR 1,980.00 for the express shipment by the end of the week.", "TOTAL EUR 1,890.00"] }], summary: "The cover text asks for EUR 1,980.00; the invoice total is EUR 1,890.00." } : good },
		validations: k.id === "F4" ? { [k.doc]: { ibanMatchesMaster: true, issues: [], summary: "injected: reported as matching the vendor master" } } : undefined,
		// The scripted Policy agent recommends approval for everything, in every case: a restriction is never its merit.
		policy: "AUTO_APPROVED" as const,
	}
	// the copy with the unknown label: every quote of the total line follows the document
	return k.unlabelled ? (JSON.parse(JSON.stringify(script).replaceAll(TOTAL_LINE, UNKNOWN_LABEL_LINE)) as typeof script) : script
}

function sideOf(c: PaymentCase, config: Configuration, correctMinor: number | null): ExperimentSide {
	const outcome = outcomeOf(c)
	const approved = outcome === "AUTO_APPROVED"
	return {
		config, outcome,
		recommended: c.decision.result?.recommended?.disposition ?? null,
		floor: c.decision.result?.floor ?? null,
		amount: c.exposure ? formatMinor(c.exposure.minor, c.exposure.currency) : null,
		wrongAmountApproved: approved && correctMinor != null && c.exposure?.minor !== correctMinor,
		draft: c.draft != null,
		controls: c.controls.filter((x) => x.status === "fail" || x.status === "review").map((x) => ({ id: x.id, label: x.label, status: x.status })),
		challenges: (c.challenges ?? []).map(({ id, raisedBy, category, field, challenged, observed, status }) => ({ id, raisedBy, category, field, challenged, observed, status })),
		auditorConflicts: c.audit.result?.conflicts?.length ?? 0,
		investigator: c.runs.some((r) => r.agent === "Investigator"),
		loops: c.runs.map((r) => ({ agent: r.agent, startedAt: r.startedAt, finishedAt: r.finishedAt ?? null, status: r.status })),
	}
}

const names = (s: ExperimentSide) => s.controls.map((x) => `"${x.label}" ${x.status === "fail" ? "failed" : "needs review"}`).join(", ")
const WORDS: Record<string, string> = { AUTO_APPROVED: "approved automatically", NEEDS_APPROVAL: "held for a person", BLOCKED: "blocked", PROCESSING_ERROR: "a processing error" }
const word = (o: string) => WORDS[o] ?? o

function verdict(k: ExperimentCase, single: ExperimentSide, multi: ExperimentSide): Pick<ExperimentRow, "caughtBy" | "detail" | "pass"> {
	const pass = k.expectMulti.includes(multi.outcome) && (!multi.wrongAmountApproved || k.knownLimit === true)
	if (k.agent === "none") return { caughtBy: "nothing to catch", detail: `Both configurations approved ${multi.amount ?? "the payment"} automatically. The test does not simply stop everything.`, pass: pass && single.outcome === "AUTO_APPROVED" }
	const stoppedSingle = single.outcome !== "AUTO_APPROVED"
	const stoppedMulti = multi.outcome !== "AUTO_APPROVED"
	const byAuditor = multi.challenges.filter((c) => c.raisedBy === "Auditor")
	if (stoppedSingle && stoppedMulti) {
		const extra = byAuditor.length ? ` In the five-agent workflow the Auditor also raised ${byAuditor.length} challenge(s) with both sides and their evidence (${byAuditor.map((c) => c.id).join(", ")})${multi.investigator ? ", and the Investigator was called" : ""}.` : multi.investigator && !single.investigator ? " In the five-agent workflow the Investigator was called on the exception." : ""
		return { caughtBy: "code controls, in both configurations", detail: `The deterministic controls stopped it without a second reading: ${names(single) || "see the case"}.${extra} Not credited to agent collaboration.`, pass }
	}
	if (!stoppedSingle && stoppedMulti) {
		return { caughtBy: "only the independent second reading", detail: `The one-agent baseline approved ${single.amount ?? "it"} automatically${single.wrongAmountApproved ? `, which is not the amount the document asks for` : ""}: every control passed, because the wrong value is internally consistent and its quote really contains it. With an independent Auditor the two readings differ, and the payment was ${word(multi.outcome)}: ${names(multi) || byAuditor.map((c) => c.id).join(", ")}.`, pass }
	}
	return { caughtBy: "not caught", detail: `Approved for ${multi.amount ?? "the wrong amount"} in both configurations. The two readings agree, the quoted line really contains the value, the arithmetic is consistent, and no line of the document is labelled as a total in words the code knows, so nothing here can tell that it is the wrong field. What still stands between this and a payment is the per-payment limit, the daily budget and a person on larger amounts.${k.knownLimit ? " Declared in advance as a limit of the design." : ""}`, pass }
}

export async function runExperiment(timeoutMs = 30_000): Promise<ExperimentResult> {
	const started = Date.now()
	const { scriptedModel } = await import("../test/scripted.js")
	const gold = (await import("../test/fixtures.js")).READINGS as Record<string, ReadingInput>
	const docs = Object.fromEntries(loadDocuments().map((d) => [d.id, d]))
	const { parseMoney } = await import("../money.js")
	const rows: ExperimentRow[] = []
	for (const k of EXPERIMENT_CASES) {
		const sides = {} as Record<Configuration, ExperimentSide>
		for (const config of ["single", "multi"] as const) {
			desk.resetDesk()
			desk.setConfiguration(config)
			desk.setModelRunner(scriptedModel(scriptOf(k, gold)), "scripted")
			desk.addDocument(k.doc, k.unlabelled ? docs[k.doc]!.text.replace(TOTAL_LINE, UNKNOWN_LABEL_LINE) : docs[k.doc]!.text, "demo", "2026-11-26T08:00:00.000Z")
			await desk.whenSettled(timeoutMs)
			sides[config] = sideOf(structuredClone(desk.peek(k.doc)), config, parseMoney(k.correctAmount))
		}
		rows.push({ ...k, single: sides.single, multi: sides.multi, ...verdict(k, sides.single, sides.multi) })
	}
	const policy = desk.snapshot().policy
	desk.resetDesk()
	desk.setConfiguration("multi")
	const injected = rows.filter((r) => r.agent !== "none")
	return {
		label: EXPERIMENT_LABEL,
		ranAt: new Date(started).toISOString(),
		durationMs: Date.now() - started,
		policy: policy.name,
		rows,
		summary: {
			injected: injected.length,
			caughtByCodeInBoth: injected.filter((r) => r.caughtBy === "code controls, in both configurations").length,
			caughtOnlyBySecondReading: injected.filter((r) => r.caughtBy === "only the independent second reading").length,
			notCaught: injected.filter((r) => r.caughtBy === "not caught").length,
			baselineWrongApprovals: rows.filter((r) => r.single.wrongAmountApproved).length,
			multiWrongApprovals: rows.filter((r) => r.multi.wrongAmountApproved).length,
		},
		limitations: [
			"The agents' answers are scripted, and the errors are put there on purpose. This says nothing about how often a language model makes these errors.",
			"The one-agent baseline replays the same wrong first reading by construction. The comparison shows what an independent second reading adds when the first is wrong, not that one model is worse than five.",
			`${EXPERIMENT_CASES.length} cases on synthetic documents are observations, not rates. It is not the live single-agent against multi-agent benchmark, which has not been run.`,
			"Two cases give both readers the same wrong reading on purpose. One of them is declared in advance as a limit of the design and is expected to get through; the result reports it as not caught.",
			"Same documents, trusted records, policy, deterministic controls and enforcement in both configurations. Nothing was switched off.",
		],
	}
}
