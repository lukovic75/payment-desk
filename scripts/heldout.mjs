#!/usr/bin/env node
/**
 * Held-out evaluation: uploads the five synthetic invoices in server/data/heldout through the desk's own intake
 * (inspect, then process), waits for the workflow, and compares what happened with expected.json.
 *
 *   node scripts/heldout.mjs [http://localhost:8787] [result.json]
 *
 * It needs a server with real inference (a cloud key, or DESK_INFERENCE=local). On the scripted server every document
 * is refused, which is the point: none of them has a predefined answer. Nothing is retried, and the expected facts never
 * leave this script: they are compared after the fact, never sent to the server.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "")
const OUT = process.argv[3]
const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "server", "data", "heldout")
const { documents } = JSON.parse(readFileSync(join(DIR, "expected.json"), "utf8"))
const call = async (path, body) => { const r = await fetch(BASE + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined); let j = null; try { j = await r.json() } catch { /* not JSON */ } return { status: r.status, body: j } }
const RUNNING = ["received", "extracting", "checking", "investigating", "deciding"]
const OUTCOME = { approved: "AUTO_APPROVED", awaiting_approval: "NEEDS_APPROVAL", blocked: "BLOCKED", not_a_payment: "NOT_A_PAYMENT", error: "PROCESSING_ERROR" }
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase()
const minor = (v) => (v == null ? null : typeof v === "number" ? v : Math.round(Number(String(v).replace(/,/g, "")) * 100))

const health = (await call("/api/health")).body
console.log(`server ${BASE}: mode ${health.mode}, inference ${JSON.stringify(health.inference ?? null)}, models ${health.models.fast} / ${health.models.careful}`)
const results = []
for (const d of documents) {
	const t0 = Date.now()
	const bytes = readFileSync(join(DIR, d.file))
	const seen = await call("/api/documents/inspect", d.file.endsWith(".pdf") ? { name: d.file, pdf: bytes.toString("base64") } : { name: d.file, text: bytes.toString("utf8") })
	if (seen.status !== 200) { results.push({ id: d.id, kind: d.kind, status: "not accepted", note: seen.body?.error }); console.log(`${d.id}: not accepted: ${seen.body?.error}`); continue }
	const started = await call("/api/documents", { token: seen.body.token })
	if (started.status !== 200) { results.push({ id: d.id, kind: d.kind, status: "not processed", note: started.body?.error }); console.log(`${d.id}: not processed (${started.status}): ${started.body?.error}`); continue }
	const caseId = started.body.id
	let c
	for (;;) { await new Promise((r) => setTimeout(r, 3000)); c = (await call("/api/state")).body.cases.find((k) => k.id === caseId); if (c && !RUNNING.includes(c.stage)) break; if (Date.now() - t0 > 30 * 60_000) break }
	const x = c.extraction?.result ?? null, a = c.audit?.result ?? null, v = c.validation?.result ?? null, p = c.decision?.result ?? null
	const f = d.facts
	const field = (name, got, want, same) => ({ field: name, expected: want, extracted: got ?? null, verdict: want == null ? (got == null ? "correctly absent" : "invented") : got == null ? "missing" : same ? "correct" : "incorrect" })
	const fields = x ? [
		field("creditor", x.creditorName, f.creditor, norm(x.creditorName) === norm(f.creditor)),
		field("invoiceNumber", x.invoiceNumber, f.invoiceNumber, norm(x.invoiceNumber) === norm(f.invoiceNumber)),
		field("gross", x.gross, f.gross == null ? null : minor(f.gross), x.gross === minor(f.gross)),
		field("currency", x.currency, f.currency, x.currency === f.currency),
		field("iban", x.iban, f.iban, norm(x.iban) === norm(f.iban)),
	] : []
	const g = c.ledger["X:gross"]?.doc
	const evidence = d.grossQuote == null ? "not applicable" : !g ? "no reference" : !g.located ? "quote not found in the document" : g.supportsValue === false ? "quote does not contain the value" : (g.excerpt ?? "").includes(d.grossQuote) ? "correct line, value verified by code" : "another line"
	const failing = c.controls.filter((k) => k.status === "fail").map((k) => k.id), review = c.controls.filter((k) => k.status === "review").map((k) => k.id)
	// who noticed the discrepancy: an agent's own report, and separately the deterministic controls
	const byAgent = d.discrepancy === "beneficiary" ? { validator: v ? v.ibanMatchesMaster === false : null }
		: d.discrepancy === "conflicting_amounts" ? { auditor: a ? (a.conflicts ?? []).some((k) => k.field === "gross" && k.values.map((s) => minor(s)).includes(minor(d.otherAmount))) : null, extractorReportedOtherAmount: x ? /1[.,]?570/.test(JSON.stringify(x.note ?? "")) : null }
		: d.discrepancy === "missing_field" ? { extractorLeftAmountEmpty: x ? x.gross == null : null, auditorLeftAmountEmpty: a ? a.reading.gross == null : null } : {}
	const byCode = d.discrepancy === "beneficiary" ? failing.includes("beneficiary") : d.discrepancy === "conflicting_amounts" ? review.includes("stated_amounts") || failing.includes("stated_amounts") : d.discrepancy === "missing_field" ? failing.includes("mandatory_fields") : null
	const final = OUTCOME[c.stage] ?? c.stage
	const recommended = p?.recommended?.disposition ?? null
	const order = ["AUTO_APPROVED", "NEEDS_APPROVAL", "BLOCKED"]
	const unsafe = recommended != null && order.indexOf(recommended) >= 0 && order.indexOf(recommended) < Math.min(...d.expected.map((e) => order.indexOf(e)).filter((n) => n >= 0))
	const r = {
		id: d.id, caseId, kind: d.kind, file: c.fileName, pages: c.pdf?.pages ?? null, seconds: Math.round((Date.now() - t0) / 1000),
		expected: d.expected, final, outcomeCorrect: d.expected.includes(final), recommended, unsafeRecommendation: unsafe,
		fields, grossEvidence: evidence, discrepancy: d.discrepancy, noticedByAgent: byAgent, noticedByCode: byCode,
		controls: { failing, review }, challenges: (c.challenges ?? []).map((h) => `${h.field}: ${h.challenged.value} vs ${h.observed.value} (${h.raisedBy}, ${h.status})`),
		draft: c.draft?.draftId ?? null,
		runs: c.runs.map((k) => ({ agent: k.agent, status: k.status, model: k.model, seconds: k.finishedAt ? Math.round((Date.parse(k.finishedAt) - Date.parse(k.startedAt)) / 1000) : null, tokens: k.tokens, error: k.error })),
		outputChecks: (c.timeline ?? []).filter((t) => t.kind === "output_check" || t.kind === "error").map((t) => `${t.agent}: ${t.detail}`.slice(0, 220)),
		auditorSummary: a?.summary ?? null, policyExplanation: p?.recommended?.explanation ?? null,
	}
	results.push(r)
	console.log(`\n${d.id}  ${d.kind}\n  final ${final} (expected ${d.expected.join(" or ")}) ${r.outcomeCorrect ? "OK" : "DIFFERENT"} · recommended ${recommended}${unsafe ? " (UNSAFE recommendation, overruled)" : ""} · ${r.seconds} s · draft ${r.draft ?? "none"}`)
	for (const k of fields) console.log(`  ${k.field.padEnd(14)} ${k.verdict.padEnd(16)} extracted ${JSON.stringify(k.extracted)} expected ${JSON.stringify(k.expected)}`)
	console.log(`  gross evidence: ${evidence}\n  discrepancy ${d.discrepancy ?? "none"}: by an agent ${JSON.stringify(byAgent)}, by code ${byCode}\n  failing ${failing.join(",") || "-"} · review ${review.join(",") || "-"}\n  runs ${r.runs.map((k) => `${k.agent} ${k.status} ${k.seconds}s`).join(" · ")}`)
	for (const o of r.outputChecks) console.log(`  check: ${o}`)
}
const done = results.filter((r) => r.fields)
const allFields = done.flatMap((r) => r.fields)
const count = (v) => allFields.filter((k) => k.verdict === v).length
const withDisc = done.filter((r) => r.discrepancy)
const summary = {
	documents: documents.length, processed: done.length,
	criticalFields: { total: allFields.length, correct: count("correct") + count("correctly absent"), incorrect: count("incorrect"), missing: count("missing"), invented: count("invented") },
	grossEvidenceCorrect: `${done.filter((r) => r.grossEvidence.startsWith("correct")).length} of ${done.filter((r) => r.grossEvidence !== "not applicable").length}`,
	discrepanciesNoticedByAnAgent: `${withDisc.filter((r) => Object.values(r.noticedByAgent).some((v) => v === true)).length} of ${withDisc.length}`,
	discrepanciesCaughtByCode: `${withDisc.filter((r) => r.noticedByCode === true).length} of ${withDisc.length}`,
	unsafeRecommendations: `${done.filter((r) => r.unsafeRecommendation).length} of ${done.filter((r) => r.recommended).length}`,
	finalOutcomeAsExpected: `${done.filter((r) => r.outcomeCorrect).length} of ${done.length}`,
	legitimateBlocked: done.filter((r) => r.expected.includes("AUTO_APPROVED") && r.final !== "AUTO_APPROVED").map((r) => `${r.id}: ${r.final}`),
	seconds: done.reduce((n, r) => n + r.seconds, 0),
}
console.log("\nSUMMARY", JSON.stringify(summary, null, 1))
if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), server: { mode: health.mode, inference: health.inference ?? null, models: health.models }, summary, results }, null, 2))
