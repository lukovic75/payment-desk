/**
 * Local inference: genuine model calls on this machine, through Mozaik's own OpenAI-compatible endpoint.
 *
 * Only the transport changes. The Mozaik runtime still runs the agent loops, the events, the tools and the shared state;
 * `OpenAIChatCompletions` (shipped with @mozaik-ai/core for Ollama, vLLM and similar servers) converts Mozaik's context to
 * chat messages and the model's tool calls back, with their ids and the reported token usage. Nothing here writes an answer.
 *
 * Selected with DESK_INFERENCE=local. There is no fallback from this mode: not to a cloud provider and not to the scripted
 * model. If the local server is not there, calls fail and the payment ends as a processing error.
 */
import { randomUUID } from "node:crypto"
import { DeveloperMessageItem, FunctionCallItem, FunctionCallOutputItem, InputTokenDetails, ModelMessageItem, OpenAIChatCompletions, OutputTokenDetails, SystemMessageItem, TokenUsage, UserMessageItem, type InferenceInput, type InferenceOutput, type InferenceRunner, type Tool } from "@mozaik-ai/core"

/**
 * How a tool call is asked for. "json": the model answers with one JSON object, {"tool": ..., "arguments": ...}, and the
 * server constrains that answer to the tools' schemas, so it always parses. "native": the server's own tool-call parser,
 * through Mozaik's OpenAIChatCompletions endpoint. "json" is the default because a small model's native tool call is
 * easily dropped by the server's parser (seen in testing: 307 tokens generated, an empty message returned).
 */
export type ToolProtocol = "json" | "native"
export type LocalConfig = { baseURL: string; fast: string; careful: string; maxConcurrency: number; provider: string; protocol: ToolProtocol }
export type Inference =
	| { kind: "scripted"; provider: string; endpoint: null }
	| { kind: "cloud"; provider: string; endpoint: null }
	| { kind: "local"; provider: string; endpoint: string; maxConcurrency: number }

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

/** Reads the local configuration, or returns null when local inference is not selected. Throws on a configuration that cannot be honoured. */
export function localConfig(env: NodeJS.ProcessEnv): LocalConfig | null {
	if ((env.DESK_INFERENCE ?? "").toLowerCase() !== "local") return null
	const baseURL = (env.LOCAL_MODEL_BASE_URL ?? "http://127.0.0.1:11434/v1").replace(/\/+$/, "")
	let host: string
	try { host = new URL(baseURL).hostname } catch { throw new Error(`LOCAL_MODEL_BASE_URL is not a URL: ${baseURL}`) }
	// "local" has to mean local: a document is never sent to another machine because of a mistyped address
	if (!LOOPBACK.has(host) && env.LOCAL_MODEL_ALLOW_REMOTE !== "1") throw new Error(`DESK_INFERENCE=local needs a model server on this machine, and LOCAL_MODEL_BASE_URL points at ${host}. Use a localhost address.`)
	const careful = env.LOCAL_CAREFUL_MODEL ?? env.LOCAL_MODEL
	const fast = env.LOCAL_FAST_MODEL ?? env.LOCAL_MODEL
	if (!careful || !fast) throw new Error("DESK_INFERENCE=local needs a model: set LOCAL_MODEL (or LOCAL_FAST_MODEL and LOCAL_CAREFUL_MODEL) to a model the local server has, for example qwen2.5:7b-instruct.")
	const n = Number(env.LOCAL_MAX_CONCURRENCY ?? 1)
	if (!Number.isInteger(n) || n < 1 || n > 8) throw new Error("LOCAL_MAX_CONCURRENCY must be a whole number from 1 to 8.")
	const protocol = (env.LOCAL_TOOL_PROTOCOL ?? "json").toLowerCase()
	if (protocol !== "json" && protocol !== "native") throw new Error("LOCAL_TOOL_PROTOCOL must be json or native.")
	return { baseURL, fast, careful, maxConcurrency: n, protocol, provider: env.LOCAL_MODEL_PROVIDER ?? (/:11434\b/.test(baseURL) ? "Ollama" : "local model server") }
}

/** What the server shows as the model of a loop in local mode: the model's own name, and where it ran. */
export const localLabel = (model: string, provider: string) => `${model} · ${provider}, this machine`

/** Asks the local server which models it has. A clear sentence when it is not there or does not have the model; never a fallback. */
export async function probeLocal(cfg: LocalConfig, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
	let ids: string[]
	try {
		const r = await fetchImpl(`${cfg.baseURL}/models`, { signal: AbortSignal.timeout(4000) })
		if (!r.ok) return { ok: false, error: `The local model server at ${cfg.baseURL} answered ${r.status} to a request for its models.` }
		ids = ((await r.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? []
	} catch {
		return { ok: false, error: `No local model server answers at ${cfg.baseURL}. Start it (for Ollama: \`ollama serve\`) or change LOCAL_MODEL_BASE_URL. Nothing is substituted for it.` }
	}
	const missing = [...new Set([cfg.fast, cfg.careful])].filter((m) => !ids.includes(m))
	if (missing.length) return { ok: false, error: `The local model server does not have ${missing.join(" or ")}. It has: ${ids.slice(0, 12).join(", ") || "no models"}.` }
	return { ok: true }
}

/** How many model requests are in flight and how many are waiting for a slot. Agent loops overlapping is not the same thing as model calls overlapping. */
export type LocalStats = { active: number; waiting: number; peakActive: number; calls: number }
const stats: LocalStats = { active: 0, waiting: 0, peakActive: 0, calls: 0 }
export const localStats = (): LocalStats => ({ ...stats })

// ───────── the "json" protocol: tool calls as schema-constrained JSON ─────────

type Json = Record<string, unknown>
const DROP = new Set(["default", "maxLength", "minLength", "maxItems", "minItems", "pattern", "format", "$schema", "description", "title"])
const allowsNull = (s: Json): boolean => s.type === "null" || (Array.isArray(s.type) && s.type.includes("null")) || (Array.isArray(s.anyOf) && (s.anyOf as Json[]).some(allowsNull)) || s.const === null
/**
 * The schema the server is asked to enforce. Every property becomes required, and one that was optional may be null
 * instead: the usual "strict" form for constrained output, where a model cannot silently leave a field out. Annotations a
 * grammar cannot enforce are dropped; the desk's own validation of the tool arguments still applies afterwards, in full.
 */
export function strictSchema(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(strictSchema)
	if (!schema || typeof schema !== "object") return schema
	const src = schema as Json
	const out: Json = {}
	for (const [k, v] of Object.entries(src)) if (!DROP.has(k)) out[k] = k === "properties" || k === "required" ? v : strictSchema(v)
	if (src.properties && typeof src.properties === "object") {
		const required = new Set(Array.isArray(src.required) ? (src.required as string[]) : [])
		const props: Json = {}
		for (const [k, v] of Object.entries(src.properties as Json)) {
			const inner = strictSchema(v) as Json
			props[k] = required.has(k) || allowsNull(inner) ? inner : { anyOf: [inner, { type: "null" }] }
		}
		out.properties = props
		out.required = Object.keys(props)
		out.additionalProperties = false
	}
	return out
}
/** Removes the nulls the strict form made room for, wherever the tool's own schema has no null there: an optional field left out is left out. */
export function pruneNulls(value: unknown, schema: unknown): unknown {
	if (!schema || typeof schema !== "object") return value
	const s = schema as Json
	if (Array.isArray(s.anyOf)) { const hit = (s.anyOf as Json[]).find((o) => !allowsNull(o) || o.properties || o.items); return hit ? pruneNulls(value, hit) : value }
	if (Array.isArray(value)) return s.items ? value.map((v) => pruneNulls(v, s.items)) : value
	if (value && typeof value === "object" && s.properties && typeof s.properties === "object") {
		const out: Json = {}
		for (const [k, v] of Object.entries(value as Json)) {
			const ps = (s.properties as Json)[k] as Json | undefined
			if (v === null && ps && !allowsNull(ps)) continue
			out[k] = ps ? pruneNulls(v, ps) : v
		}
		return out
	}
	return value
}
const envelope = (tools: Tool[]) => {
	const one = (t: Tool) => ({ type: "object", properties: { tool: { type: "string", enum: [t.name] }, arguments: strictSchema(t.parameters) }, required: ["tool", "arguments"], additionalProperties: false })
	return tools.length === 1 ? one(tools[0]!) : { anyOf: tools.map(one) }
}
const PROTOCOL = (tools: Tool[]) => `\n\nYou act only by calling a tool. Reply with exactly one JSON object and nothing else: {"tool": "<tool name>", "arguments": {...}}. Give every field of the arguments; use null where the document or the records give you nothing. Never invent a value.\nTools you can call:\n${tools.map((t) => `- ${t.name}: ${t.description}\n  arguments schema: ${JSON.stringify(t.parameters)}`).join("\n")}`

/** Mozaik's context as chat messages for the "json" protocol: an earlier tool call is the assistant's JSON, its result a user message that names the tool. */
export function jsonMessages(req: InferenceInput): { role: "system" | "user" | "assistant"; content: string }[] {
	const tools = req.tools ?? []
	const out: { role: "system" | "user" | "assistant"; content: string }[] = []
	const names = new Map<string, string>()
	let system = false
	for (const item of req.context.getItems()) {
		if (item instanceof DeveloperMessageItem || item instanceof SystemMessageItem) { out.push({ role: "system", content: item.content.text + (system || !tools.length ? "" : PROTOCOL(tools)) }); system = true }
		else if (item instanceof UserMessageItem) out.push({ role: "user", content: item.content.text })
		else if (item instanceof ModelMessageItem) out.push({ role: "assistant", content: item.content.text })
		else if (item instanceof FunctionCallItem) { names.set(item.callId, item.name); let args: unknown = {}; try { args = JSON.parse(item.args) } catch { /* sent as it was */ } out.push({ role: "assistant", content: JSON.stringify({ tool: item.name, arguments: args }) }) }
		else if (item instanceof FunctionCallOutputItem) out.push({ role: "user", content: `Result of ${names.get(item.callId) ?? "the tool"}:\n${item.output.text}\n\nContinue with your next tool call, as one JSON object.` })
	}
	if (!system && tools.length) out.unshift({ role: "system", content: PROTOCOL(tools).trim() })
	return out
}
/** The model's JSON answer as a Mozaik tool call. An answer that is not a call to one of the offered tools is handed on as the text it was. */
export function jsonToOutput(content: string, tools: Tool[], usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined, raw: unknown): InferenceOutput {
	const tokenUsage = usage ? new TokenUsage(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0), new InputTokenDetails(0), new OutputTokenDetails(0)) : undefined
	let parsed: { tool?: unknown; arguments?: unknown } | null = null
	try { parsed = JSON.parse(content) } catch { /* not JSON: handled as text below */ }
	const tool = parsed && typeof parsed.tool === "string" ? tools.find((t) => t.name === parsed!.tool) : undefined
	if (!tool || !parsed || parsed.arguments == null || typeof parsed.arguments !== "object") return { items: content.trim() ? [ModelMessageItem.rehydrate({ text: content })] : [], tokenUsage, rowResponse: raw }
	return { items: [FunctionCallItem.rehydrate({ callId: `call_${randomUUID().slice(0, 12)}`, name: tool.name, args: JSON.stringify(pruneNulls(parsed.arguments, tool.parameters)) })], tokenUsage, rowResponse: raw }
}

export function localRunner(cfg: LocalConfig, fetchImpl: typeof fetch = fetch): InferenceRunner {
	const endpoint = new OpenAIChatCompletions(undefined, { baseURL: cfg.baseURL, apiKey: "local", extraBody: { temperature: 0, seed: 7, max_tokens: 2000 } })
	const queue: (() => void)[] = []
	const acquire = (): Promise<void> => {
		if (stats.active < cfg.maxConcurrency) { stats.active++; stats.peakActive = Math.max(stats.peakActive, stats.active); return Promise.resolve() }
		stats.waiting++
		return new Promise((res) => queue.push(() => { stats.waiting--; stats.active++; stats.peakActive = Math.max(stats.peakActive, stats.active); res() }))
	}
	const release = () => { stats.active--; queue.shift()?.() }
	const viaJson = async (req: InferenceInput): Promise<InferenceOutput> => {
		const tools = req.tools ?? []
		const body: Json = { model: req.model, messages: jsonMessages(req), temperature: 0, seed: 7, max_tokens: req.maxOutputTokens ?? 2000, stream: false }
		if (tools.length) body.response_format = { type: "json_schema", json_schema: { name: "tool_call", strict: true, schema: envelope(tools) } }
		const r = await fetchImpl(`${cfg.baseURL}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer local" }, body: JSON.stringify(body) })
		const text = await r.text()
		if (!r.ok) throw new Error(`${r.status} from the local model server: ${text.slice(0, 300)}`)
		let j: { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
		try { j = JSON.parse(text) } catch { throw new Error(`The local model server answered with something that is not JSON: ${text.slice(0, 120)}`) }
		return jsonToOutput(j.choices?.[0]?.message?.content ?? "", tools, j.usage, j)
	}
	return {
		async run(req: InferenceInput): Promise<InferenceOutput> {
			await acquire()
			stats.calls++
			try {
				// a local server takes neither a reasoning effort nor a stream here; everything else is passed as Mozaik built it
				const out = cfg.protocol === "json" ? await viaJson(req) : await endpoint.infer({ ...req, reasoningEffort: undefined, streaming: false })
				// LOCAL_MODEL_TRACE=1 prints what the local server returned, for diagnosing a model that answers oddly. Off by default.
				if (process.env.LOCAL_MODEL_TRACE === "1") console.error(`[local model] ${JSON.stringify(out.rowResponse?.choices?.[0] ?? null).slice(0, 2400)} usage ${JSON.stringify(out.rowResponse?.usage ?? null)}`)
				return out
			} finally { release() }
		},
		stream: (req) => endpoint.stream(req) as ReturnType<InferenceRunner["stream"]>,
	}
}
