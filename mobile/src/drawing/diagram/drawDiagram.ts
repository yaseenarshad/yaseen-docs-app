/**
 * A PLAIN DRAW.IO DIAGRAM'S PICTURE ON THE PHONE (YAZ-5533): the Mac's renderer (`client/src/diagrams/renderDiagram.ts`)
 * ported to the phone. ONE hidden frame of the app, same origin, loads the phone's renderer page
 * (`/drawio/<hash>/render`: draw.io's own read-only viewer `viewer-static.min.js`, the Mac's v31.5.2, and the Mac's
 * `yaseen-render.js`, unchanged) under its own strict CSP (`public/_headers`, `/drawio/*`). Each request is the Mac's:
 * `{ id, xml, theme, adaptive, format: 'svgText', scale, padding, page, looks }`; each answer the SVG text, the pages
 * and the page drawn. Messages are JSON strings, checked against that frame's window and this site's origin.
 *
 * This file is its own small chunk, loaded when a page shows a `.drawio`; the frame's files load then, from this site,
 * the first time (the service worker keeps them from then on; none is in the install). Nothing is saved: the picture
 * is a string in memory (`watchDrawings` shows it as a `blob:` image, revoked when it goes).
 *
 * The frame closes after `IDLE_CLOSE_MS` with no picture asked (it holds a whole draw.io page). It is laid out off the
 * screen, not `display: none`: draw.io measures its labels in its own document.
 */


export { diagramFigure } from './figure'
export type { DiagramFigure, FigureDoors } from './figure'

declare const __NOTECARDS_DRAWIO__: string | undefined

/** The draw.io folder of this build (`/drawio/<hash>/`); in tests, a stand-in. */
export const DRAWIO_BASE = typeof __NOTECARDS_DRAWIO__ === 'string' ? __NOTECARDS_DRAWIO__ : '/drawio/dev/'
/** The renderer page (served without `.html`, as the host serves pages). */
export const RENDER_PATH = `${DRAWIO_BASE}render`
/** The first open downloads the viewer (0.9 MB gzip) on a phone's signal: a long wait before "not ready". */
export const READY_TIMEOUT_MS = 60_000
/** After the frame's page loaded, its "ready" comes at once; with none, it did not load (no signal, the first time). */
export const LOADED_GRACE_MS = 4_000
/** A request can wait for a big shape library (AWS: 1.1 MB gzip) the first time. */
export const RENDER_TIMEOUT_MS = 60_000
export const IDLE_CLOSE_MS = 5 * 60_000
/** The Mac's embed window: scale 1, an export's margin (`renderDiagramPage`). */
const PADDING = 10

/** A page of a diagram, as the page picker lists it. */
export interface DiagramPage {
  id: string
  name: string
}

export interface DiagramDrawn {
  svg: string
  width: number
  height: number
  pages: DiagramPage[]
  /** The page drawn (null for a file with one bare model). */
  page: string | null
  /** Shape libraries that were not on the phone yet (no signal): their shapes drew as placeholder boxes. */
  missing: string[]
}

export interface DiagramInput {
  text: string
  theme: 'light' | 'dark'
  /** The page to draw; absent or gone, the first. */
  page?: string | null
}

/** The viewer could not load: no signal, and its files are not on the phone yet. */
export class DiagramUnavailable extends Error {
  override name = 'DiagramUnavailable'
}

/** Where the frame lives: the page's document (a test gives its own). */
export interface FrameHost {
  document: Document
  window: Window
}

interface Pending {
  resolve: (answer: DiagramDrawn | 'empty') => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
  missing: string[]
}

export interface DiagramRenderer {
  draw(input: DiagramInput): Promise<DiagramDrawn | 'empty'>
  close(): void
}

const sizeOf = (svg: string, name: 'width' | 'height'): number => {
  const m = new RegExp(`^<svg[^>]*?\\s${name}="([0-9.]+)(px)?"`).exec(svg)
  return m ? Number(m[1]) : 0
}

export function diagramRenderer(host: FrameHost = { document, window }): DiagramRenderer {
  const { document: doc, window: win } = host
  const origin = win.location.origin
  let frame: HTMLIFrameElement | null = null
  let ready: Promise<HTMLIFrameElement> | null = null
  const pending = new Map<string, Pending>()
  let serial = 0
  let idle: ReturnType<typeof setTimeout> | undefined

  const fromFrame = (ev: MessageEvent): Record<string, unknown> | null => {
    if (frame === null || ev.source !== frame.contentWindow || ev.origin !== origin || typeof ev.data !== 'string') return null
    try {
      const msg = JSON.parse(ev.data) as unknown
      return typeof msg === 'object' && msg !== null ? (msg as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  const close = () => {
    win.removeEventListener('message', onAnswer)
    frame?.remove()
    frame = null
    ready = null
    clearTimeout(idle)
    for (const [id, job] of pending) {
      pending.delete(id)
      clearTimeout(job.timer)
      job.reject(new DiagramUnavailable('the diagram viewer closed'))
    }
  }

  function onAnswer(ev: MessageEvent): void {
    const msg = fromFrame(ev)
    if (msg === null || typeof msg.id !== 'string') return
    const job = pending.get(msg.id)
    if (job === undefined) return
    // The shim's word first: the libraries that drew as placeholders.
    if (msg.event === 'shapes') return void (job.missing = Array.isArray(msg.missing) ? msg.missing.filter((k): k is string => typeof k === 'string') : [])
    pending.delete(msg.id)
    clearTimeout(job.timer)
    if (msg.ok !== true || typeof msg.svg !== 'string') return job.reject(new Error(typeof msg.error === 'string' ? msg.error : 'diagram picture failed'))
    if (msg.svg === '') return job.resolve('empty')
    const pages = Array.isArray(msg.pages) ? (msg.pages as { id?: unknown; name?: unknown }[]).filter((p) => typeof p?.id === 'string').map((p) => ({ id: p.id as string, name: String(p.name ?? p.id) })) : []
    job.resolve({ svg: msg.svg, width: sizeOf(msg.svg, 'width'), height: sizeOf(msg.svg, 'height'), pages, page: typeof msg.page === 'string' ? msg.page : null, missing: job.missing })
  }

  /** The one frame, made on first use; resolves when its page says "ready". A frame that never does is thrown away. */
  const open = (): Promise<HTMLIFrameElement> => {
    if (ready !== null) return ready
    const f = doc.createElement('iframe')
    f.src = RENDER_PATH
    f.title = 'Diagram renderer'
    f.tabIndex = -1
    f.setAttribute('aria-hidden', 'true')
    // No access the viewer does not need: no top navigation, no pop-up, no form, no download. (Same origin: the
    // service worker serves it offline; the frame's own CSP and shim shut its network and storage.)
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:800px;border:0;visibility:hidden;pointer-events:none;'
    frame = f
    ready = new Promise<HTMLIFrameElement>((resolve, reject) => {
      let grace: ReturnType<typeof setTimeout> | undefined
      const done = () => {
        win.removeEventListener('message', onReady)
        clearTimeout(giveUp)
        clearTimeout(grace)
        f.removeEventListener('load', onLoad)
      }
      const fail = () => {
        done()
        if (frame === f) close()
        reject(new DiagramUnavailable('the diagram viewer did not start'))
      }
      function onReady(ev: MessageEvent): void {
        if (fromFrame(ev)?.event !== 'ready') return
        done()
        resolve(f)
      }
      // The page loaded but never said "ready": not the viewer (no signal: the worker's 503).
      const onLoad = () => (grace = setTimeout(fail, LOADED_GRACE_MS))
      const giveUp = setTimeout(fail, READY_TIMEOUT_MS)
      win.addEventListener('message', onReady)
      f.addEventListener('load', onLoad)
    })
    win.addEventListener('message', onAnswer)
    doc.body.appendChild(f)
    return ready
  }

  return {
    async draw(input) {
      clearTimeout(idle)
      try {
        const f = await open()
        const id = `d${++serial}`
        return await new Promise<DiagramDrawn | 'empty'>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error('diagram picture timed out'))
          }, RENDER_TIMEOUT_MS)
          pending.set(id, { resolve, reject, timer, missing: [] })
          // The Mac's embed request (`renderDiagramPage`): the app's theme, draw.io's own dark colours ("adapt", the
          // Mac's default), scale 1. No link looks: a `[[link]]` in a label keeps its raw text on the phone.
          const req = { id, xml: input.text, theme: input.theme, adaptive: 'auto', format: 'svgText', scale: 1, padding: PADDING, looks: null, page: input.page ?? null }
          f.contentWindow?.postMessage(JSON.stringify(req), origin)
        })
      } finally {
        if (pending.size === 0) {
          clearTimeout(idle)
          idle = setTimeout(close, IDLE_CLOSE_MS)
        }
      }
    },
    close,
  }
}

let shared: DiagramRenderer | null = null

/** A diagram's picture, by the app's one renderer frame. */
export function drawDiagram(input: DiagramInput): Promise<DiagramDrawn | 'empty'> {
  shared ??= diagramRenderer()
  return shared.draw(input)
}
