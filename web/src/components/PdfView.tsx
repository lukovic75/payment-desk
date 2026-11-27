import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { CaretLeft, CaretRight, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react"

/**
 * Shows the original PDF, one page at a time, with an optional highlight over a known region of the page.
 *
 * The page is drawn to a canvas and nothing else from the document is used: no links, no forms, no scripts, no
 * attachments. The highlight is placed from the box the server's parser measured for that line, scaled by the same factor
 * as the page, so it stays on the text at any zoom or width. When no box is known, none is drawn.
 * The renderer is loaded only when a PDF is actually opened.
 */

type Box = [number, number, number, number]
type Props = { url: string; pages: { n: number; w: number; h: number }[]; page?: number; highlight?: Box | null; label: string }

let lib: Promise<typeof import("pdfjs-dist")> | null = null
const pdfjs = () => (lib ??= import("pdfjs-dist").then((m) => {
	m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
	return m
}))

const ZOOMS = [1, 1.5, 2]

export function PdfView({ url, pages, page = 1, highlight, label }: Props) {
	const frame = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const [n, setN] = useState(page)
	const [zoom, setZoom] = useState(0)
	const [width, setWidth] = useState(0)
	const [state, setState] = useState<"loading" | "ready" | "error">("loading")
	const [error, setError] = useState("")
	const doc = useRef<{ url: string; proxy: any; task: any } | null>(null)

	// the page asked for from outside wins whenever it changes (a new piece of evidence was selected)
	useEffect(() => { setN(page) }, [page, url])

	useLayoutEffect(() => {
		const el = frame.current
		if (!el) return
		const on = () => setWidth(el.clientWidth)
		on()
		const ro = new ResizeObserver(on)
		ro.observe(el)
		return () => ro.disconnect()
	}, [])

	// One document at a time. Closing the viewer, or opening another file, releases the previous one.
	useEffect(() => () => { void doc.current?.task.destroy(); doc.current = null }, [])

	const size = pages.find((p) => p.n === n) ?? pages[0]
	const scale = size && width ? (width / size.w) * ZOOMS[zoom]! : 0

	useEffect(() => {
		if (!scale || !size) return
		let gone = false
		let render: any
		;(async () => {
			try {
				const m = await pdfjs()
				if (doc.current?.url !== url) {
					void doc.current?.task.destroy()
					setState("loading")
					// isEvalSupported off, no XFA forms: the file is displayed, never run
					const task = m.getDocument({ url, isEvalSupported: false, enableXfa: false })
					doc.current = { url, task, proxy: await task.promise }
				}
				if (gone) return
				const p = await doc.current!.proxy.getPage(n)
				const dpr = Math.min(2, devicePixelRatio || 1)
				const viewport = p.getViewport({ scale: scale * dpr })
				const el = canvas.current
				if (gone || !el) return
				el.width = Math.round(viewport.width); el.height = Math.round(viewport.height)
				render = p.render({ canvas: el, viewport })
				await render.promise
				if (!gone) setState("ready")
			} catch (e) {
				if (gone || (e as Error)?.name === "RenderingCancelledException") return
				setError(/404|Missing|Unexpected server response/.test(String((e as Error)?.message)) ? "The original file is not available any more. The extracted text and its references are kept." : "This PDF could not be displayed.")
				setState("error")
			}
		})()
		return () => { gone = true; render?.cancel() }
	}, [url, n, scale])

	if (!size) return null
	const w = size.w * scale, h = size.h * scale
	const onPage = highlight && page === n
	return (
		<figure className="pdf" aria-label={label}>
			<div className="pdf-bar">
				<button type="button" className="btn btn-sm btn-icon" aria-label="Previous page" disabled={n <= 1} onClick={() => setN(n - 1)}><CaretLeft size={13} weight="bold" /></button>
				<span className="pdf-page" aria-live="polite">Page {n} of {pages.length}</span>
				<button type="button" className="btn btn-sm btn-icon" aria-label="Next page" disabled={n >= pages.length} onClick={() => setN(n + 1)}><CaretRight size={13} weight="bold" /></button>
				<span className="grow" />
				<button type="button" className="btn btn-sm btn-icon" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom(zoom - 1)}><MagnifyingGlassMinus size={14} /></button>
				<span className="pdf-zoom">{Math.round(ZOOMS[zoom]! * 100)}%</span>
				<button type="button" className="btn btn-sm btn-icon" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(zoom + 1)}><MagnifyingGlassPlus size={14} /></button>
			</div>
			<div className="pdf-frame" ref={frame} data-state={state} tabIndex={0} aria-label={`${label}, page ${n}. Scroll to move around the page.`}>
				{state === "error" ? <p className="pdf-msg" role="alert">{error}</p> : (
					<div className="pdf-sheet" style={{ width: w || undefined, height: h || undefined }}>
						<canvas ref={canvas} style={{ width: w, height: h }} aria-hidden />
						{onPage && state === "ready" && <mark className="pdf-hl" aria-hidden style={{ left: highlight[0] * scale, top: highlight[1] * scale, width: (highlight[2] - highlight[0]) * scale, height: (highlight[3] - highlight[1]) * scale }} />}
						{state === "loading" && <span className="pdf-msg">Opening the document…</span>}
					</div>
				)}
			</div>
		</figure>
	)
}
