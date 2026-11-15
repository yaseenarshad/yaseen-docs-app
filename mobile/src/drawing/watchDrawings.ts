import { onMacWords } from './drawingBox'
import type { DrawInput, Drawn } from './engine/drawPicture'
import { pinchZoom } from './pinchZoom'

/**
 * THE DRAWINGS OF AN OPEN PAGE (YAZ-5440). Each `drawingBox` of the page gets its picture when it comes near the screen:
 *  1. the drawing chunk (`engine/drawPicture.ts`, the engine) loads, the first time only;
 *  2. the file's bytes: the phone's store first, then GitHub through the media layer (`read`), as a picture's bytes;
 *  3. the picture is drawn (the Mac's own code) and shown as an `<img>` of an SVG `blob:` URL, which fits the page's
 *     width; a tap opens it full screen, with pinch zoom.
 * Light and dark follow the iPhone: a change draws the shown pictures again.
 *
 * NOTHING IS SAVED (Yaseen: "the pictures never get saved, so that way they just clean up and the phone app continues
 * to stay light"). The picture lives in memory only, as one `blob:` URL per box, revoked when the box leaves the page,
 * the theme changes, or the page closes (`stop`). It is never written to the store, the browser's databases, its
 * caches or its local storage. The drawing file and the pictures inside it are the vault's own files, which the media layer keeps and
 * cleans by its own rules; the engine chunk is kept by the service worker like every chunk.
 *
 * Calm lines, never a crash: with no signal and no engine yet, "Open it on the Mac" (the old line); a file that is not
 * a drawing, "Can't show this drawing"; a drawing with nothing in it, "Empty drawing".
 */

export interface DrawingDeps {
  /** A vault file's bytes: the store first, then GitHub (`useDrawings`). `why`: the media layer's reason when none (`FileShow`). */
  read(path: string): Promise<{ bytes: Uint8Array } | { why: string }>
  /** Every file of the vault (`VaultData.files`): where a picture inside a drawing is found. */
  files(): readonly string[]
  /** The drawing chunk; a test gives its own. */
  load?: () => Promise<{ drawPicture(input: DrawInput): Promise<Drawn> }>
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

const defaultDark = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined)

export function watchDrawings(root: HTMLElement, deps: DrawingDeps): DrawingWatch {
  let stopped = false
  const load = deps.load ?? (() => import('./engine/drawPicture'))
  const dark = deps.dark ?? defaultDark()
  /** Each box: its path, whether it is drawing now, its picture's URL, whether it waits for the signal. */
  let queue: Promise<void> = Promise.resolve()
  const boxes = new Map<HTMLElement, { path: string; busy: boolean; url: string | null; waits: boolean; near: boolean; ended: boolean }>()

  const release = (held: { url: string | null }) => {
    if (held.url !== null) URL.revokeObjectURL(held.url)
    held.url = null
  }

  const draw = async (box: HTMLElement) => {
    const held = boxes.get(box)
    if (stopped || held === undefined || held.busy || held.ended) return
    held.busy = true
    held.waits = false
    const name = nameOf(held.path)
    const live = () => !stopped && box.isConnected && boxes.get(box) === held
    try {
      let chunk
      try {
        chunk = await load()
      } catch {
        // No signal and the engine is not on the phone yet: the old line, until the signal returns.
        if (live()) (held.waits = true), line(box, onMacWords(name))
        return
      }
      const got = await deps.read(held.path)
      if (!live()) return
      if (!('bytes' in got)) {
        held.waits = got.why === 'offline' || got.why === 'slowed'
        held.ended = !held.waits
        line(box, got.why === 'offline' ? `Drawing · ${name} · Needs a connection` : got.why === 'gone' || got.why === 'not-in-vault' ? `Missing drawing · ${name}` : `Drawing · ${name} · Can't show it now`)
        return
      }
      let drawn: Drawn
      try {
        // One drawing at a time, each after the screen had its turn: two big boards never draw in one go.
        const input: DrawInput = { text: new TextDecoder().decode(got.bytes), theme: dark?.matches ? 'dark' : 'light', files: deps.files(), read: deps.read }
        const turn = queue.then(nextTurn).then(() => chunk.drawPicture(input))
        queue = turn.then(
          () => undefined,
          () => undefined,
        )
        drawn = await turn
      } catch {
        if (live()) (held.ended = true), line(box, `Drawing · ${name} · Can't show this drawing`)
        return
      }
      if (!live()) return
      if (drawn === 'empty') return void ((held.ended = true), line(box, `Drawing · ${name} · Empty drawing`))
      release(held)
      held.url = URL.createObjectURL(new Blob([drawn.svg], { type: 'image/svg+xml' }))
      const img = document.createElement('img')
      img.className = 'page-drawing__img'
      img.alt = `Drawing · ${name}`
      img.width = Math.round(drawn.width)
      img.height = Math.round(drawn.height)
      img.decoding = 'async'
      img.src = held.url
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
    if (boxes.has(box) || path === undefined) return
    boxes.set(box, { path, busy: false, url: null, waits: false, near: false, ended: false })
    if (seen === null) void draw(box)
    else seen.observe(box)
  }
  const scan = (node: ParentNode) => {
    if (node instanceof HTMLElement && node.dataset.vaultDrawing !== undefined) take(node)
    for (const el of node.querySelectorAll<HTMLElement>('[data-vault-drawing]')) take(el)
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
    if (node instanceof Element) for (const el of node.querySelectorAll<HTMLElement>('[data-vault-drawing]')) drop(el)
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
      document.querySelector('.drawing-view')?.remove()
    },
  }
}

/**
 * The full-screen view of a picture: the whole drawing to fit the screen, then pinch (or double-tap) to zoom and drag
 * to move. ✕ or Escape closes it. It shows the same `blob:` URL: nothing new is made.
 */
export function openView(url: string, name: string, width: number, height: number): HTMLElement {
  document.querySelector('.drawing-view')?.remove()
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
    view.remove()
    document.removeEventListener('keydown', key)
  }
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') done()
  }
  close.addEventListener('click', done)
  document.addEventListener('keydown', key)
  close.focus()
  return view
}
