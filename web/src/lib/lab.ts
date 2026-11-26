/** Client for the Financial Stress Lab. Everything shown comes from these endpoints; nothing is computed into existence here. */
import { useCallback, useEffect, useRef, useState } from "react"
import type { LabDetail, LabMode, LabOverview } from "../../../server/lab/types"

export type { BenchmarkView, Check, ConfigMetrics, DocMetric, ItemStatus, LabDetail, LabItemView, LabMode, LabOverview, LabRunView, LabScenarioView, Ratio, ScenarioResult } from "../../../server/lab/types"

async function ok<T>(r: Response): Promise<T> {
	if (!r.ok) {
		let msg = `${r.status} ${r.statusText}`
		try { msg = (await r.json()).error ?? msg } catch { /* body was not JSON */ }
		throw new Error(msg)
	}
	return r.json()
}

/** The lab's scenarios and recorded runs. Polls quickly while a run is active and slowly otherwise. */
export function useLab(): { data: LabOverview | null; error: string | null; refresh: () => Promise<void> } {
	const [data, setData] = useState<LabOverview | null>(null)
	const [error, setError] = useState<string | null>(null)
	const refresh = useCallback(async () => {
		try { setData(await ok<LabOverview>(await fetch("/api/lab"))); setError(null) } catch (e) { setError((e as Error).message) }
	}, [])
	const active = data?.active != null
	useEffect(() => {
		refresh()
		const t = setInterval(refresh, active ? 700 : 6000)
		return () => clearInterval(t)
	}, [refresh, active])
	return { data, error, refresh }
}

/** The full record of one scenario execution; refetched while it is still running, so the agent timeline is live. */
export function useLabDetail(runId: string | null, key: string | null, running: boolean, stamp: string | null): { detail: LabDetail | null; error: string | null } {
	const [detail, setDetail] = useState<LabDetail | null>(null)
	const [error, setError] = useState<string | null>(null)
	const want = useRef<string | null>(null)
	useEffect(() => {
		const id = runId && key ? `${runId}/${key}` : null
		want.current = id
		if (!id) { setDetail(null); return }
		let stop = false
		const load = async () => {
			try {
				const d = await ok<LabDetail>(await fetch(`/api/lab/runs/${encodeURIComponent(runId!)}/items/${encodeURIComponent(key!)}`))
				if (!stop && want.current === id) { setDetail(d); setError(null) }
			} catch (e) { if (!stop) setError((e as Error).message) }
		}
		load()
		const t = running ? setInterval(load, 600) : undefined
		return () => { stop = true; clearInterval(t) }
	}, [runId, key, running, stamp])
	return { detail: detail && runId && key && detail.runId === runId && detail.item.key === key ? detail : null, error }
}

export async function startLabRun(body: { kind: "scenario" | "suite" | "benchmark"; mode: LabMode; scenarioIds?: string[]; confirmLive?: boolean }): Promise<{ id: string }> {
	return ok(await fetch("/api/lab/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
}
export const cancelLabRun = async (): Promise<void> => { await ok(await fetch("/api/lab/cancel", { method: "POST" })) }
export const labReportUrl = (runId: string, key?: string) => `/api/lab/runs/${encodeURIComponent(runId)}/report${key ? `?item=${encodeURIComponent(key)}` : ""}`
