/**
 * A scripted stand-in for the language model, used by the automated tests and by the scripted demo server.
 *
 * It implements Mozaik's InferenceRunner and answers with tool calls taken from a script, so the tests drive the
 * REAL runtime: real loops, real tools, real events, real enforcement. Only the model's words are fixed.
 * A test that passes here proves the workflow and the controls, not a live model integration.
 */
import { randomUUID } from "node:crypto"
import { FunctionCallItem, ModelMessageItem, type InferenceInput, type InferenceOutput, type InferenceRunner } from "@mozaik-ai/core"
import type { Disposition } from "../domain.js"
import type { ReadingInput } from "../firewall.js"

export type AuditInput = ReadingInput & { conflicts?: { field: string; values: string[]; quotes: string[] }[]; summary?: string }

export type Script = {
	/** What the Extractor "reads" per document id. */
	readings: Record<string, ReadingInput>
	/** What the Auditor reads; defaults to the same reading (agreement). */
	audits?: Record<string, AuditInput>
	/** Overrides for the Validator's report; by default it repeats what lookup_trusted_records returned. */
	validations?: Record<string, Record<string, unknown>>
	/** Overrides for what the Investigator submits, per document id. */
	investigations?: Record<string, Record<string, unknown>>
	/** Overrides for what the Policy agent submits, per document id. */
	policies?: Record<string, Record<string, unknown>>
	/** What the Policy agent recommends for every case. Defaults to the most permissive answer possible. */
	policy?: Disposition
	/** "Agent:docId" pairs whose model call throws, e.g. "Auditor:INV-1". */
	fail?: string[]
	/** Records every call, for assertions about who ran. */
	calls?: { agent: string; docId: string }[]
	/** Every call fails with this message, as a provider would. Fault injection for the tests and the browser checks; the message says so. */
	failWith?: string
	/** How long one scripted model call takes. Not zero, so that recorded start and finish times can be compared. */
	latencyMs?: number
}

const text = (item: any): string => item?.content?.text ?? item?.output?.text ?? ""

export function whoAndWhat(req: InferenceInput): { agent: string; docId: string; outputs: any[] } {
	const items = req.context.getItems() as any[]
	const dev = text(items.find((i) => i.type === "message" && i.role === "developer"))
	const user = text(items.find((i) => i.type === "message" && i.role === "user"))
	const agent = /single agent of the benchmark baseline/.test(dev) ? "Solo" : /independent Auditor/.test(dev) ? "Auditor" : /Financial Investigator/.test(dev) ? "Investigator" : /Policy agent/.test(dev) ? "Policy" : /the Validator/.test(dev) ? "Validator" : "Extractor"
	const docId = (/Document id (\S+)/.exec(user) ?? /"(?:documentId|caseId)":\s*"([^"]+)"/.exec(user))?.[1] ?? "?"
	return { agent, docId, outputs: items.filter((i) => i.type === "function_call_output") }
}

const call = (name: string, args: unknown): InferenceOutput => ({ items: [FunctionCallItem.rehydrate({ callId: `call_${randomUUID().slice(0, 8)}`, name, args: JSON.stringify(args) })], tokenUsage: undefined, rowResponse: null })
const say = (t: string): InferenceOutput => ({ items: [ModelMessageItem.rehydrate({ text: t })], tokenUsage: undefined, rowResponse: null })

export function scriptedModel(script: Script): InferenceRunner {
	return {
		async run(req: InferenceInput): Promise<InferenceOutput> {
			const { agent, docId, outputs } = whoAndWhat(req)
			script.calls?.push({ agent, docId })
			await new Promise((r) => setTimeout(r, script.latencyMs ?? 5))
			if (script.failWith) throw new Error(script.failWith)
			if (script.fail?.includes(`${agent}:${docId}`)) throw new Error(`scripted provider failure for ${agent} on ${docId}`)
			if (agent === "Solo") {
				// The baseline in the tests: replays the same reading, repeats what the records returned, and recommends like the scripted Policy agent.
				const r = script.readings[docId]
				if (outputs.length === 0) return r ? call("record_reading", { isPaymentRequest: true, documentKind: "invoice", ...r }) : say("I have nothing to report.")
				const seen = JSON.parse(text(outputs[0])).trustedRecords ?? {}
				return call("submit_assessment", {
					vendorId: seen.vendor?.found ? seen.vendor.record.id : null, ibanValid: seen.iban?.checksumValid ?? null, ibanMatchesMaster: seen.iban?.matchesVendorMaster ?? null,
					duplicateOf: null, issues: [], conflicts: [], summary: "scripted single-agent assessment",
					disposition: script.policy ?? "AUTO_APPROVED", rulesApplied: [], passed: [], failed: [], humanRequired: false, explanation: "scripted: approve everything", refs: [],
				})
			}
			if (agent === "Extractor") {
				const r = script.readings[docId]
				return r ? call("submit_reading", { isPaymentRequest: true, documentKind: "invoice", ...r }) : say("I have nothing to report.")
			}
			if (agent === "Auditor") {
				const a = script.audits?.[docId] ?? script.readings[docId]!
				return call("submit_independent_reading", { isPaymentRequest: true, documentKind: "invoice", summary: "scripted audit", conflicts: [], ...a })
			}
			if (agent === "Validator") {
				if (outputs.length === 0) return call("lookup_trusted_records", {})
				const seen = JSON.parse(text(outputs[0]))
				return call("submit_validation", {
					vendorId: seen.vendor?.found ? seen.vendor.record.id : null,
					ibanValid: seen.iban?.checksumValid ?? null,
					ibanMatchesMaster: seen.iban?.matchesVendorMaster ?? null,
					duplicateOf: null, issues: [], summary: "scripted validation",
					...script.validations?.[docId],
				})
			}
			if (agent === "Investigator") {
				return call("submit_investigation", { category: "scripted exception", assessment: "suspected", verifiedFacts: [{ text: "scripted fact", refs: ["X:gross"] }], conflictingEvidence: [], explanation: "scripted investigation", unknowns: ["scripted unknown"], recommendedSteps: ["scripted step"], recommendedDisposition: "NEEDS_APPROVAL", ...script.investigations?.[docId] })
			}
			return call("submit_recommendation", { disposition: script.policy ?? "AUTO_APPROVED", rulesApplied: [], passed: [], failed: [], humanRequired: false, explanation: "scripted: approve everything", refs: [], ...script.policies?.[docId] })
		},
		// eslint-disable-next-line require-yield
		async *stream() { throw new Error("the scripted model does not stream") },
	}
}
