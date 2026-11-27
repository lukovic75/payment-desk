#!/usr/bin/env node
/**
 * Stores the showcase cases of a running desk as server/data/recordings/current.json, so that a run with real models on
 * this version of the code can be replayed without calling a model again.
 *
 *   node scripts/capture-recording.mjs [http://localhost:8787]
 *
 * It refuses a scripted server: predefined responses are not a recording of model output. Cases are stored as the
 * server holds them (agent outputs, timings, tool calls, evidence, decisions, and any model error). Model reasoning is
 * not recorded by the desk, so none is stored. No credential is part of a case.
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "")
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const s = await (await fetch(`${BASE}/api/state`)).json()
if (s.modelMode !== "live") { console.error("This server runs the scripted model. Predefined responses are not recorded as model output."); process.exit(1) }
if (!s.showcase) { console.error("No showcase has been run on this server."); process.exit(1) }
const ids = s.showcase.steps.filter((k) => k.startedAt).map((k) => k.docId)
const cases = s.cases.filter((c) => ids.includes(c.id))
if (cases.some((c) => ["received", "extracting", "checking", "investigating", "deciding"].includes(c.stage))) { console.error("A scenario is still running."); process.exit(1) }
let commit = "unknown"
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { /* not a git checkout */ }
const where = s.inference?.kind === "local" ? `${s.inference.provider} on the machine that ran it (local inference, no cloud provider)` : `${s.inference?.provider ?? "a cloud provider"}`
const models = [...new Set([s.models.fast, s.models.careful])].join(" and ")
const first = cases.flatMap((c) => c.runs.map((r) => r.startedAt)).sort()[0]
const record = {
	recordedAt: first,
	version: `this version of the code, ${models} through ${s.inference?.kind === "local" ? `${s.inference.provider}, local` : s.inference?.provider ?? "cloud"}`,
	note: `Stored execution records of a run on ${first.slice(0, 10)} with real model inference through Mozaik: ${models}, served by ${where}. Code: the working tree on top of commit ${commit}. Scenarios run: ${cases.length} of the showcase's ${s.showcase.steps.length}. Agent outputs, tool calls, timings, evidence and decisions are stored as the server held them, before any person acted on a case. Model reasoning is not recorded.`,
	models: s.models,
	cases,
}
const out = join(ROOT, "server", "data", "recordings", "current.json")
writeFileSync(out, JSON.stringify(record, null, 1) + "\n")
if (/sk-ant-|AIza[0-9A-Za-z_-]{20}|sk-[A-Za-z0-9]{32}/.test(JSON.stringify(record))) { console.error("Something that looks like a credential is in the recording. Remove the file and look at it."); process.exit(1) }
console.log(`${out}\n${cases.length} case(s): ${cases.map((c) => `${c.id} ${c.stage}`).join(", ")}\n${record.version}`)
