import { openOverlay } from '../app/browserHistory'
import { edgeBackOn, swipeIsOurs } from '../app/edgeSwipe'
import { browserFacts, whereAmI } from '../pwa/homeScreen'
import { firstTimeWords, isPlainDiagram, onMacWords } from './drawingBox'
import type { DiagramDrawn, DiagramInput, DiagramFigure } from './diagram/drawDiagram'
import type { DrawInput, Drawn } from './engine/drawPicture'
import { pinchZoom } from './pinchZoom'
import { schemeWatch } from '../settings/appearance'

/**
 * THE DRAWINGS OF AN OPEN PAGE. Each `drawingBox` of the page gets its picture when it comes near the screen:
 *  1. the drawing chunk (`engine/drawPicture.ts`, the engine) loads, the first time only;
 *  2. the file's bytes: the phone's store first, then GitHub through the media layer (`read`), as a picture's bytes;
 *  3. the picture is drawn (the Mac's own code) and shown as an `<img>` of an SVG `blob:` URL, which fits the page's
 *     width; a tap opens it full screen, with pinch zoom.
 * Light and dark follow Settings › Appearance (System: the iPhone): a change draws the shown pictures again.
 *
 * NOTHING IS SAVED (Yaseen: "the pictures never get saved, so that way they just clean up and the phone app continues
 * to stay light"). The picture lives in memory only, as one `blob:` URL per box, revoked when the box leaves the page,
 * the theme changes, or the page closes (`stop`). It is never written to the store, the browser's databases, its
 * caches or its local storage. The drawing file and the pictures inside it are the vault's own files, which the media layer keeps and
 * cleans by its own rules; the engine chunk is kept by the service worker like every chunk.
 *
 * Calm lines, never a crash: with no signal and no engine yet, "Open it on the Mac" (the old line); a file that is not
 * a drawing, "Can't show this drawing"; a drawing with nothing in it, "Empty drawing".
 *
 * A PLAIN DRAW.IO DIAGRAM (`.drawio`) the same way, drawn by draw.io's own read-only viewer in the app's one
 * hidden frame (`diagram/drawDiagram.ts`), as the Mac draws it, light or dark as the iPhone is. A diagram of several
 * pages gets a page picker above its picture. Its own lines: the viewer not on the phone yet and no signal, "Diagrams
 * need the internet the first time; then they work offline" (it draws when the signal comes back); a shape library not
 * on the phone yet, a placeholder box for its shapes and a line under the picture (drawn again online).
 */

export interface DrawingDeps {
  /** A vault file's bytes: the store first, then GitHub (`useDrawings`). `why`: the media layer's reason when none (`FileShow`). */
  read(path: string): Promise<{ bytes: Uint8Array } | { why: string }>
  /** Every file of the vault (`VaultData.files`): where a picture inside a drawing is found. */
  files(): readonly string[]
  /** The drawing chunk; a test gives its own. */
  load?: () => Promise<{ drawPicture(input: DrawInput): Promise<Drawn> }>
  /** The diagram chunk (draw.io's viewer in its frame); a test gives its own. */
  loadDiagram?: () => Promise<{ drawDiagram(input: DiagramInput): Promise<DiagramDrawn | 'empty'>; diagramFigure: DiagramFigure }>
  /** Is there a signal now (`navigator.onLine`)? */
  isOnline?: () => boolean
  /** Dark mode now, and its changes; a test gives its own. */
  dark?: { matches: boolean; addEventListener(type: 'change', fn: () => void): void; removeEventListener(type: 'change', fn: () => void): void }
  /** Where the signal's return is heard (`window`). */
  online?: EventTarget
}

export interface DrawingWatch {
  /** Asks again for each drawing that waited (the signal came back, a pass ended). */
  retry(): void
  /** The page closes: every picture's URL is revoked, no late picture lands. */
  stop(): void
}

const NEAR = '600px 0px'
const BOX_SELECTOR = '[data-vault-drawing], [data-inline-drawing]'
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
/** The screen's turn before a drawing: the drawing chunk is all that runs after. */
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** The calm line in a box, in place of its picture. */
function line(box: HTMLElement, words: string): void {
  box.className = 'page-media page-media--board'
  box.removeAttribute('role')
  box.removeAttribute('aria-label')
  box.textContent = words
}

/** Each box: its path (or inline JSON), whether it is drawing now, its picture's URL, whether it waits for the signal, the page shown. */
interface Held {
  path: string | null
  inline: string | null
  busy: boolean
  url: string | null
  waits: boolean
  near: boolean
  ended: boolean
  /** A diagram's page shown; null: the first. */
  page: string | null
}

/** The picture of a drawing: its `blob:` URL, fit to the page's width. */
function picture(url: string, alt: string, width: number, height: number): HTMLImageElement {
  const img = document.createElement('img')
  img.className = 'page-drawing__img'
  img.alt = alt
  img.width = Math.round(width)
  img.height = Math.round(height)
  img.decoding = 'async'
  img.src = url
  return img
}

// YAZ-5565: the app's theme (Settings › Appearance; System follows the iPhone), not the iPhone's alone.
const defaultDark = () => schemeWatch

export function watchDrawings(root: HTMLElement, deps: DrawingDeps): DrawingWatch {
  let stopped = false
  const load = deps.load ?? (() => import('./engine/drawPicture'))
  const importDiagram = deps.loadDiagram ?? (() => import('./diagram/drawDiagram'))
  // One load for every diagram of the page (asked again after a failure: no signal, the first time).
  let diagramChunk: ReturnType<typeof importDiagram> | null = null
  const loadDiagram = () =>
    (diagramChunk ??= importDiagram().catch((err: unknown) => {
      diagramChunk = null
      throw err
    }))
  const isOnline = deps.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const dark = deps.dark ?? defaultDark()
  let queue: Promise<void> = Promise.resolve()
  const boxes = new Map<HTMLElement, Held>()

  const release = (held: { url: string | null }) => {
    if (held.url !== null) URL.revokeObjectURL(held.url)
    held.url = null
  }

  /** One at a time, each after the screen had its turn: two big drawings never draw in one go. */
  const inTurn = <T,>(work: () => Promise<T>): Promise<T> => {
    const turn = queue.then(nextTurn).then(work)
    queue = turn.then(
      () => undefined,
      () => undefined,
    )
    return turn
  }

  /** A plain draw.io diagram, by draw.io's viewer (`diagram/drawDiagram.ts`). */
  const drawDiagramBox = async (box: HTMLElement, held: Held, path: string, name: string, live: () => boolean) => {
    let chunk
    try {
      chunk = await loadDiagram()
    } catch {
      // The diagram chunk is not on the phone and no signal: as the viewer's own files.
      if (live()) (held.waits = true), line(box, isOnline() ? `Diagram · ${name} · Can't show it now` : firstTimeWords(name))
      return
    }
    const got = await deps.read(path)
    if (!live()) return
    if (!('bytes' in got)) {
      held.waits = got.why === 'offline' || got.why === 'slowed'
      held.ended = !held.waits
      line(box, got.why === 'offline' ? `Diagram · ${name} · Needs a connection` : got.why === 'gone' || got.why === 'not-in-vault' ? `Missing diagram · ${name}` : `Diagram · ${name} · Can't show it now`)
      return
    }
    let drawn: DiagramDrawn | 'empty'
    try {
      const input: DiagramInput = { text: new TextDecoder().decode(got.bytes), theme: dark?.matches ? 'dark' : 'light', page: held.page }
      drawn = await inTurn(() => chunk.drawDiagram(input))
    } catch (err) {
      if (!live()) return
      // The viewer did not start: its files are not on the phone yet (no signal), or the site did not answer.
      if (err instanceof Error && err.name === 'DiagramUnavailable') return void ((held.waits = true), line(box, isOnline() ? `Diagram · ${name} · Can't show it now` : firstTimeWords(name)))
      return void ((held.ended = true), line(box, `Diagram · ${name} · Can't show this diagram`))
    }
    if (!live()) return
    if (drawn === 'empty') return void ((held.ended = true), line(box, `Diagram · ${name} · Empty diagram`))
    release(held)
    held.url = URL.createObjectURL(new Blob([drawn.svg], { type: 'image/svg+xml' }))
    held.page = drawn.page
    // A shape library not on the phone yet: drawn again when the signal comes back.
    held.waits = drawn.missing.length > 0
    const parts = chunk.diagramFigure(drawn, held.url, name, {
      picture,
      open: openView,
      page: (id) => {
        held.page = id
        void draw(box)
      },
    })
    box.className = 'page-drawing page-drawing--diagram'
    box.removeAttribute('role')
    box.removeAttribute('aria-label')
    box.replaceChildren(...parts)
  }

  const draw = async (box: HTMLElement) => {
    const held = boxes.get(box)
    if (stopped || held === undefined || held.busy || held.ended) return
    held.busy = true
    held.waits = false
    const isInline = held.inline !== null
    const name = held.path !== null ? nameOf(held.path) : 'Inline drawing'
    const live = () => !stopped && box.isConnected && boxes.get(box) === held
    try {
      if (held.path !== null && isPlainDiagram(held.path)) return await drawDiagramBox(box, held, held.path, name, live)
      let chunk
      try {
        chunk = await load()
      } catch {
        // No signal and the engine is not on the phone yet: the old line, until the signal returns.
        if (live()) (held.waits = true), line(box, isInline ? 'Drawing · Open it on the Mac' : onMacWords(name))
        return
      }
      let bytes: Uint8Array
      if (held.inline !== null) {
        bytes = new TextEncoder().encode(held.inline)
      } else {
        const got = await deps.read(held.path!)
        if (!live()) return
        if (!('bytes' in got)) {
          held.waits = got.why === 'offline' || got.why === 'slowed'
          held.ended = !held.waits
          line(box, got.why === 'offline' ? `Drawing · ${name} · Needs a connection` : got.why === 'gone' || got.why === 'not-in-vault' ? `Missing drawing · ${name}` : `Drawing · ${name} · Can't show it now`)
          return
        }
        bytes = got.bytes
      }
      let drawn: Drawn
      try {
        // One drawing at a time, each after the screen had its turn: two big boards never draw in one go.
        const input: DrawInput = { text: new TextDecoder().decode(bytes), theme: dark?.matches ? 'dark' : 'light', files: deps.files(), read: deps.read }
        drawn = await inTurn(() => chunk.drawPicture(input))
      } catch {
        if (live()) (held.ended = true), line(box, isInline ? "Can't show this drawing" : `Drawing · ${name} · Can't show this drawing`)
        return
      }
      if (!live()) return
      if (drawn === 'empty') return void ((held.ended = true), line(box, isInline ? 'Empty drawing' : `Drawing · ${name} · Empty drawing`))
      release(held)
      held.url = URL.createObjectURL(new Blob([drawn.svg], { type: 'image/svg+xml' }))
      const img = picture(held.url, isInline ? 'Drawing' : `Drawing · ${name}`, drawn.width, drawn.height)
      img.addEventListener('click', () => openView(img.src, name, drawn.width, drawn.height))
      box.className = 'page-drawing'
      box.removeAttribute('role')
      box.removeAttribute('aria-label')
      box.replaceChildren(img)
    } finally {
      held.busy = false
    }
  }

  const seen =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const held = boxes.get(entry.target as HTMLElement)
              if (held === undefined) continue
              held.near = entry.isIntersecting
              if (entry.isIntersecting && held.url === null) void draw(entry.target as HTMLElement)
            }
          },
          { rootMargin: NEAR },
        )

  const take = (box: HTMLElement) => {
    const path = box.dataset.vaultDrawing
    const inline = box.dataset.inlineDrawing
    if (boxes.has(box) || (path === undefined && inline === undefined)) return
    boxes.set(box, { path: path ?? null, inline: inline ?? null, busy: false, url: null, waits: false, near: false, ended: false, page: null })
    if (seen === null) void draw(box)
    else seen.observe(box)
  }
  const scan = (node: ParentNode) => {
    if (node instanceof HTMLElement && (node.dataset.vaultDrawing !== undefined || node.dataset.inlineDrawing !== undefined)) take(node)
    for (const el of node.querySelectorAll<HTMLElement>(BOX_SELECTOR)) take(el)
  }
  const drop = (box: HTMLElement) => {
    const held = boxes.get(box)
    if (held === undefined) return
    release(held)
    boxes.delete(box)
    seen?.unobserve(box)
  }
  const forget = (node: Node) => {
    if (node instanceof HTMLElement && boxes.has(node)) drop(node)
    if (node instanceof Element) for (const el of node.querySelectorAll<HTMLElement>(BOX_SELECTOR)) drop(el)
  }
  scan(root)
  const watcher =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((records) => {
          for (const r of records) {
            for (const n of r.removedNodes) forget(n)
            for (const n of r.addedNodes) if (n instanceof Element) scan(n)
          }
        })
  watcher?.observe(root, { childList: true, subtree: true })

  const retry = () => {
    for (const [box, held] of boxes) if (held.waits && (held.near || seen === null)) void draw(box)
  }
  // Light or dark changed: the shown pictures again, in the new look.
  const restyle = () => {
    for (const [box, held] of boxes) if (held.url !== null && (held.near || seen === null)) void draw(box)
  }
  dark?.addEventListener('change', restyle)
  const online = deps.online ?? (typeof window === 'undefined' ? undefined : window)
  online?.addEventListener('online', retry)

  return {
    retry,
    stop() {
      stopped = true
      seen?.disconnect()
      watcher?.disconnect()
      dark?.removeEventListener('change', restyle)
      online?.removeEventListener('online', retry)
      for (const held of boxes.values()) release(held)
      boxes.clear()
      closeView?.()
    },
  }
}

/**
 * The full-screen view of a picture: the whole drawing to fit the screen, then pinch (or double-tap) to zoom and drag
 * to move. ✕ or Escape closes it. It shows the same `blob:` URL: nothing new is made.
 */
/** The open full-screen view's close (one at a time). */
let closeView: (() => void) | null = null

export function openView(url: string, name: string, width: number, height: number): HTMLElement {
  closeView?.()
  const view = document.createElement('div')
  view.className = 'drawing-view'
  view.setAttribute('role', 'dialog')
  view.setAttribute('aria-modal', 'true')
  view.setAttribute('aria-label', `Drawing · ${name}`)
  const bar = document.createElement('div')
  bar.className = 'drawing-view__bar'
  const title = document.createElement('span')
  title.className = 'drawing-view__name'
  title.textContent = name
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'drawing-view__close'
  close.setAttribute('aria-label', 'Close')
  close.textContent = '✕'
  bar.append(title, close)
  const pane = document.createElement('div')
  pane.className = 'drawing-view__pane'
  const img = document.createElement('img')
  img.alt = `Drawing · ${name}`
  img.src = url
  pane.append(img)
  view.append(bar, pane)
  document.body.append(view)

  const fit = Math.min(1, (pane.clientWidth || window.innerWidth) / Math.max(1, width), (pane.clientHeight || window.innerHeight) / Math.max(1, height))
  // Pinch (or double-tap) to zoom, drag to move (`pinchZoom.ts`, shared with the table view of YAZ-5471).
  pinchZoom(view, pane, (scale) => {
    img.style.width = `${Math.round(width * scale)}px`
    img.style.height = `${Math.round(height * scale)}px`
  }, { min: fit, max: Math.max(4, fit * 8), start: fit, doubleIn: fit * 2.5 })

  const done = () => {
    if (closeView !== done) return
    closeView = null
    // Its history entry goes with it (nothing when a Back closed it).
    leave()
    view.remove()
    document.removeEventListener('keydown', key)
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') done()
  }
  close.addEventListener('click', done)
  document.addEventListener('keydown', key)
  // An overlay of the app's one stack: a Back closes the drawing, and the page stays.
  closeView = done
  const leave = openOverlay(done)
  // The left-edge Back (the Home Screen app) closes it too: the view is over the frame, out of its swipe.
  edgeBackOn(view, done, swipeIsOurs(whereAmI(browserFacts())))
  close.focus()
  return view
}
