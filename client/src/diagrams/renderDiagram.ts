/**
 * A DIAGRAM'S PICTURE (🔒 YAZ-1802 D9), drawn by draw.io's own read-only viewer — the ONE renderer
 * for every place a `.drawio` is seen outside its editor: the sidebar's hover preview
 * (`createScenePreviewPng`'s twin), Version history, and File › Export Image….
 *
 * The viewer runs where the editor runs: on the drawio ORIGIN, under its no-network CSP, in our
 * own small page (`app://drawio/yaseen-render.html`, written into the webapp by packDrawio — no
 * draw.io file is touched). ONE hidden iframe serves every request for the renderer's life;
 * each request is `{ id, xml, theme, adaptive, format, scale, padding, maxWidth?, maxHeight?, page? }`,
 * each answer a data URL of the page (an embed's: its SVG text; `''` when the page is empty) or a failure, and both
 * travel as JSON strings checked against that iframe's window and origin, exactly like the
 * editor's protocol.
 *
 * The frame is laid out off-screen rather than `display: none`: draw.io measures its labels in
 * its own document, and a document with no layout would measure every label as zero.
 *
 * The frame closes after `IDLE_CLOSE_MS` with no picture asked (YAZ-3737 S14): it holds a whole
 * draw.io page, maybe its own process. The next picture opens a fresh one.
 */
import { DRAWIO_ORIGIN } from '@shared/drawio'
import type { DiagramDarkColors } from '@shared/types'
import type { PreviewBounds } from '../lib/scenePreview'
import { diagramLinkLooks, type WireLook } from './diagramLooks'
import { drawioAdaptiveColors } from './drawioProtocol'

const RENDER_URL = `${DRAWIO_ORIGIN}/yaseen-render.html`
/** A picture that has not come back by then is a failure ("Preview unavailable"), not a hang. */
const RENDER_TIMEOUT_MS = 15_000
/** An exported image's margin: Excalidraw's own export default (`DEFAULT_EXPORT_PADDING`). */
const EXPORT_PADDING = 10
/** How long the frame stays open after its last picture (S14). */
export const IDLE_CLOSE_MS = 5 * 60_000

interface RenderRequest {
  xml: string
  theme: 'light' | 'dark'
  adaptive: 'auto' | 'none'
  /** `svgText`: the SVG text itself, not a data URL (an embed's blob, A20). */
  format: 'svg' | 'png' | 'svgText'
  scale: number
  padding: number
  maxWidth?: number
  maxHeight?: number
  /** What the diagram's link pills show (YAZ-4748 D9); absent, they keep the raw text. */
  looks?: Record<string, WireLook | null>
  /** The page id to draw (YAZ-4825, D6); absent or gone, the first page. */
  page?: string | null
}

/** A diagram page as "Page ▸" lists it (YAZ-4825). */
export interface DiagramPageRef {
  id: string
  name: string
}

/** The board rectangle a picture covers, in diagram units (YAZ-4825): left, top, width, height. */
export interface BoardBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The renderer's whole answer (YAZ-4825): the picture — a data URL, or for `svgText` the SVG text (`''` for an empty
 * page) — and the page it drew, every page and the picture's bounds, which an embed's window reads.
 */
export interface DiagramPicture {
  picture: string
  page: string | null
  pages: DiagramPageRef[]
  bounds: BoardBounds | null
}

interface Pending {
  resolve: (answer: DiagramPicture) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let frame: HTMLIFrameElement | null = null
let ready: Promise<HTMLIFrameElement> | null = null
const pending = new Map<string, Pending>()
let serial = 0
let idle: ReturnType<typeof setTimeout> | undefined

/** Removes the frame; the next `renderFrame` makes a new one. */
function closeFrame(): void {
  window.removeEventListener('message', onAnswer)
  frame?.remove()
  frame = null
  ready = null
}

/**
 * The shared frame, created on first use; resolves once its page says `ready`. A frame that never
 * says it (no webapp unpacked, say) fails its callers and is thrown away, so the NEXT picture
 * starts a fresh one instead of every hover failing until the app restarts.
 */
function renderFrame(): Promise<HTMLIFrameElement> {
  if (ready !== null) return ready
  const f = document.createElement('iframe')
  f.src = RENDER_URL
  f.title = 'Diagram preview renderer'
  f.tabIndex = -1
  f.setAttribute('aria-hidden', 'true')
  f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:800px;border:0;visibility:hidden;pointer-events:none;'
  frame = f
  ready = new Promise<HTMLIFrameElement>((resolve, reject) => {
    const onReady = (ev: MessageEvent): void => {
      if (ev.source !== f.contentWindow || ev.origin !== DRAWIO_ORIGIN || typeof ev.data !== 'string') return
      try {
        if ((JSON.parse(ev.data) as { event?: unknown }).event !== 'ready') return
      } catch {
        return
      }
      window.removeEventListener('message', onReady)
      clearTimeout(giveUp)
      resolve(f)
    }
    const giveUp = setTimeout(() => {
      window.removeEventListener('message', onReady)
      closeFrame()
      reject(new Error('diagram preview renderer did not start'))
    }, RENDER_TIMEOUT_MS)
    window.addEventListener('message', onReady)
  })
  window.addEventListener('message', onAnswer)
  document.body.appendChild(f)
  return ready
}

/** Every answer from the frame, matched to its request by id. */
function onAnswer(ev: MessageEvent): void {
  if (frame === null || ev.source !== frame.contentWindow || ev.origin !== DRAWIO_ORIGIN || typeof ev.data !== 'string') return
  let msg: { id?: unknown; ok?: unknown; dataUrl?: unknown; svg?: unknown; error?: unknown; pages?: unknown; page?: unknown; bounds?: unknown }
  try {
    msg = JSON.parse(ev.data) as typeof msg
  } catch {
    return
  }
  if (typeof msg.id !== 'string') return
  const job = pending.get(msg.id)
  if (job === undefined) return
  pending.delete(msg.id)
  clearTimeout(job.timer)
  const picture = typeof msg.svg === 'string' ? msg.svg : msg.dataUrl
  if (msg.ok === true && typeof picture === 'string')
    job.resolve({
      picture,
      pages: Array.isArray(msg.pages) ? (msg.pages as DiagramPageRef[]).filter((p) => typeof p?.id === 'string').map((p) => ({ id: p.id, name: String(p.name ?? p.id) })) : [],
      page: typeof msg.page === 'string' ? msg.page : null,
      bounds: isBounds(msg.bounds) ? msg.bounds : null,
    })
  else job.reject(new Error(typeof msg.error === 'string' ? msg.error : 'diagram picture failed'))
}

function isBounds(v: unknown): v is BoardBounds {
  const b = v as BoardBounds | null
  return typeof b === 'object' && b !== null && [b.x, b.y, b.width, b.height].every(Number.isFinite)
}

async function renderAnswer(req: RenderRequest): Promise<DiagramPicture> {
  clearTimeout(idle)
  try {
    const f = await renderFrame()
    const id = `r${++serial}`
    return await new Promise<DiagramPicture>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('diagram picture timed out'))
      }, RENDER_TIMEOUT_MS)
      pending.set(id, { resolve, reject, timer })
      f.contentWindow?.postMessage(JSON.stringify({ id, ...req }), DRAWIO_ORIGIN)
    })
  } finally {
    // The last picture out starts the idle clock; a picture asked meanwhile stops it again.
    if (pending.size === 0) {
      clearTimeout(idle)
      idle = setTimeout(closeFrame, IDLE_CLOSE_MS)
    }
  }
}

/** The picture alone: what every caller before YAZ-4825 asks for. */
const render = (req: RenderRequest): Promise<string> => renderAnswer(req).then((answer) => answer.picture)

/**
 * The first page of `xml` as an SVG data URL fit inside `bounds`, in the app's `theme` and its
 * dark-mode colour setting (🔒 YAZ-1802 D16) — what the editor would show; `''` for a page with
 * nothing on it. Rejects when the XML is not a diagram, or nothing answers in time.
 */
export function renderDiagramPreview(xml: string, theme: 'light' | 'dark', darkColors: DiagramDarkColors, bounds: PreviewBounds): Promise<string> {
  return render({ xml, theme, adaptive: drawioAdaptiveColors(darkColors), format: 'svg', scale: 1, padding: bounds.padding, maxWidth: bounds.maxWidth, maxHeight: bounds.maxHeight, looks: diagramLinkLooks(xml) })
}

/**
 * File › Export Image… for a diagram: its first page at full size, as an SVG or a PNG data URL.
 * Light, in the file's own colours — Excalidraw's export default (`exportWithDarkMode: false`); the
 * PNG at twice the size, so it stays crisp on a retina screen and in a slide.
 *
 * WHY THE D9 RENDERER AND NOT draw.io's EMBED `export` ACTION on the open editor: ONE code path
 * draws every diagram picture the app makes — preview, history, export — so an export can never
 * look different from its preview, and it needs nothing from the editor but the XML it last posted.
 */
export function renderDiagramImage(xml: string, format: 'svg' | 'png'): Promise<string> {
  return render({ xml, theme: 'light', adaptive: 'none', format, scale: format === 'png' ? 2 : 1, padding: EXPORT_PADDING, looks: diagramLinkLooks(xml) })
}

/**
 * A board embed's window (YAZ-4825, D6): the page `page` of `xml` (the first page when it is null or gone) at scale 1,
 * with no size limit, in the app's theme and dark-mode colour setting, as the preview draws it, as SVG TEXT (A20);
 * plus the page list for "Page ▸" and the board rectangle the picture covers, so the window can pan and zoom it.
 */
export function renderDiagramPage(xml: string, page: string | null, theme: 'light' | 'dark', darkColors: DiagramDarkColors): Promise<DiagramPicture> {
  return renderAnswer({ xml, theme, adaptive: drawioAdaptiveColors(darkColors), format: 'svgText', scale: 1, padding: EXPORT_PADDING, looks: diagramLinkLooks(xml), page })
}
