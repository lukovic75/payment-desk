/**
 * The controlled architecture fault-injection test on the server: one run at a time, in its own worker process, so it
 * can never touch the payment inbox. What is served is only ever what a run returned; before the first run it is nothing.
 */
import { fork } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DeskError } from "../desk.js"
import { EXPERIMENT_CASES, EXPERIMENT_LABEL, type ExperimentResult } from "./experiment.js"

const here = dirname(fileURLToPath(import.meta.url))
const TIMEOUT_MS = 60_000

export type ExperimentView = {
	label: string
	status: "not_run" | "running" | "done" | "error"
	error: string | null
	/** What will be injected, shown before anything has run. Declarations only; no outcome is ever shown without a run. */
	cases: { id: string; title: string; agent: string; injected: string; doc: string; expectMulti: string[] }[]
	result: ExperimentResult | null
}

let status: ExperimentView["status"] = "not_run"
let error: string | null = null
let result: ExperimentResult | null = null

export const experimentView = (): ExperimentView => ({
	label: EXPERIMENT_LABEL, status, error, result,
	cases: EXPERIMENT_CASES.map(({ id, title, agent, injected, doc, expectMulti }) => ({ id, title, agent, injected, doc, expectMulti })),
})

export function startExperiment(): ExperimentView {
	if (status === "running") throw new DeskError(409, "The test is already running.")
	status = "running"
	error = null
	const child = fork(join(here, "experiment-cli.ts"), [], { cwd: join(here, "..", ".."), execArgv: ["--import", "tsx"], env: { ...process.env, DESK_PERSIST: "off" }, stdio: ["ignore", "inherit", "inherit", "ipc"] })
	const done = (s: "done" | "error", e: string | null, r: ExperimentResult | null) => {
		if (status !== "running") return
		clearTimeout(timer)
		status = s
		error = e
		if (r) result = r
	}
	const timer = setTimeout(() => { child.kill("SIGKILL"); done("error", `The test did not finish within ${TIMEOUT_MS / 1000} s and its worker was stopped.`, null) }, TIMEOUT_MS)
	child.on("message", (m: { type: string; result?: ExperimentResult; error?: string }) => {
		if (m.type === "result" && m.result) done("done", null, m.result)
		else if (m.type === "failed") done("error", m.error ?? "the worker failed", null)
	})
	child.on("exit", (code) => done("error", `The worker process ended without a result (exit code ${code}).`, null))
	child.on("error", (err) => done("error", `The worker process could not start: ${err.message}`, null))
	return experimentView()
}
