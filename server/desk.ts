/**
 * The Payment Desk runtime: four Mozaik agents sharing one typed state.
 *
 *   inbox ──▶ Extractor (one loop per document, all at once)
 *                 │  extraction.completed
 *                 ├──────────────▶ Validator  (vendor master, IBAN, duplicates)   ┐ run in
 *                 └──────────────▶ Auditor    (re-reads the document, checks every number) ┘ parallel
 *                                      │ validation.completed + audit.completed
 *                                      ▼
 *                                   Policy ──▶ auto-approve │ human approval │ reject
 *                                      │ (a deterministic guard can only make the agent stricter)
 *                                      ▼
 *                                  SEPA pain.001 draft
 */
import {
	Agent,
	DeveloperMessageItem,
	ModelContext,
	ModelMessageItem,
	RuntimeState,
	SemanticEvent,
	SituationSpecification,
	createAgent,
	createHuman,
	defineRuntime,
	type InferenceInput,
	type InferenceOutput,
	type InferenceRunner,
	type InterceptionHandler,
	type SituationContext,
	type SituationHandler,
	type Tool,
} from "@mozaik-ai/core"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join as joinPath } from "node:path"
import type {
	AgentInfo, Audit, Checks, Decision, DeskSnapshot, Discrepancy, Evidence, Extraction, Issue, PaymentCase, Policy, Route,
	SourceDocument, TimelineEntry, Validation, Vendor,
} from "./domain.js"
import { emptyStep, nowIso } from "./domain.js"
import { countInboxFiles, findLine, loadDocuments, loadPolicy, loadVendors } from "./data.js"
import { formatIban, isValidIban, normalizeIban } from "./lib/iban.js"
import { buildSepaDraft } from "./sepa.js"

export const MODELS = {
	fast: process.env.FAST_MODEL ?? "claude-haiku-4-5",
	careful: process.env.CAREFUL_MODEL ?? "claude-sonnet-5-5",
}

// ───────────────────────────────── shared state ─────────────────────────────────

class DeskState extends RuntimeState {
	startedAt: string | null = null
	vendors: Vendor[] = loadVendors()
	policy: Policy = loadPolicy()
	documents = new Map<string, SourceDocument>()
	cases = new Map<string, PaymentCase>()
	tokens = new Map<string, { input: number; output: number; calls: number }>()
	events = new Map<string, number>()
}

const { initializeRuntime, resolveRuntime, join, sendEvent, runLoop } = defineRuntime<DeskState>()

// ───────────────────────────────── outbound events (SSE / CLI) ─────────────────────────────────

export type DeskEvent = { type: string; at: string; payload: unknown }
type Listener = (e: DeskEvent) => void
const listeners = new Set<Listener>()
export function subscribe(l: Listener): () => void {
	listeners.add(l)
	return () => listeners.delete(l)
}
function emit(type: string, payload: unknown) {
	const e = { type, at: nowIso(), payload }
	for (const l of listeners) l(e)
}
function emitCase(c: PaymentCase) {
	emit("case.updated", c)
}

// ───────────────────────────────── inference runner with honest errors ─────────────────────────────────

const ERROR_MARK = "__AGENT_ERROR__"

const state = new DeskState()
const runtime = initializeRuntime({ state })

/**
 * A provider failure (no key, quota, network) must end the loop with a visible error, not crash the process.
 * The runtime exposes its runner only through `getInferenceRunner()`, so that method is replaced on this instance.
 */
{
	const inner = runtime.getInferenceRunner()
	const safe: InferenceRunner = {
		async run(req: InferenceInput): Promise<InferenceOutput> {
			try {
				return await inner.run(req)
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				return { items: [ModelMessageItem.rehydrate({ text: `${ERROR_MARK}${message}` })], tokenUsage: undefined, rowResponse: null }
			}
		},
		stream: (req) => inner.stream(req),
	}
	Object.defineProperty(runtime, "getInferenceRunner", { value: () => safe })
}

// ───────────────────────────────── helpers ─────────────────────────────────

const getCase = (id: string): PaymentCase => {
	const c = state.cases.get(id)
	if (!c) throw new Error(`unknown case ${id}`)
	return c
}
const getDoc = (id: string): SourceDocument => {
	const d = state.documents.get(id)
	if (!d) throw new Error(`unknown document ${id}`)
	return d
}

function log(c: PaymentCase, agent: string, kind: TimelineEntry["kind"], detail: string) {
	c.timeline.push({ at: nowIso(), agent, kind, detail })
	emit("timeline", { caseId: c.id, agent, kind, detail, at: c.timeline[c.timeline.length - 1]!.at })
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)
const num = (v: unknown): number | null => {
	if (typeof v === "number" && Number.isFinite(v)) return v
	if (typeof v === "string") {
		const n = Number(v.replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."))
		return Number.isFinite(n) ? n : null
	}
	return null
}

/** Models name fields loosely ("Total amount", "creditor"); evidence is stored under the extraction's own keys. */
function canonicalField(raw: string): string {
	const k = raw.toLowerCase().replace(/[^a-z]/g, "")
	if (/invoice|number|no$/.test(k) && !/amount/.test(k)) return "invoiceNumber"
	if (/creditor|vendor|supplier|payee|beneficiary|name/.test(k)) return "creditorName"
	if (/amount|total|sum|due(?!date)/.test(k) && !/date/.test(k)) return "amount"
	if (/currency|ccy/.test(k)) return "currency"
	if (/iban|account/.test(k)) return "iban"
	if (/bic|swift/.test(k)) return "bic"
	if (/due|date|deadline|echeance|fallig|dospijece|vencimiento/.test(k)) return "dueDate"
	if (/ref|purpose|verwendungszweck|poziv/.test(k)) return "reference"
	if (/kind|type|document/.test(k)) return "documentKind"
	return raw
}

function freshContext(agent: Agent): ModelContext {
	return ModelContext.create().addContextItem(DeveloperMessageItem.create(agent.getDeveloperMessage()))
}

/** Runs one loop for one case with a fresh context; the interception handler keeps the case timeline. */
function startLoop(agent: Agent, model: string, c: PaymentCase, message: string, onAnswer: (text: string) => void) {
	const name = agent.getManifest().name
	log(c, name, "loop.started", `${name} started (${model})`)
	const interception: InterceptionHandler = {
		isSatisfiedBy: (t) => t.nextStateId === "inference" || t.nextStateId === "function_call" || t.nextStateId === "model_message",
		async handle(t) {
			if (t.nextStateId === "inference") log(c, name, "inference", "thinking")
			if (t.nextStateId === "function_call") log(c, name, "tool", `calls ${t.input.call.name}`)
			if (t.nextStateId === "model_message") {
				const text = t.input.answer.content.text
				if (text.startsWith(ERROR_MARK)) {
					const err = text.slice(ERROR_MARK.length)
					log(c, name, "error", err)
					onAnswer(`${ERROR_MARK}${err}`)
				} else {
					log(c, name, "answer", text.slice(0, 400))
					onAnswer(text)
				}
			}
			return t
		},
	}
	runLoop(agent.getId(), message, { model, context: freshContext(agent), tools: agent.getTools(), maxOutputTokens: 2000 }, interception)
}

function failStep(c: PaymentCase, step: "extraction" | "validation" | "audit" | "decision", error: string) {
	c[step].status = "error"
	c[step].error = error
	c[step].finishedAt = nowIso()
	c.stage = "error"
	emitCase(c)
}

// ───────────────────────────────── vendor matching (deterministic) ─────────────────────────────────

const LEGAL = /\b(gmbh|ag|sas|sa|sarl|bv|b\.v\.|nv|sl|s\.l\.|ltd|limited|llc|inc|doo|d\.o\.o\.|oy|ab|as|plc)\b/g
const tokens = (s: string) =>
	new Set(s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(LEGAL, " ").split(/\s+/).filter((t) => t.length > 1))

function matchVendor(name: string): { vendor: Vendor | null; score: number; candidates: { id: string; name: string; score: number }[] } {
	const a = tokens(name)
	const scored = state.vendors.map((v) => {
		const b = tokens(v.name)
		const inter = [...a].filter((t) => b.has(t)).length
		const union = new Set([...a, ...b]).size
		return { id: v.id, name: v.name, score: union ? inter / union : 0 }
	})
	scored.sort((x, y) => y.score - x.score)
	const best = scored[0]
	const vendor = best && best.score >= 0.5 ? state.vendors.find((v) => v.id === best.id)! : null
	return { vendor, score: best?.score ?? 0, candidates: scored.slice(0, 3) }
}

// ───────────────────────────────── deterministic checks ─────────────────────────────────

const CRITICAL_FIELDS = ["amount", "iban", "creditorName"] as const
const invoiceKey = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
const bareBic = (b: string) => b.toUpperCase().replace(/XXX$/, "")

/** Everything the desk can establish without a model: master data, checksum, duplicates, limits, located sources. */
function computeChecks(c: PaymentCase): Checks | null {
	const x = c.extraction.result
	if (!x || !x.isPaymentRequest) return null
	const vendor = x.creditorName ? matchVendor(x.creditorName).vendor : null
	const vendorKey = (name: string | null) => (name ? matchVendor(name).vendor?.id ?? [...tokens(name)].sort().join(" ") : "")
	const mine = vendorKey(x.creditorName)
	const dupes = [...state.cases.values()].filter((o) => {
		const ox = o.extraction.result
		if (o.id === c.id || !ox?.isPaymentRequest || !mine || vendorKey(ox.creditorName) !== mine) return false
		const sameInvoice = !!invoiceKey(x.invoiceNumber) && invoiceKey(ox.invoiceNumber) === invoiceKey(x.invoiceNumber)
		const sameAmountNoNumber = x.amount != null && ox.amount === x.amount && (!invoiceKey(x.invoiceNumber) || !invoiceKey(ox.invoiceNumber))
		return sameInvoice || sameAmountNoNumber
	})
	const before = (o: PaymentCase) => o.receivedAt < c.receivedAt || (o.receivedAt === c.receivedAt && o.id < c.id)
	const earlier = dupes.filter(before).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
	return {
		vendorId: vendor?.id ?? null,
		vendorName: vendor?.name ?? null,
		ibanValid: x.iban ? isValidIban(x.iban) : null,
		ibanMatchesMaster: vendor && x.iban ? normalizeIban(vendor.iban) === x.iban : null,
		masterIban: vendor ? normalizeIban(vendor.iban) : null,
		bicMatchesMaster: vendor && x.bic ? bareBic(vendor.bic) === bareBic(x.bic) : null,
		duplicateOf: earlier[0]?.id ?? null,
		duplicatedBy: dupes.filter((o) => !before(o)).map((o) => o.id),
		overLimit: x.amount != null ? x.amount > state.policy.autoApproveLimit : null,
		limit: state.policy.autoApproveLimit,
		currencyOk: x.currency ? x.currency === state.policy.currency : null,
		unsourced: CRITICAL_FIELDS.filter((f) => x[f] != null && !x.evidence.some((e) => e.field === f && e.line != null)),
		computedAt: nowIso(),
	}
}

/** A new extraction can make an older case a duplicate, so every extracted case is rechecked. */
function refreshChecks() {
	for (const c of state.cases.values()) {
		if (c.extraction.status !== "done") continue
		const next = computeChecks(c)
		const same = JSON.stringify({ ...next, computedAt: 0 }) === JSON.stringify({ ...c.checks, computedAt: 0 })
		c.checks = next
		if (!same) emitCase(c)
	}
}

// ───────────────────────────────── tools ─────────────────────────────────

const submitExtraction: Tool = {
	type: "function",
	name: "submit_extraction",
	description:
		"Record the payment details extracted from the document. Every field you fill must be backed by a verbatim quote in `evidence`. Call exactly once.",
	strict: false,
	parameters: {
		type: "object",
		properties: {
			docId: { type: "string" },
			isPaymentRequest: { type: "boolean", description: "true only for an invoice, bill or payment request addressed to us" },
			documentKind: { type: "string", description: "e.g. invoice, payment reminder, newsletter, quote" },
			invoiceNumber: { type: ["string", "null"] },
			creditorName: { type: ["string", "null"], description: "legal name of the party to be paid" },
			amount: { type: ["number", "null"], description: "total amount due as a plain number, e.g. 2422.54" },
			currency: { type: ["string", "null"], description: "ISO 4217 code" },
			iban: { type: ["string", "null"] },
			bic: { type: ["string", "null"] },
			dueDate: { type: ["string", "null"], description: "ISO date YYYY-MM-DD" },
			reference: { type: ["string", "null"], description: "payment reference the creditor asks for" },
			evidence: {
				type: "array",
				items: {
					type: "object",
					properties: {
						field: { type: "string", enum: ["invoiceNumber", "creditorName", "amount", "currency", "iban", "bic", "dueDate", "reference", "documentKind"] },
						quote: { type: "string", description: "copied verbatim from the document" },
					},
					required: ["field", "quote"],
				},
			},
			note: { type: "string", description: "one sentence on anything unusual" },
		},
		required: ["docId", "isPaymentRequest", "documentKind", "evidence", "note"],
	},
	invoke: async (args: any) => {
		const c = getCase(String(args.docId))
		const doc = getDoc(c.id)
		const evidence: Evidence[] = Array.isArray(args.evidence)
			? args.evidence.filter((e: any) => str(e?.field) && str(e?.quote)).map((e: any) => ({ field: canonicalField(e.field), quote: e.quote, line: findLine(doc.text, e.quote) }))
			: []
		const unlocated = evidence.filter((e) => e.line === null).map((e) => e.field)
		const x: Extraction = {
			isPaymentRequest: Boolean(args.isPaymentRequest),
			documentKind: str(args.documentKind) ?? "unknown",
			invoiceNumber: str(args.invoiceNumber),
			creditorName: str(args.creditorName),
			amount: num(args.amount),
			currency: str(args.currency)?.toUpperCase() ?? null,
			iban: args.iban ? normalizeIban(String(args.iban)) : null,
			bic: str(args.bic)?.toUpperCase() ?? null,
			dueDate: str(args.dueDate),
			reference: str(args.reference),
			evidence,
			note: str(args.note) ?? "",
		}
		c.extraction = { status: "done", startedAt: c.extraction.startedAt, finishedAt: nowIso(), result: x, error: null }
		refreshChecks()
		if (!x.isPaymentRequest) {
			c.stage = "not_a_payment"
			emitCase(c)
			return { ok: true, stored: true, nextStep: "none: document is not a payment request" }
		}
		c.stage = "checking"
		c.validation.status = "running"
		c.validation.startedAt = nowIso()
		c.audit.status = "running"
		c.audit.startedAt = nowIso()
		emitCase(c)
		sendEvent(SemanticEvent.create("extraction.completed", desk.getId(), { docId: c.id }), desk.getId())
		return { ok: true, stored: true, unlocatedEvidence: unlocated, nextStep: "Validator and Auditor are now checking this in parallel" }
	},
}

const lookupVendor: Tool = {
	type: "function",
	name: "lookup_vendor",
	description: "Look a creditor up in the approved vendor master by name. Returns the master record (with the bank details we have on file) or the closest candidates.",
	strict: false,
	parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
	invoke: async ({ name }: { name: string }) => {
		const m = matchVendor(String(name))
		return m.vendor
			? { found: true, matchScore: m.score, vendor: m.vendor, source: "data/vendors.json" }
			: { found: false, candidates: m.candidates, source: "data/vendors.json" }
	},
}

const verifyIban: Tool = {
	type: "function",
	name: "verify_iban",
	description: "Check an IBAN's checksum (ISO 13616) and, when a vendorId is given, whether it equals the IBAN in the vendor master.",
	strict: false,
	parameters: { type: "object", properties: { iban: { type: "string" }, vendorId: { type: ["string", "null"] } }, required: ["iban"] },
	invoke: async ({ iban, vendorId }: { iban: string; vendorId?: string | null }) => {
		const n = normalizeIban(String(iban))
		const vendor = vendorId ? state.vendors.find((v) => v.id === vendorId) ?? null : null
		return {
			iban: formatIban(n),
			checksumValid: isValidIban(n),
			country: n.slice(0, 2),
			matchesVendorMaster: vendor ? normalizeIban(vendor.iban) === n : null,
			masterIban: vendor ? formatIban(vendor.iban) : null,
			masterBic: vendor?.bic ?? null,
		}
	},
}

const findDuplicates: Tool = {
	type: "function",
	name: "find_duplicates",
	description: "Search the other documents in this inbox for the same invoice number, or the same creditor and amount, which would mean a duplicate payment.",
	strict: false,
	parameters: { type: "object", properties: { docId: { type: "string" } }, required: ["docId"] },
	invoke: async ({ docId }: { docId: string }) => {
		const me = getCase(docId).extraction.result
		if (!me) return { duplicates: [] }
		const dupes = [...state.cases.values()]
			.filter((o) => o.id !== docId && o.extraction.result?.isPaymentRequest)
			.map((o) => ({ o, x: o.extraction.result! }))
			.filter(({ x }) => (me.invoiceNumber && x.invoiceNumber && x.invoiceNumber === me.invoiceNumber) || (x.creditorName && me.creditorName && x.amount === me.amount && matchVendor(x.creditorName).vendor?.id === matchVendor(me.creditorName).vendor?.id))
			.map(({ o, x }) => ({ docId: o.id, fileName: o.fileName, invoiceNumber: x.invoiceNumber, amount: x.amount, receivedAt: o.receivedAt, documentKind: x.documentKind }))
		return { duplicates: dupes, note: dupes.length ? "The earlier-received document is the original; later ones are copies or reminders." : "none" }
	},
}

const ISSUE_CODES = new Set(["vendor_unknown", "iban_invalid", "iban_differs_from_master", "bic_differs_from_master", "possible_duplicate", "currency_mismatch", "missing_field"])

const submitValidation: Tool = {
	type: "function",
	name: "submit_validation",
	description: "Record the validation result. Issues must come from what the tools returned, with `source` naming the tool or file. Call exactly once.",
	strict: false,
	parameters: {
		type: "object",
		properties: {
			docId: { type: "string" },
			vendorId: { type: ["string", "null"] },
			vendorName: { type: ["string", "null"] },
			ibanValid: { type: ["boolean", "null"] },
			ibanMatchesMaster: { type: ["boolean", "null"] },
			duplicateOf: { type: ["string", "null"], description: "docId of the earlier original if this is a duplicate" },
			issues: {
				type: "array",
				items: {
					type: "object",
					properties: {
						code: { type: "string", enum: [...ISSUE_CODES] },
						severity: { type: "string", enum: ["block", "review", "info"] },
						message: { type: "string" },
						source: { type: "string" },
					},
					required: ["code", "severity", "message", "source"],
				},
			},
			summary: { type: "string", description: "two sentences for the reviewer" },
		},
		required: ["docId", "issues", "summary"],
	},
	invoke: async (args: any) => {
		const c = getCase(String(args.docId))
		const issues: Issue[] = (Array.isArray(args.issues) ? args.issues : [])
			.filter((i: any) => ISSUE_CODES.has(i?.code))
			.map((i: any) => ({ code: i.code, severity: ["block", "review", "info"].includes(i.severity) ? i.severity : "review", message: String(i.message ?? ""), source: String(i.source ?? "") }))
		const v: Validation = {
			vendorId: str(args.vendorId),
			vendorName: str(args.vendorName),
			ibanValid: typeof args.ibanValid === "boolean" ? args.ibanValid : null,
			ibanMatchesMaster: typeof args.ibanMatchesMaster === "boolean" ? args.ibanMatchesMaster : null,
			duplicateOf: str(args.duplicateOf),
			issues,
			summary: str(args.summary) ?? "",
			disagreements: [],
		}
		const k = (c.checks = computeChecks(c))
		if (k) {
			const differs = (label: string, said: unknown, computed: unknown) => {
				if (said != null && computed != null && said !== computed) v.disagreements.push(`${label}: Validator reported ${String(said)}, computed ${String(computed)}`)
			}
			differs("vendor id", v.vendorId, k.vendorId)
			differs("IBAN checksum valid", v.ibanValid, k.ibanValid)
			differs("IBAN matches vendor master", v.ibanMatchesMaster, k.ibanMatchesMaster)
			if (v.disagreements.length) log(c, "PolicyGuard", "info", `Validator's report disagrees with computed checks: ${v.disagreements.join("; ")}`)
		}
		c.validation = { status: "done", startedAt: c.validation.startedAt, finishedAt: nowIso(), result: v, error: null }
		emitCase(c)
		sendEvent(SemanticEvent.create("validation.completed", desk.getId(), { docId: c.id }), desk.getId())
		return { ok: true, stored: true, computedChecks: k, disagreements: v.disagreements }
	},
}

const readDocument: Tool = {
	type: "function",
	name: "read_document",
	description: "Return the full original text of a document with line numbers.",
	strict: false,
	parameters: { type: "object", properties: { docId: { type: "string" } }, required: ["docId"] },
	invoke: async ({ docId }: { docId: string }) => {
		const d = getDoc(docId)
		return { docId, fileName: d.fileName, text: d.text.split("\n").map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join("\n") }
	},
}

const submitAudit: Tool = {
	type: "function",
	name: "submit_audit",
	description: "Record whether every extracted value matches the document. A discrepancy must quote what the document actually says. Call exactly once.",
	strict: false,
	parameters: {
		type: "object",
		properties: {
			docId: { type: "string" },
			ok: { type: "boolean" },
			discrepancies: { type: "array", items: { type: "object", properties: { field: { type: "string" }, extracted: { type: "string" }, inDocument: { type: "string" } }, required: ["field", "extracted", "inDocument"] } },
			summary: { type: "string" },
		},
		required: ["docId", "ok", "discrepancies", "summary"],
	},
	invoke: async (args: any) => {
		const c = getCase(String(args.docId))
		const discrepancies: Discrepancy[] = (Array.isArray(args.discrepancies) ? args.discrepancies : []).map((d: any) => ({ field: String(d.field ?? ""), extracted: String(d.extracted ?? ""), inDocument: String(d.inDocument ?? "") }))
		const a: Audit = { ok: Boolean(args.ok) && discrepancies.length === 0, discrepancies, summary: str(args.summary) ?? "" }
		c.audit = { status: "done", startedAt: c.audit.startedAt, finishedAt: nowIso(), result: a, error: null }
		emitCase(c)
		sendEvent(SemanticEvent.create("audit.completed", desk.getId(), { docId: c.id }), desk.getId())
		return { ok: true, stored: true }
	},
}

const getPolicy: Tool = {
	type: "function",
	name: "get_policy",
	description: "Return the accounts-payable policy and today's auto-approval budget usage.",
	strict: false,
	parameters: { type: "object", properties: {} },
	invoke: async () => ({ policy: state.policy, dailyAutoApprovedSoFar: dailyAutoApproved(), source: "data/policy.json" }),
}

/**
 * The policy floor. Every rule here reads the computed checks or the stored audit, never the Policy agent's opinion,
 * so the agent can explain and be stricter but cannot talk the desk into paying something the policy forbids.
 */
function policyFacts(c: PaymentCase): { required: Route; reasons: string[] } {
	const x = c.extraction.result!
	const k = (c.checks = computeChecks(c))!
	const v = c.validation.result
	const a = c.audit.result
	const p = state.policy
	const reasons: string[] = []
	let required: Route = "auto"
	const escalate = (r: string) => { reasons.push(r); if (required === "auto") required = "human" }
	if (k.ibanValid === false) { reasons.push("IBAN checksum is invalid (ISO 13616 mod 97)"); required = "reject" }
	if (x.amount == null || !x.iban || !x.creditorName) escalate("a required payment field is missing")
	if (k.overLimit) escalate(`amount ${x.amount!.toFixed(2)} ${x.currency ?? ""} is above the auto-approve limit of ${p.autoApproveLimit.toFixed(2)} ${p.currency}`)
	if (!k.vendorId) escalate("vendor is not in the vendor master")
	if (k.ibanMatchesMaster === false) escalate("bank details differ from the vendor master")
	if (k.duplicateOf) escalate(`possible duplicate of ${k.duplicateOf}`)
	if (k.duplicatedBy.length) escalate(`a later document duplicates this invoice (${k.duplicatedBy.join(", ")})`)
	if (k.currencyOk === false) escalate(`currency ${x.currency} is not ${p.currency}`)
	if (k.unsourced.length) escalate(`no located source in the document for: ${k.unsourced.join(", ")}`)
	if (a && !a.ok) escalate("the auditor found a discrepancy between the extraction and the document")
	if (v?.disagreements.length) escalate("the Validator's report disagrees with the computed checks")
	if (required === "auto" && x.amount != null && dailyAutoApproved() + x.amount > p.dailyAutoApproveBudget) escalate("today's auto-approve budget would be exceeded")
	return { required, reasons }
}

const STRICTNESS: Record<Route, number> = { auto: 0, human: 1, reject: 2 }

const submitDecision: Tool = {
	type: "function",
	name: "submit_decision",
	description: "Record the routing decision: auto (pay without a human), human (needs an approver), reject. Reasons must cite policy rules or tool results. Call exactly once.",
	strict: false,
	parameters: {
		type: "object",
		properties: {
			docId: { type: "string" },
			route: { type: "string", enum: ["auto", "human", "reject"] },
			reasons: { type: "array", items: { type: "string" } },
			summary: { type: "string", description: "two sentences for the approver" },
		},
		required: ["docId", "route", "reasons", "summary"],
	},
	invoke: async (args: any) => {
		const c = getCase(String(args.docId))
		const proposed: Route = ["auto", "human", "reject"].includes(args.route) ? args.route : "human"
		const facts = policyFacts(c)
		const overridden = STRICTNESS[proposed] < STRICTNESS[facts.required]
		const route = overridden ? facts.required : proposed
		const d: Decision = {
			route,
			reasons: Array.isArray(args.reasons) ? args.reasons.map(String) : [],
			guardReasons: facts.reasons,
			summary: str(args.summary) ?? "",
			overriddenFrom: overridden ? proposed : null,
		}
		c.decision = { status: "done", startedAt: c.decision.startedAt, finishedAt: nowIso(), result: d, error: null }
		if (overridden) log(c, "PolicyGuard", "info", `guard raised route from "${proposed}" to "${route}": ${facts.reasons.join("; ")}`)
		applyRoute(c)
		return { ok: true, stored: true, finalRoute: route, guardOverrode: overridden, guardReasons: facts.reasons }
	},
}

function draftSepa(c: PaymentCase) {
	c.sepa = buildSepaDraft(c, state.policy, nowIso())
	log(c, "Desk", "info", `SEPA draft created (pain.001.001.09, message ${c.sepa.messageId}); nothing is sent`)
}

function applyRoute(c: PaymentCase) {
	const d = c.decision.result!
	if (d.route === "reject") {
		c.stage = "rejected"
		c.approval = { by: "policy", decision: "rejected", note: [...d.guardReasons, ...d.reasons].join("; "), at: nowIso() }
		log(c, "PolicyGuard", "info", `rejected by policy: ${d.guardReasons.join("; ") || d.reasons.join("; ")}`)
	} else if (d.route === "human") {
		c.stage = "awaiting_approval"
		log(c, "PolicyGuard", "info", `held for a human approver: ${d.guardReasons.join("; ") || "the Policy agent asked for review"}`)
	} else {
		c.stage = "approved"
		c.approval = { by: "policy", decision: "approved", note: "within policy; auto-approved", at: nowIso() }
		log(c, "PolicyGuard", "info", "auto-approved: no policy rule requires a human")
		draftSepa(c)
	}
	emitCase(c)
}

export function dailyAutoApproved(): number {
	return [...state.cases.values()].filter((c) => c.approval?.by === "policy" && c.approval.decision === "approved").reduce((s, c) => s + (c.extraction.result?.amount ?? 0), 0)
}

// ───────────────────────────────── agents ─────────────────────────────────

const extractor = createAgent({
	name: "Extractor",
	capabilities: ["inference", "extraction"],
	tools: [submitExtraction],
	handlers: [],
	instruction: `You are the Extractor on an accounts-payable desk. You read one inbound document and extract the payment details.
Rules:
- Decide first whether the document is a payment request addressed to us (invoice, bill, reminder). Newsletters, ads and quotes are not.
- For every field you fill, add an evidence entry whose quote is copied VERBATIM from the document (same characters, same spacing). Never paraphrase a number.
- Amounts: convert the TOTAL amount due to a plain number (2.422,54 -> 2422.54; 1,415.00 -> 1415). Dates to YYYY-MM-DD.
- Do not guess. If a field is not in the document, leave it null and say so in the note.
- Call submit_extraction exactly once, then reply with one short sentence.`,
})

const validator = createAgent({
	name: "Validator",
	capabilities: ["inference", "validation"],
	tools: [lookupVendor, verifyIban, findDuplicates, submitValidation],
	handlers: [],
	instruction: `You are the Validator on an accounts-payable desk. You check an extracted payment against our records before anyone pays it.
Always: look the creditor up with lookup_vendor, verify the IBAN with verify_iban (pass the vendorId if found), and run find_duplicates.
Then call submit_validation exactly once. Every issue must be grounded in a tool result and name its source. Typical issues:
- vendor_unknown (review): creditor not in the vendor master.
- iban_invalid (block): checksum failed.
- iban_differs_from_master (review): the document asks for a different account than we have on file. This is the classic invoice-fraud pattern; say so plainly.
- possible_duplicate (review): same invoice already in the inbox; set duplicateOf to the EARLIER document.
- currency_mismatch, missing_field as appropriate.
Reply with one short sentence after the tool call.`,
})

const auditor = createAgent({
	name: "Auditor",
	capabilities: ["inference", "audit"],
	tools: [readDocument, submitAudit],
	handlers: [],
	instruction: `You are the Auditor on an accounts-payable desk. Another agent extracted payment details from a document; you independently verify them.
Call read_document, then compare EVERY extracted value (amount, currency, IBAN, BIC, creditor, invoice number, due date, reference) with what the document literally says. Decimal formats differ by country (2.422,54 equals 2422.54): that is not a discrepancy. A wrong digit, a wrong total (e.g. a line item instead of the total), or an invented value is.
Call submit_audit exactly once with ok=true only when nothing is off. Quote the document in inDocument. Reply with one short sentence.`,
})

const policyAgent = createAgent({
	name: "Policy",
	capabilities: ["inference", "policy"],
	tools: [getPolicy, submitDecision],
	handlers: [],
	instruction: `You are the Policy agent on an accounts-payable desk. Given the extraction, the validation and the audit of one payment, route it:
- auto: fully within policy, no issues, under the auto-approve limit and the daily budget.
- human: anything the policy says requires a human approver, or any review-level issue.
- reject: only for block-level issues (invalid IBAN) or documents that must never be paid. A possible duplicate or a reminder goes to human, so the approver decides which copy to pay.
Call get_policy first, then submit_decision exactly once. Reasons must cite the policy rule or the issue. Write the summary for a busy approver: what this is, what is off, what you recommend. Note: a deterministic guard enforces the policy floor; you may be stricter, never looser. Reply with one short sentence.`,
})

/** System participant: the desk itself. Sends domain events and never runs inference. */
const desk = createHuman({ name: "Desk", capabilities: [], handlers: [] })

// ───────────────────────────────── situation handlers (reactions) ─────────────────────────────────

class OnEvent extends SituationSpecification {
	constructor(private readonly types: string[], private readonly when: (docId: string) => boolean = () => true) { super() }
	isSatisfiedBy({ event }: SituationContext): boolean {
		if (!this.types.includes(event.type)) return false
		const docId = (event.payload as { docId?: string } | undefined)?.docId
		return !!docId && this.when(docId)
	}
}

const docIdOf = (e: SemanticEvent) => (e.payload as { docId: string }).docId

const checkInParallel: SituationHandler = {
	specification: new OnEvent(["extraction.completed"]),
	processor: {
		apply({ event, participant }) {
			const c = getCase(docIdOf(event))
			const x = c.extraction.result!
			const brief = JSON.stringify({ docId: c.id, fileName: c.fileName, ...x, evidence: undefined }, null, 1)
			if (participant.getId() === validator.getId()) {
				startLoop(validator, MODELS.careful, c, `Validate this extracted payment:\n${brief}`, (t) => { if (t.startsWith(ERROR_MARK)) failStep(c, "validation", t.slice(ERROR_MARK.length)) })
			}
			if (participant.getId() === auditor.getId()) {
				startLoop(auditor, MODELS.careful, c, `Audit this extraction against document ${c.id}:\n${brief}\nEvidence quotes the extractor gave: ${JSON.stringify(x.evidence)}`, (t) => { if (t.startsWith(ERROR_MARK)) failStep(c, "audit", t.slice(ERROR_MARK.length)) })
			}
		},
	},
}

const decideWhenBothChecked: SituationHandler = {
	specification: new OnEvent(["validation.completed", "audit.completed"], (id) => {
		const c = getCase(id)
		return c.validation.status === "done" && c.audit.status === "done" && c.decision.status === "pending"
	}),
	processor: {
		apply({ event }) {
			const c = getCase(docIdOf(event))
			c.stage = "deciding"
			c.decision.status = "running"
			c.decision.startedAt = nowIso()
			emitCase(c)
			const brief = JSON.stringify({ docId: c.id, extraction: { ...c.extraction.result, evidence: undefined }, validation: c.validation.result, audit: c.audit.result }, null, 1)
			startLoop(policyAgent, MODELS.fast, c, `Route this payment:\n${brief}`, (t) => { if (t.startsWith(ERROR_MARK)) failStep(c, "decision", t.slice(ERROR_MARK.length)) })
		},
	},
}

validator.setHandlers([checkInParallel])
auditor.setHandlers([checkInParallel])
policyAgent.setHandlers([decideWhenBothChecked])

/** Observer: forwards Mozaik's own events to the UI feed and keeps token totals per agent. */
class Anything extends SituationSpecification {
	isSatisfiedBy() { return true }
}
const observer = createHuman({
	name: "Observer",
	capabilities: [],
	handlers: [{
		specification: new Anything(),
		processor: {
			apply({ event }) {
				const agent = agentName(event.producerId)
				state.events.set(event.type, (state.events.get(event.type) ?? 0) + 1)
				if (event.type === "inference.completed") {
					const usage = (event.payload as InferenceOutput | undefined)?.tokenUsage
					if (usage) {
						const t = state.tokens.get(agent) ?? { input: 0, output: 0, calls: 0 }
						t.input += usage.inputTokens; t.output += usage.outputTokens; t.calls += 1
						state.tokens.set(agent, t)
						emit("tokens", Object.fromEntries(state.tokens))
					}
				}
				if (!event.type.startsWith("inference.stream")) emit("mozaik", { type: event.type, agent })
			},
		},
	}],
})

const AGENTS: { agent: Agent; role: string; model: string }[] = [
	{ agent: extractor, role: "Reads each document and extracts payment fields with verbatim evidence", model: MODELS.fast },
	{ agent: validator, role: "Checks creditor, IBAN and duplicates against the vendor master", model: MODELS.careful },
	{ agent: auditor, role: "Re-reads the document and verifies every extracted number", model: MODELS.careful },
	{ agent: policyAgent, role: "Applies the payment policy and routes to auto, human or reject", model: MODELS.fast },
]
function agentName(id: string): string {
	return AGENTS.find((a) => a.agent.getId() === id)?.agent.getManifest().name ?? (id === desk.getId() ? "Desk" : id === observer.getId() ? "Observer" : id)
}

join(desk)
join(observer)
for (const { agent } of AGENTS) join(agent)

// ───────────────────────────────── public API ─────────────────────────────────

export function snapshot(): DeskSnapshot {
	return {
		startedAt: state.startedAt,
		agents: AGENTS.map(({ agent, role, model }): AgentInfo => ({ id: agent.getId(), name: agent.getManifest().name, role, model })),
		policy: state.policy,
		vendors: state.vendors,
		cases: [...state.cases.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
		dailyAutoApproved: dailyAutoApproved(),
		cloudEnabled: Boolean(process.env.MOZAIK_API_KEY) || cloudPaired(),
		models: MODELS,
		inboxWaiting: state.startedAt ? 0 : countInboxFiles(),
		runtime: { participants: state.participants.size, events: Object.fromEntries(state.events) },
	}
}

function cloudPaired(): boolean {
	try { return existsSync(joinPath(homedir(), ".mozaik", "credentials.json")) } catch { return false }
}

export function getDocumentText(id: string): string | null {
	return state.documents.get(id)?.text ?? null
}

function newCase(d: SourceDocument): PaymentCase {
	return { id: d.id, fileName: d.fileName, receivedAt: d.receivedAt, stage: "received", extraction: emptyStep(), validation: emptyStep(), audit: emptyStep(), decision: emptyStep(), checks: null, approval: null, sepa: null, timeline: [] }
}

function startExtraction(c: PaymentCase) {
	const d = state.documents.get(c.id)!
	c.stage = "extracting"
	c.extraction.status = "running"
	c.extraction.startedAt = nowIso()
	emitCase(c)
	startLoop(extractor, MODELS.fast, c, `Document ${c.id} (file ${d.fileName}):\n---\n${d.text}\n---\nCall submit_extraction exactly once with docId "${c.id}".`, (t) => {
		if (t.startsWith(ERROR_MARK)) failStep(c, "extraction", t.slice(ERROR_MARK.length))
		else if (c.extraction.status === "running") failStep(c, "extraction", "the agent finished without calling submit_extraction")
	})
}

/** Loads the inbox and starts one Extractor loop per document, all at the same time. */
export function runDesk(): DeskSnapshot {
	const docs = loadDocuments()
	state.startedAt = nowIso()
	state.cases.clear()
	state.documents.clear()
	state.tokens.clear()
	state.events.clear()
	for (const d of docs) {
		state.documents.set(d.id, d)
		state.cases.set(d.id, newCase(d))
	}
	emit("desk.started", snapshot())
	for (const c of state.cases.values()) startExtraction(c)
	return snapshot()
}

/** Adds one pasted document to the running desk and sends it through the same agents. */
export function addDocument(name: string, text: string): PaymentCase {
	const base = (name || "pasted").replace(/\.txt$/i, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "pasted"
	let id = base
	for (let n = 2; state.cases.has(id); n++) id = `${base}-${n}`
	const d: SourceDocument = { id, fileName: `${id}.txt`, text, receivedAt: nowIso() }
	if (!state.startedAt) { state.startedAt = nowIso(); emit("desk.started", snapshot()) }
	state.documents.set(id, d)
	const c = newCase(d)
	state.cases.set(id, c)
	startExtraction(c)
	return c
}

export function recordHumanDecision(id: string, decision: "approved" | "rejected", note: string | null, by = "human"): PaymentCase {
	const c = getCase(id)
	if (c.stage !== "awaiting_approval") throw new Error(`case ${id} is not awaiting approval (stage: ${c.stage})`)
	c.approval = { by: "human", decision, note, at: nowIso() }
	log(c, by, "info", decision === "approved" ? `approved by a human${note ? `: ${note}` : ""}` : `rejected by a human${note ? `: ${note}` : ""}`)
	if (decision === "approved") {
		c.stage = "approved"
		draftSepa(c)
	} else {
		c.stage = "rejected"
	}
	emitCase(c)
	return c
}

/** Recovery for a case an agent failed on: clear the steps and send the document through the desk again. */
export function retryCase(id: string): PaymentCase {
	const c = getCase(id)
	if (c.stage !== "error") throw new Error(`case ${id} has not failed (stage: ${c.stage})`)
	if ([c.extraction, c.validation, c.audit, c.decision].some((s) => s.status === "running")) throw new Error(`an agent is still working on ${id}; try again in a moment`)
	c.extraction = emptyStep(); c.validation = emptyStep(); c.audit = emptyStep(); c.decision = emptyStep()
	c.checks = null; c.approval = null; c.sepa = null
	log(c, "Desk", "info", "retry requested by a human")
	startExtraction(c)
	return c
}

export function isSettled(): boolean {
	return [...state.cases.values()].every((c) => ["awaiting_approval", "approved", "rejected", "not_a_payment", "error"].includes(c.stage))
}
