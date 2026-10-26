/**
 * The tab board's arithmetic (YAZ-2648, YAZ-3343), with no DOM and no React, so the rules are testable:
 * which pages stand on which island, how big an island is, where every card of the CANVAS stands
 * (`layoutCanvas`), what a drop in another window's frame does (`dropOutcome`), and where an arrow key goes.
 * A stored change of the canvas reads by the shared rule (`applyTabCanvasPatch`, @shared/types), which `storage` applies at once.
 *
 * The sizes below are the board's ONE source: `TabOverview` hands them to the stylesheet as custom
 * properties, and the layout reads the same numbers. So what the layout computes is what the
 * browser shows, and the board never has to measure the cards it placed (YAZ-3343 D4).
 */
import { canvasCardKey, rootOfPath, stripSlash, type CanvasCard, type CanvasLayout } from '@shared/types'
import { dirname, relTo } from '../lib/paths'

/**
 * Every length is in px at zoom 1. A page is a short, wide CARD (Yaseen's demo feedback on YAZ-3343, "an old
 * school trello card"): its title, a "Page: …" line when named, two lines of the note — the peek is for reading.
 */
export const BOARD = {
  pageW: 220,
  pageH: 96,
  /** Between two cards of an island. */
  pageGap: 10,
  /** Around an island's cards. */
  islandPad: 10,
  /** An island's label row, the gap under the label in it. */
  labelH: 28,
  /** Between two islands, sideways and down, and between two vaults. */
  islandGap: 20,
  /** A vault's name above its islands (two or more vaults). */
  vaultH: 34,
  /** A window's frame (YAZ-3343 D8): the room around its groups, its label row above it, and the gap between two frames. */
  framePad: 18,
  frameLabelH: 30,
  frameGap: 40,
  /** The columns of a window frame's one grid of cards (demo feedback: compact frames, no folder boxes inside). */
  frameCols: 4,
  /** The least room between two frames (or groups) a drop or the layout leaves (demo feedback: no overlap). */
  apart: 24,
  /** Where the camera puts the board's top-left corner when it opens (D7). */
  padX: 28,
  padTop: 10,
  /** The camera's zoom range (D4), and the zoom from which a drawing's card shows its picture (D6). */
  minZoom: 0.2,
  maxZoom: 2,
  detailZoom: 0.5,
  /** A press that moved less than this (screen px) is a click, not a drag (D12). */
  dragSlop: 4,
} as const

/** One page of the board: one TAB (YAZ-2940 D1), so two copies of a file are two pages. */
export interface BoardPage {
  /** This window's tab id, or for another window's tab `${win}\n${path}\n${copy}` (YAZ-3343 D2): never the same as a tab id. */
  id: string
  path: string
  /** What the page shows: the tab's display name, else its page name (YAZ-2949 D5). */
  label: string
  /** The tab has a display name (YAZ-2949): its menu offers "Reset to page name", and its card says "Page: …" under it (YAZ-3343 D11). */
  named: boolean
  /** The page's own name, whatever the tab is called. */
  page: string
  /** Which tab of its path it is in its window's strip, 0 first (YAZ-3343 D1), and how many tabs of the path the window has (D11). */
  copy: number
  copies: number
}

/** A tab as the board takes it: this window's (`Tab`) or another window's, from its stored strip. */
export interface BoardTab {
  id: string
  path: string
  name?: string
}

export interface Island {
  /** The folder that directly holds the pages, absolute: the island's identity. */
  dir: string
  /** The folder inside its vault, parts joined with " / "; the vault's name for its top level. */
  label: string
  /** The vault's own top level, which no folder row stands for. */
  top: boolean
  pages: BoardPage[]
}

export interface VaultIslands {
  /** The vault's place in the window's vaults; `roots.length` for pages in no vault of the window. */
  at: number
  /** The vault's name, said above its islands where the window has two or more. */
  name: string
  islands: Island[]
}

/** Each tab's copy number (its place among the tabs of its path, strip order) and the count of each path (YAZ-3343 D1, D11). */
export function copiesOf(tabs: readonly { path: string }[]): { copy: number[]; count: Map<string, number> } {
  const count = new Map<string, number>()
  const copy = tabs.map(({ path }) => {
    const n = count.get(path) ?? 0
    count.set(path, n + 1)
    return n
  })
  return { copy, count }
}

/**
 * The open tabs as islands (D7): one per folder that DIRECTLY holds a page, under its vault. Read
 * off the paths; nothing is stored. Vaults stand in the window's order, a vault's top level first
 * and its folders by path, and the pages of an island in the strip's order. `terms` is the filter,
 * lowercased: a page stays when its title, its display name (YAZ-2949) or its path inside the vault holds every one.
 * The copies are counted over the whole strip, before the filter (YAZ-3343 D1): a card is the same copy whatever is typed.
 */
export function buildBoard(tabs: readonly BoardTab[], roots: readonly string[], vaultNames: readonly string[], labelOf: (path: string) => string, terms: readonly string[] = []): VaultIslands[] {
  const vaults = new Map<number, Map<string, Island>>()
  const { copy, count } = copiesOf(tabs)
  tabs.forEach(({ id, path, name }, i) => {
    const root = rootOfPath(roots, path)
    // A display name (YAZ-2949 D5) is the page's label; the filter still finds the page by its own name (S13).
    const page = labelOf(path)
    const label = name ?? page
    const hay = `${label}\n${name === undefined ? '' : `${page}\n`}${root === null ? path : relTo(root, path)}`.toLowerCase()
    if (!terms.every((term) => hay.includes(term))) return
    const at = root === null ? roots.length : roots.indexOf(root)
    const dir = dirname(path)
    const top = root !== null && dir === stripSlash(root)
    const islands = vaults.get(at) ?? new Map<string, Island>()
    vaults.set(at, islands)
    const island = islands.get(dir) ?? { dir, top, label: root === null ? dir : top ? (vaultNames[at] ?? '') : relTo(root, dir).split('/').join(' / '), pages: [] }
    islands.set(dir, island)
    island.pages.push({ id, path, label, named: name !== undefined, page, copy: copy[i], copies: count.get(path) ?? 1 })
  })
  return [...vaults]
    .sort(([a], [b]) => a - b)
    .map(([at, islands]) => ({
      at,
      name: vaultNames[at] ?? '',
      islands: [...islands.values()].sort((a, b) => Number(b.top) - Number(a.top) || a.dir.toLowerCase().localeCompare(b.dir.toLowerCase())),
    }))
}

/** How many pages an island sets side by side: three at most, and four pages as two and two — and never more than the board is wide. */
export function islandCols(count: number, boardW: number): number {
  const fits = Math.floor((boardW - 2 * BOARD.islandPad + BOARD.pageGap) / (BOARD.pageW + BOARD.pageGap))
  return Math.max(1, Math.min(colsFor(count), fits))
}

/**
 * How many columns a frame (or group) of `count` cards lays them in (demo feedback: "spread out horizontally"): about
 * as wide as tall for short wide cards — ceil(√(n × 1.6)), 1 to 8. Two cards are two side by side, nineteen six.
 */
export function colsFor(count: number): number {
  return Math.max(1, Math.min(8, count, Math.ceil(Math.sqrt(count * 1.6))))
}

/** Two rectangles closer than `gap` (or overlapping). */
const crowds = (a: Rect, b: Rect, gap: number): boolean => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y

/**
 * THE NO-OVERLAP RULE (demo feedback: "not allow windows to overlap each other"): the top-left nearest to `rect`'s
 * where it keeps `gap` from every one of `others` — `rect`'s own when it does already. What moved gives way; the others
 * stay. Free placement, no grid: the answer lies on an edge of an obstacle, so those are the candidates.
 */
export function freeFramePosition(rect: Rect, others: readonly Rect[], gap: number = BOARD.apart): { x: number; y: number } {
  const free = (x: number, y: number): boolean => others.every((o) => !crowds({ x, y, w: rect.w, h: rect.h }, o, gap))
  if (free(rect.x, rect.y)) return { x: rect.x, y: rect.y }
  const xs = [rect.x, ...others.flatMap((o) => [o.x - gap - rect.w, o.x + o.w + gap])]
  const ys = [rect.y, ...others.flatMap((o) => [o.y - gap - rect.h, o.y + o.h + gap])]
  let best: { x: number; y: number; d: number } | null = null
  for (const x of xs)
    for (const y of ys) {
      if (!free(x, y)) continue
      const d = Math.hypot(x - rect.x, y - rect.y)
      if (best === null || d < best.d - 1e-9 || (Math.abs(d - best.d) < 1e-9 && (y < best.y || (y === best.y && x < best.x)))) best = { x, y, d }
    }
  if (best !== null) return { x: best.x, y: best.y }
  // Boxed in on every side: right of everything.
  return { x: Math.max(...others.map((o) => o.x + o.w)) + gap, y: rect.y }
}

/**
 * The point nearest to `target` on a lattice of `step` (from `target`) that `ok` accepts: `target` itself first, then
 * ring by ring, nearest first. Null within `rings` rings. The card's rule (no-overlap): a free cell that keeps its frame clear.
 */
export function nearestOk(target: { x: number; y: number }, step: { w: number; h: number }, ok: (p: { x: number; y: number }) => boolean, rings = 40): { x: number; y: number } | null {
  if (ok(target)) return target
  for (let r = 1; r <= rings; r++) {
    const ring: { x: number; y: number; d: number }[] = []
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue
        const p = { x: target.x + i * step.w, y: target.y + j * step.h }
        if (ok(p)) ring.push({ ...p, d: Math.hypot(i * step.w, j * step.h) })
      }
    if (ring.length > 0) {
      ring.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
      return { x: ring[0].x, y: ring[0].y }
    }
  }
  return null
}

/** An island's box as the layout stands it: its label row, then its pages in a grid. */
export function islandBox(count: number, boardW: number): { w: number; h: number } {
  const { pageW, pageH, pageGap, islandPad, labelH } = BOARD
  const cols = islandCols(count, boardW)
  const rows = Math.ceil(count / cols)
  return { w: cols * pageW + (cols - 1) * pageGap + 2 * islandPad, h: labelH + rows * pageH + (rows - 1) * pageGap + 2 * islandPad }
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** A rectangle of the world (px at zoom 1). */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** One window's groups, as `layoutCanvas` takes them: its vaults, each saying whether its name stands above its islands. */
export interface FrameInput {
  win: string
  vaults: readonly (VaultIslands & { named: boolean })[]
}

export interface PlacedCard {
  x: number
  y: number
  /** It stands where the user put it (a stored place), not in its group. */
  moved: boolean
}

export interface PlacedGroup extends Rect {
  /** `${win}\n${dir}`: a folder is one group per window. */
  key: string
  win: string
  island: Island
}

export interface PlacedVault {
  key: string
  name: string
  x: number
  y: number
  w: number
}

export interface PlacedFrame extends Rect {
  win: string
}

/** Where everything of the canvas stands, in world px. */
export interface CanvasPlan {
  cards: ReadonlyMap<string, PlacedCard>
  /** Every card id in reading order: frame by frame, or group by group. */
  order: readonly string[]
  groups: readonly PlacedGroup[]
  vaults: readonly PlacedVault[]
  /** One per window with "Show all windows" on (D8), each with its label row above it; none in the folder layout. */
  frames: readonly PlacedFrame[]
  /** Everything above, labels included: what "Fit all tabs" fits. */
  bounds: Rect
}

const union = (a: Rect | null, b: Rect): Rect => {
  if (a === null) return { ...b }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** One cell of the world's grid ("Snap to grid", demo feedback): a card and the gap after it, both ways. */
export const CELL = { w: BOARD.pageW + BOARD.pageGap, h: BOARD.pageH + BOARD.pageGap } as const

/**
 * The cell nearest to a top-left, on the grid whose cell (0, 0) starts at `origin` ("Snap to grid", demo feedback).
 * Each frame (or group) has its OWN grid: its origin is one of its cards, so the grid moves with the frame however it
 * was dragged, and a card snapped on it lines up with its neighbours (`TabOverview`'s `gridOf`).
 */
export function snapPoint(p: { x: number; y: number }, origin: { x: number; y: number }): { x: number; y: number } {
  return { x: origin.x + Math.round((p.x - origin.x) / CELL.w) * CELL.w, y: origin.y + Math.round((p.y - origin.y) / CELL.h) * CELL.h }
}

/** The cell a top-left stands in (nearest) on the grid at `origin`, as a key: two cards in one cell have one key. */
export function cellKey(p: { x: number; y: number }, origin: { x: number; y: number }): string {
  return `${Math.round((p.x - origin.x) / CELL.w)},${Math.round((p.y - origin.y) / CELL.h)}`
}

/**
 * The free cell nearest to `target` (a cell's top-left) on the grid at `origin`: `target` itself when no card holds it,
 * else the nearest by distance among the rings around it (demo feedback: two cards never end in one cell). White space is fine.
 */
export function freeCell(target: { x: number; y: number }, taken: ReadonlySet<string>, origin: { x: number; y: number }): { x: number; y: number } {
  if (!taken.has(cellKey(target, origin))) return target
  for (let r = 1; r <= 64; r++) {
    const ring: { x: number; y: number; d: number }[] = []
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue
        const p = { x: target.x + i * CELL.w, y: target.y + j * CELL.h }
        if (!taken.has(cellKey(p, origin))) ring.push({ ...p, d: Math.hypot(i * CELL.w, j * CELL.h) })
      }
    if (ring.length > 0) {
      ring.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
      return { x: ring[0].x, y: ring[0].y }
    }
  }
  return target
}

/**
 * THE LAYOUT (YAZ-3343 D1, D8): where every card, group, vault name and window frame stands on the canvas.
 * Plain arithmetic, no DOM: the board calls it once per render input and never measures a card.
 *
 * A card the user moved stands at its stored place (`stored`, the entries of this layout `by`); every other
 * card stands in its AUTO slot. POSITIONS ARE STABLE (Yaseen's demo feedback): the slots are computed from ALL
 * the cards as if none were moved, so a moved card leaves its slot empty and nothing else shifts; only a tab
 * that opens or closes (or "Tidy up") reflows. A drawn box wraps ITS CARDS ONLY (demo bug, "the window pane is
 * getting bigger and bigger"): a box dragged as a whole moves with its cards, never stretches from its old place.
 *
 * 'folder' (the switch off): the groups of the window flow as the islands always did — side by side, wrapping
 * at `wrapW`, a vault's islands under its name — each group's box round its cards, its label row above them.
 * 'window' (the switch on): each window is a FRAME that holds its cards DIRECTLY (demo feedback: "remove the
 * folder boxes inside window frames, cards in folder order"): one grid of `BOARD.frameCols` columns in the
 * groups' order — vault, then folder, then strip order — so a folder's cards sit together; each card says its
 * folder itself. The frames flow side by side and wrap at `wrapW`; an empty window keeps a frame a card wide.
 *
 * The world's origin is the top-left of the first frame (or group); the camera adds the padding.
 */
export function layoutCanvas(windows: readonly FrameInput[], { by, wrapW, stored, anchors, aspect }: { by: CanvasLayout; wrapW: number; stored: readonly CanvasCard[]; anchors?: ReadonlyMap<string, { x: number; y: number }>; aspect?: number }): CanvasPlan {
  const { pageW, pageH, pageGap, islandPad, labelH, islandGap, vaultH, framePad, frameLabelH, frameGap, apart } = BOARD
  const places = new Map<string, CanvasCard>()
  for (const card of stored) if (card.by === by) places.set(canvasCardKey(card), card)
  /** A card at its stored place, else at its slot. */
  const place = (win: string, page: BoardPage, slot: { x: number; y: number }): PlacedCard => {
    const at = places.get(canvasCardKey({ win, by, path: page.path, copy: page.copy }))
    return at !== undefined ? { x: at.x, y: at.y, moved: true } : { ...slot, moved: false }
  }
  const cardRect = (card: PlacedCard): Rect => ({ x: card.x, y: card.y, w: pageW, h: pageH })

  const cards = new Map<string, PlacedCard>()
  const order: string[] = []
  const groups: PlacedGroup[] = []
  const vaults: PlacedVault[] = []
  const frames: PlacedFrame[] = []
  let bounds: Rect | null = null

  if (by === 'window') {
    // Each frame's own grid (demo feedback, "spread out"): `colsFor` columns, so a frame is about as wide as tall.
    const sizes = windows.map((win) => {
      const pages = win.vaults.flatMap((vault) => vault.islands.flatMap((island) => island.pages))
      const cols = colsFor(pages.length)
      const used = Math.max(1, Math.min(cols, pages.length))
      const rows = Math.ceil(pages.length / cols)
      // An empty window still has a frame, a card wide: a card can be dropped in it (D13).
      const fw = used * pageW + (used - 1) * pageGap + 2 * framePad
      const fh = (rows === 0 ? pageH : rows * pageH + (rows - 1) * pageGap) + 2 * framePad
      const placedAll = pages.length > 0 && pages.every((page) => places.has(canvasCardKey({ win: win.win, by, path: page.path, copy: page.copy })))
      return { win, pages, cols, fw, fh, placedAll }
    })
    // The frames pack in rows as wide as the VIEWPORT'S SHAPE asks (demo feedback): √(their area × its aspect), the
    // widest frame at least. Window order, so the same windows give the same layout. With no shape, the viewport's width.
    const area = sizes.reduce((sum, f) => sum + (f.fw + frameGap) * (frameLabelH + f.fh + frameGap), 0)
    const rowW = aspect === undefined ? wrapW : Math.max(...sizes.map((f) => f.fw), Math.sqrt(area * aspect))
    // A frame whose every card the user placed stands where they are: the others give way to it (no overlap).
    const labelled = (r: Rect): Rect => ({ x: r.x, y: r.y - frameLabelH, w: r.w, h: r.h + frameLabelH })
    const boxOf = (rects: readonly Rect[]): Rect | null => rects.reduce<Rect | null>((box, r) => union(box, r), null)
    const obstacles: Rect[] = []
    for (const f of sizes) {
      if (!f.placedAll) continue
      const box = boxOf(f.pages.map((page) => cardRect(place(f.win.win, page, { x: 0, y: 0 }))))
      if (box !== null) obstacles.push(labelled({ x: box.x - framePad, y: box.y - framePad, w: box.w + 2 * framePad, h: box.h + 2 * framePad }))
    }
    let fx = 0
    let fy = 0
    let frameLine = 0
    for (const { win, pages, cols, fw, fh, placedAll } of sizes) {
      // A window opened from the board (demo feedback) stands where it was asked for — its label's top-left at
      // `anchors` — out of the flow. Every other frame keeps its place in the flow, moved or not (no reshuffle).
      const anchor = anchors?.get(win.win)
      let left: number
      let top: number
      if (anchor !== undefined) {
        left = anchor.x
        top = anchor.y
      } else {
        if (fx > 0 && fx + frameGap + fw > rowW) {
          fy += frameLine + frameGap
          fx = 0
          frameLine = 0
        }
        left = fx === 0 ? 0 : fx + frameGap
        top = fy
        fx = left + fw
        frameLine = Math.max(frameLine, frameLabelH + fh)
      }
      // No overlap (demo feedback): a frame whose laid-out cards would land where a placed frame stands takes the nearest
      // free spot. Only the cards it lays out count — the ones the user moved are theirs, kept clear by the drop's rule.
      const slotOf = (i: number, ox: number, oy: number) => ({ x: ox + (i % cols) * (pageW + pageGap), y: oy + Math.floor(i / cols) * (pageH + pageGap) })
      const own = (): Rect => {
        const auto = pages.flatMap((page, i) => (places.has(canvasCardKey({ win: win.win, by, path: page.path, copy: page.copy })) ? [] : [cardRect({ ...slotOf(i, left + framePad, top + frameLabelH + framePad), moved: false })]))
        const box = boxOf(auto)
        return box === null ? { x: left, y: top, w: fw, h: frameLabelH + fh } : { x: box.x - framePad, y: box.y - framePad - frameLabelH, w: box.w + 2 * framePad, h: box.h + 2 * framePad + frameLabelH }
      }
      let mine = own()
      if (!placedAll) {
        const to = freeFramePosition(mine, obstacles, apart)
        left += to.x - mine.x
        top += to.y - mine.y
        mine = own()
      }
      const ox = left + framePad
      const oy = top + frameLabelH + framePad
      let box: Rect | null = null
      pages.forEach((page, i) => {
        const card = place(win.win, page, slotOf(i, ox, oy))
        cards.set(page.id, card)
        order.push(page.id)
        box = union(box, cardRect(card))
      })
      const frame: Rect = box === null ? { x: left, y: top + frameLabelH, w: fw, h: fh } : { x: (box as Rect).x - framePad, y: (box as Rect).y - framePad, w: (box as Rect).w + 2 * framePad, h: (box as Rect).h + 2 * framePad }
      frames.push({ win: win.win, ...frame })
      // What the others keep clear of is this frame's own laid-out box: a card the user moved out of it is theirs to
      // place clear (the drop's rule), and moving one never moves another frame (no reshuffle).
      if (!placedAll) obstacles.push(mine)
      bounds = union(bounds, labelled(frame))
    }
    return { cards, order, groups, vaults, frames, bounds: bounds ?? { x: 0, y: 0, w: 0, h: 0 } }
  }

  // The groups wrap at a width of the viewport's shape (demo feedback, "spread out"): √(their area × its aspect).
  if (aspect !== undefined) {
    const boxes = windows.flatMap((win) => win.vaults.flatMap((vault) => vault.islands.map((island) => islandBox(island.pages.length, Infinity))))
    const area = boxes.reduce((sum, b) => sum + (b.w + islandGap) * (b.h + islandGap), 0)
    wrapW = Math.max(...boxes.map((b) => b.w), Math.sqrt(area * aspect))
  }
  for (const win of windows) {
    // 1. The window's AUTO flow: the groups' grid boxes and EVERY card's slot in them, moved or not.
    const auto: { at: number; island: Island; slots: Map<string, { x: number; y: number }> }[] = []
    const autoVaults: { name: string; at: number }[] = []
    let y = 0
    let started = false
    for (const vault of win.vaults) {
      if (started) y += islandGap
      started = true
      if (vault.named) {
        autoVaults.push({ name: vault.name, at: vault.at })
        y += vaultH
      }
      let x = 0
      let line = 0
      for (const island of vault.islands) {
        const box = islandBox(island.pages.length, wrapW)
        if (x > 0 && x + islandGap + box.w > wrapW) {
          y += line + islandGap
          x = 0
          line = 0
        }
        const cols = islandCols(island.pages.length, wrapW)
        const cx = (x === 0 ? 0 : x + islandGap) + islandPad
        const cy = y + islandPad + labelH
        const slots = new Map(island.pages.map((page, i) => [page.id, { x: cx + (i % cols) * (pageW + pageGap), y: cy + Math.floor(i / cols) * (pageH + pageGap) }]))
        auto.push({ at: vault.at, island, slots })
        x = cx - islandPad + box.w
        line = Math.max(line, cy - islandPad - labelH - y + box.h)
      }
      y += line
    }
    // 2. Every card at its place, each group round its cards, and a vault's name right above its groups.
    const vaultBoxes = new Map<number, Rect>()
    for (const { at, island, slots } of auto) {
      let box: Rect | null = null
      for (const page of island.pages) {
        const card = place(win.win, page, slots.get(page.id) ?? { x: 0, y: 0 })
        cards.set(page.id, card)
        order.push(page.id)
        box = union(box, cardRect(card))
      }
      if (box === null) continue
      const b: Rect = box
      const rect = { x: b.x - islandPad, y: b.y - islandPad - labelH, w: b.w + 2 * islandPad, h: b.h + 2 * islandPad + labelH }
      groups.push({ key: `${win.win}\n${island.dir}`, win: win.win, island, ...rect })
      vaultBoxes.set(at, union(vaultBoxes.get(at) ?? null, rect))
      bounds = union(bounds, rect)
    }
    for (const label of autoVaults) {
      const round = vaultBoxes.get(label.at)
      if (round === undefined) continue
      const name = { x: round.x, y: round.y - vaultH, w: Math.max(round.w, pageW), h: vaultH }
      vaults.push({ key: `${win.win}\n${label.at}`, name: label.name, ...name })
      bounds = union(bounds, name)
    }
  }
  return { cards, order, groups, vaults, frames, bounds: bounds ?? { x: 0, y: 0, w: 0, h: 0 } }
}

/** The window whose frame (its label row included) holds the world point, or null (YAZ-3343 D13). A later frame wins where two overlap. */
export function frameAt(frames: readonly PlacedFrame[], x: number, y: number): string | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]
    if (x >= f.x && x <= f.x + f.w && y >= f.y - BOARD.frameLabelH && y <= f.y + f.h) return f.win
  }
  return null
}

/** What a dropped card does (YAZ-3343 D12, D13): stay where it was put, go to another window, or slide back because that window cannot show it. */
export type DropOutcome = { kind: 'place' } | { kind: 'move'; to: string } | { kind: 'refuse'; to: string }

/**
 * THE DROP RULE (YAZ-3343 D13). With "Show all windows" off a drop only places the card. With it on, a
 * card dropped with the pointer inside ANOTHER window's frame goes to that window — unless that window
 * shows no vault of the page (`rootsOf(to)` holds none), which refuses it. Anywhere else, its own frame
 * or empty canvas, it stays where it was put.
 */
export function dropOutcome({ from, path, at, frames, framed, rootsOf }: { from: string; path: string; at: { x: number; y: number }; frames: readonly PlacedFrame[]; framed: boolean; rootsOf: (win: string) => readonly string[] | undefined }): DropOutcome {
  if (!framed) return { kind: 'place' }
  const to = frameAt(frames, at.x, at.y)
  if (to === null || to === from) return { kind: 'place' }
  return rootOfPath(rootsOf(to) ?? [], path) === null ? { kind: 'refuse', to } : { kind: 'move', to }
}

export type Way = 'left' | 'right' | 'up' | 'down'

/**
 * Where an arrow key goes on a board that wraps both ways: from `boxes[from]`, by centres. A box
 * on the same line that way wins — → stays on its row while the row has a page, ↓ lands on the
 * page right below — and the nearest of them is taken. With none on the line, the nearest box
 * that way at all, a step off the line counting double. -1 when nothing lies that way.
 */
export function nearest(boxes: readonly Box[], from: number, way: Way): number {
  const here = boxes[from]
  if (here === undefined) return -1
  const cx = here.left + here.width / 2
  const cy = here.top + here.height / 2
  const flat = way === 'left' || way === 'right'
  const sign = way === 'left' || way === 'up' ? -1 : 1
  const reach = (flat ? here.height : here.width) / 2
  let best = -1
  let bestOnLine = false
  let bestScore = Infinity
  boxes.forEach((box, i) => {
    if (i === from) return
    const dx = box.left + box.width / 2 - cx
    const dy = box.top + box.height / 2 - cy
    const along = (flat ? dx : dy) * sign
    const across = Math.abs(flat ? dy : dx)
    if (along < 1) return
    const onLine = across <= reach
    if (bestOnLine && !onLine) return
    const score = onLine ? along : along * along + 4 * across * across
    if ((onLine && !bestOnLine) || score < bestScore) {
      best = i
      bestOnLine = onLine
      bestScore = score
    }
  })
  return best
}

/** A note's first lines without a first line that only repeats its title (a daily note headed with its own date). */
export function withoutTitle(lines: string, title: string): string {
  const end = lines.indexOf('\n')
  const first = end === -1 ? lines : lines.slice(0, end)
  return first.trim().toLowerCase() === title.trim().toLowerCase() ? (end === -1 ? '' : lines.slice(end + 1)) : lines
}
