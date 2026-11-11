/**
 * BOARD PICTURES (YAZ-4825; D2, D5, D6, items 1, 14, 25, 26, 27, 28): the one app-wide source of the pictures board
 * windows show. Many windows of one board, in one theme, on one page, share ONE picture.
 *
 * THE CACHE: `createPreviewCache` with 24 kept and 64 MB of SVG text at most, least recently seen out first. Its key is root, path, mtime, theme,
 * the diagram dark-colour setting and the page, so a write, a theme flip, a setting change or a page change is simply
 * a new key. The cache's value is a BLOB URL of the SVG text (serialized once), so every `<img>` reads the same bytes;
 * the URL is revoked when its entry leaves the cache (`onEvict`). The bounds, pages and frames of each picture sit in
 * `meta` beside it, under the same key, and leave with it. A sleeping tab unmounts its editor, so its windows
 * `destroy()`; then the sleep's sweep (`dropPicturesExcept`, A5) frees each picture that no mounted window shows (item 27).
 *
 *   drawing   `drawing.load` (pictures in it at most 2400 px, item 14) → restore as the sidebar's hover picture does →
 *             the engine's `exportToSvg` in an idle callback (item 26). The engine inlines the fonts it draws with as
 *             `data:` URLs (item 25), so an `<img>` draws them. The bounds come from the root elements' right and
 *             bottom edges: the engine's own left edge can include fold arrows (`getFoldArrowsLeft`).
 *   diagram   `diagram.load` → draw.io's own viewer at scale 1 (`renderDiagramPage`): the page asked for, the first
 *             when it is gone (D6), with the page list for "Page ▸".
 *
 * THE FIRST MTIME: a key needs the mtime before the load, so the first ask reads `boardHead` (the file's head only).
 * After that the watcher's `add` / `change` events keep it.
 *
 * THE WATCHER (D5): one `api.watch(root)` per vault root with a mounted window, ended with that root's last window.
 * Main keeps one watcher per root however many subscribe (`desktop/src/main/ipc/watch.ts`), so nothing new watches the
 * disk. An event looks up its path in a map of the paths windows show: every other path is ignored in O(1).
 *
 * NOT THE SIDEBAR'S HOVER PICTURE (item 28): that one is a PNG fit in 1200×800 (`boardPreviewCache.ts`); a window
 * needs the whole SVG at scale 1 and its bounds, per page. One key cannot address both, so both stay.
 */
import { isDiagram } from '@shared/fileKind'
import type { DiagramDarkColors, WatchEvent } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import { renderDiagramPage, type BoardBounds, type DiagramPageRef } from '../../diagrams/renderDiagram'
import { readDrawingForPicture } from '../../drawings/drawingScene'
import { createPreviewCache } from '../../lib/previewCache'
import { storage } from '../../lib/storage'
import { appliedTheme } from '../../lib/theme'
import { setEmbedPictureStats } from './pictureStats'

export type { BoardBounds, DiagramPageRef }

/** How many pictures the cache keeps (D5). */
export const PICTURE_LIMIT = 24
/** And how much SVG text, by its length (the YAZ-4821 checker's round 1): a few huge boards cannot hold all the memory. */
export const PICTURE_MAX_BYTES = 64 * 1024 * 1024
/** Pictures inside a drawing load at most this big (item 14). */
export const IMAGE_MAX_PX = 2400
/** The engine's `DEFAULT_EXPORT_PADDING`, which `exportToSvg` adds around the board. */
export const DRAWING_PADDING = 10
/** An idle callback waits at most this long (item 26): a busy page still gets its picture. */
const IDLE_TIMEOUT_MS = 2000

/** A drawing's frame (item 1): "Frame ▸" fits the window to it. Board units. */
export interface BoardFrame {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

/** One settled picture, as a window shows it. `url` is `''` and `bounds` null for an empty board or page. */
export interface BoardPicture {
  key: string
  url: string
  /** The board rectangle the picture covers, in board units. */
  bounds: BoardBounds | null
  /** A diagram's pages in file order; [] for a drawing. */
  pages: DiagramPageRef[]
  /** The page drawn (a gone id falls back to the first); null for a drawing. */
  page: string | null
  /** A drawing's frames; [] for a diagram. */
  frames: BoardFrame[]
  /** The SVG text's length: the Memory page's estimate. */
  bytes: number
}

/** What a picture is asked for by. `path` is vault-relative or absolute under `root`. */
export interface PictureRef {
  root: string
  path: string
}

/** The absolute path of a board: the watcher's and `boardHead`'s form. */
export function absolutePath(root: string, path: string): string {
  return path.startsWith('/') ? path : `${root.replace(/\/+$/, '')}/${path}`
}

/** One key per board, per write, per theme, per dark-colour setting, per page (a drawing's page is always ''). */
export function pictureKey(root: string, abs: string, mtime: number, theme: 'light' | 'dark', darkColors: DiagramDarkColors, page: string | null): string {
  return [root, abs, mtime, theme, darkColors, isDiagram(abs) ? (page ?? '') : ''].join('\n')
}

function parseKey(key: string): { root: string; path: string; theme: 'light' | 'dark'; darkColors: DiagramDarkColors; page: string | null } {
  const parts = key.split('\n')
  const page = parts[parts.length - 1]
  return {
    root: parts[0],
    path: parts.slice(1, -4).join('\n'),
    theme: parts[parts.length - 3] === 'dark' ? 'dark' : 'light',
    darkColors: parts[parts.length - 2] === 'keep' ? 'keep' : 'adapt',
    page: page === '' ? null : page,
  }
}

/** The look a picture is drawn in now: the app's applied theme and the diagram dark-colour setting (item 13). */
export function currentLook(): { theme: 'light' | 'dark'; darkColors: DiagramDarkColors } {
  return { theme: appliedTheme(), darkColors: storage.getSettings().diagramDarkColors === 'keep' ? 'keep' : 'adapt' }
}

/** The work of a picture, without its blob URL. */
type Drawn = Omit<BoardPicture, 'key' | 'url' | 'bytes'> & { svg: string }

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS })
    else setTimeout(resolve, 0)
  })
}

async function drawDiagram(root: string, path: string, theme: 'light' | 'dark', darkColors: DiagramDarkColors, page: string | null): Promise<Drawn> {
  const { xml } = await api.diagram.load({ root, path })
  const drawn = await renderDiagramPage(xml, page, theme, darkColors)
  return { svg: drawn.picture, bounds: drawn.picture === '' ? null : drawn.bounds, pages: drawn.pages, page: drawn.page, frames: [] }
}

interface SceneElement {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  name?: string | null
  frameId?: string | null
}

/** The frames of a drawing, in scene order (item 1); a frame with no name gets the engine's default. */
export function framesOf(elements: readonly SceneElement[]): BoardFrame[] {
  return elements
    .filter((e) => e.type === 'frame' || e.type === 'magicframe')
    .map((e) => ({ id: e.id, name: e.name ?? (e.type === 'magicframe' ? 'AI Frame' : 'Frame'), x: e.x, y: e.y, width: e.width, height: e.height }))
}

async function drawDrawing(root: string, path: string, theme: 'light' | 'dark'): Promise<Drawn> {
  const read = await readDrawingForPicture(root, path, IMAGE_MAX_PX)
  const { engine, appState, files } = read
  const elements = read.elements as SceneElement[]
  if (elements.length === 0) return { svg: '', bounds: null, pages: [], page: null, frames: [] }
  await whenIdle()
  const svgEl = await engine.exportToSvg({
    elements: elements as never,
    appState: { ...appState, exportBackground: true, exportWithDarkMode: theme === 'dark', exportPadding: DRAWING_PADDING } as never,
    files: files as never,
  })
  const svg = new XMLSerializer().serializeToString(svgEl)
  // The engine's canvas size (`getCanvasSize`): the common bounds of the root elements, plus the padding each side.
  const frameIds = new Set(elements.filter((e) => e.type === 'frame' || e.type === 'magicframe').map((e) => e.id))
  const roots = elements.filter((e) => frameIds.has(e.id) || !e.frameId || !frameIds.has(e.frameId))
  const [, , maxX, maxY] = engine.getCommonBounds(roots as never)
  const [, , width, height] = (svgEl.getAttribute('viewBox') ?? '0 0 0 0').split(/\s+/).map(Number)
  return { svg, bounds: { x: maxX + DRAWING_PADDING - width, y: maxY + DRAWING_PADDING - height, width, height }, pages: [], page: null, frames: framesOf(elements) }
}

/** Each settled key's facts; an entry leaves with its picture. */
const meta = new Map<string, BoardPicture>()
let totalBytes = 0

function report(): void {
  setEmbedPictureStats(meta.size, totalBytes)
}

async function drawPicture(key: string): Promise<string> {
  const { root, path, theme, darkColors, page } = parseKey(key)
  const drawn = isDiagram(path) ? await drawDiagram(root, path, theme, darkColors, page) : await drawDrawing(root, path, theme)
  const url = drawn.svg === '' ? '' : URL.createObjectURL(new Blob([drawn.svg], { type: 'image/svg+xml' }))
  const old = meta.get(key)
  if (old !== undefined) totalBytes -= old.bytes
  meta.set(key, { key, url, bounds: drawn.bounds, pages: drawn.pages, page: drawn.page, frames: drawn.frames, bytes: drawn.svg.length })
  totalBytes += drawn.svg.length
  report()
  return url
}

function evict(key: string, url: string): void {
  if (url !== '') URL.revokeObjectURL(url)
  const entry = meta.get(key)
  // A key settled again keeps its new entry: only the picture that left goes.
  if (entry === undefined || entry.url !== url) return
  meta.delete(key)
  totalBytes -= entry.bytes
  report()
}

// The value is a blob URL; its size is the SVG text's, which `drawPicture` puts in `meta` before the value settles.
const cache = createPreviewCache(drawPicture, { limit: PICTURE_LIMIT, maxBytes: PICTURE_MAX_BYTES, onEvict: evict, sizeOf: (key) => meta.get(key)?.bytes ?? 0 })

/** The newest mtime known per absolute path that a window shows. */
const mtimes = new Map<string, number>()

/** The key a board's picture has NOW, when its mtime is known; null before its first ask. */
export function currentKey(ref: PictureRef, page: string | null): string | null {
  const abs = absolutePath(ref.root, ref.path)
  const mtime = mtimes.get(abs)
  if (mtime === undefined) return null
  const { theme, darkColors } = currentLook()
  return pictureKey(ref.root, abs, mtime, theme, darkColors, page)
}

/** A settled picture by its key, with no request (a picture that left the cache is undefined). */
export function peekPicture(key: string): BoardPicture | undefined {
  const url = cache.peek(key)
  return url === undefined ? undefined : meta.get(key)
}

/**
 * The picture of `ref` on `page`, now: shared with every window asking for the same key. `'missing'` when the file is
 * not there (the window's "Missing …"), `'broken'` when it would not read or draw (its "Can't show …", A4).
 */
export async function loadPicture(ref: PictureRef, page: string | null): Promise<BoardPicture | 'missing' | 'broken'> {
  const abs = absolutePath(ref.root, ref.path)
  if (!mtimes.has(abs)) {
    try {
      const head = await api.boardHead(abs)
      // A watcher event may have brought a newer one meanwhile.
      if (!mtimes.has(abs) || (mtimes.get(abs) ?? 0) < head.mtime) mtimes.set(abs, head.mtime)
    } catch (err) {
      return err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? 'missing' : 'broken'
    }
  }
  // An `unlink` while the head was read.
  const key = currentKey(ref, page)
  if (key === null) return 'missing'
  const url = await cache.load(key)
  return url === null ? 'broken' : (meta.get(key) ?? 'broken')
}

/** The sleep's sweep (A5): every settled picture whose key is not in `keep` leaves the cache now. */
export function dropPicturesExcept(keep: ReadonlySet<string>): void {
  for (const key of [...meta.keys()]) if (!keep.has(key)) cache.drop(key)
}

/** Forget every picture (a test; never the app). */
export function clearPictures(): void {
  cache.clear()
  mtimes.clear()
}

// ── The watcher stream ──────────────────────────────────────────────────────────────────────────────────────────

type BoardListener = (ev: WatchEvent) => void

/** Per root: its one subscription, and how many windows of that root are mounted. */
const roots = new Map<string, { off: () => void; count: number }>()
/** The listeners of each absolute path a window shows. */
const byPath = new Map<string, Set<BoardListener>>()
/** The listeners of a missing board, by root and file name (`Name.drawio`): a file of that name added there returns it. */
const byName = new Map<string, Set<BoardListener>>()

const nameKey = (root: string, fileName: string) => `${root}\n${fileName.toLowerCase()}`
const fileNameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function onEvent(root: string, ev: WatchEvent): void {
  if (ev.type !== 'add' && ev.type !== 'change' && ev.type !== 'unlink') return
  const listeners = byPath.get(ev.path)
  if (listeners !== undefined) {
    if (ev.type === 'unlink') mtimes.delete(ev.path)
    else mtimes.set(ev.path, ev.mtime)
    for (const l of [...listeners]) l(ev)
  }
  if (ev.type === 'add') {
    const named = byName.get(nameKey(root, fileNameOf(ev.path)))
    if (named !== undefined) for (const l of [...named]) l(ev)
  }
}

function holdRoot(root: string): () => void {
  let held = roots.get(root)
  if (held === undefined) {
    held = { off: () => undefined, count: 0 }
    roots.set(root, held)
    held.off = api.watch(root, (ev) => onEvent(root, ev))
  }
  held.count++
  let done = false
  return () => {
    if (done) return
    done = true
    const h = roots.get(root)
    if (h === undefined) return
    if (--h.count === 0) {
      h.off()
      roots.delete(root)
    }
  }
}

function addTo(map: Map<string, Set<BoardListener>>, key: string, listener: BoardListener): () => void {
  let set = map.get(key)
  if (set === undefined) map.set(key, (set = new Set()))
  set.add(listener)
  return () => {
    const s = map.get(key)
    if (s === undefined) return
    s.delete(listener)
    if (s.size === 0) map.delete(key)
  }
}

/**
 * A window's watch on its board: `listener` hears the `add`, `change` and `unlink` of the board's path, or, when the
 * path is null (a link that does not resolve), the `add` of a file named `fileName` in the vault. The returned
 * function ends it; the root's subscription ends with its last window.
 */
export function watchBoard(root: string, path: string | null, fileName: string, listener: BoardListener): () => void {
  const releaseRoot = holdRoot(root)
  const offs: Array<() => void> = []
  if (path !== null) offs.push(addTo(byPath, absolutePath(root, path), listener))
  else offs.push(addTo(byName, nameKey(root, fileName), listener))
  return () => {
    for (const off of offs) off()
    if (path !== null && !byPath.has(absolutePath(root, path))) mtimes.delete(absolutePath(root, path))
    releaseRoot()
  }
}

/** How many roots and paths are watched now (a test of the bounds). */
export function watchCounts(): { roots: number; paths: number; names: number } {
  return { roots: roots.size, paths: byPath.size, names: byName.size }
}
