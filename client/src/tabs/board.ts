/**
 * The tab board's arithmetic (YAZ-2648), with no DOM and no React, so the rules are testable:
 * which pages stand on which island, how big an island is, which islands are stacks, and where an
 * arrow key goes.
 *
 * The sizes below are the board's ONE source: `TabOverview` hands them to the stylesheet as custom
 * properties, and the stack rule reads the same numbers. So what the rule computes is what the
 * browser lays out, and the rule never has to measure the pages it placed.
 */
import { rootOfPath, stripSlash } from '@shared/types'
import { dirname, relTo } from '../lib/paths'

/** Every length is in px. A page is a sheet of paper, 3:4, big enough to read its first lines. */
export const BOARD = {
  pageW: 200,
  pageH: 266,
  /** Between two pages of an island. */
  pageGap: 14,
  /** Around an island's pages. */
  islandPad: 14,
  /** An island's label row, the gap under the label in it. */
  labelH: 28,
  /** Between two islands, sideways and down, and between two vaults. */
  islandGap: 20,
  /** A vault's name above its islands (two or more vaults). */
  vaultH: 34,
  /** How far a stack's fanned pages reach past the top one: sideways, and up into the gap under the label. */
  fanX: 20,
  fanY: 10,
  /** Around the whole board, inside its scroller. */
  padX: 28,
  padTop: 10,
  padBottom: 32,
  /** The fewest pages an island needs before it can be a stack: "more than three" (the owner's rule). */
  stackMin: 4,
} as const

export interface BoardPage {
  path: string
  label: string
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

/**
 * The open tabs as islands (D7): one per folder that DIRECTLY holds a page, under its vault. Read
 * off the paths; nothing is stored. Vaults stand in the window's order, a vault's top level first
 * and its folders by path, and the pages of an island in the strip's order. `terms` is the filter,
 * lowercased: a page stays when its title or its path inside the vault holds every one.
 */
export function buildBoard(tabs: readonly string[], roots: readonly string[], vaultNames: readonly string[], labelOf: (path: string) => string, terms: readonly string[] = []): VaultIslands[] {
  const vaults = new Map<number, Map<string, Island>>()
  for (const path of tabs) {
    const root = rootOfPath(roots, path)
    const label = labelOf(path)
    const hay = `${label}\n${root === null ? path : relTo(root, path)}`.toLowerCase()
    if (!terms.every((term) => hay.includes(term))) continue
    const at = root === null ? roots.length : roots.indexOf(root)
    const dir = dirname(path)
    const top = root !== null && dir === stripSlash(root)
    const islands = vaults.get(at) ?? new Map<string, Island>()
    vaults.set(at, islands)
    const island = islands.get(dir) ?? { dir, top, label: root === null ? dir : top ? (vaultNames[at] ?? '') : relTo(root, dir).split('/').join(' / '), pages: [] }
    islands.set(dir, island)
    island.pages.push({ path, label })
  }
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
  const wanted = count === 4 ? 2 : Math.min(count, 3)
  const fits = Math.floor((boardW - 2 * BOARD.islandPad + BOARD.pageGap) / (BOARD.pageW + BOARD.pageGap))
  return Math.max(1, Math.min(wanted, fits))
}

/** An island's box as the stylesheet lays it out: its label row, then its pages in a grid — or, as a stack, one page with its fan. */
export function islandBox(count: number, stacked: boolean, boardW: number): { w: number; h: number } {
  const { pageW, pageH, pageGap, islandPad, labelH, fanX } = BOARD
  // A stack is one page high — its fan reaches up into the label's gap — so it is never bigger than its island spread.
  if (stacked) return { w: pageW + fanX + 2 * islandPad, h: labelH + pageH + 2 * islandPad }
  const cols = islandCols(count, boardW)
  const rows = Math.ceil(count / cols)
  return { w: cols * pageW + (cols - 1) * pageGap + 2 * islandPad, h: labelH + rows * pageH + (rows - 1) * pageGap + 2 * islandPad }
}

/** What the stack rule needs of the board: each vault's islands by identity and size, and whether the vault is named above them. */
export interface BoardShape {
  named: boolean
  islands: { dir: string; count: number }[]
}

/** The height of the whole board at this width: each vault's islands wrap as a flex row does, a line as tall as its tallest island. */
export function boardHeight(shape: readonly BoardShape[], stacked: ReadonlySet<string>, boardW: number): number {
  let height = 0
  shape.forEach((vault, i) => {
    if (i > 0) height += BOARD.islandGap
    if (vault.named) height += BOARD.vaultH
    let x = 0
    let line = 0
    for (const island of vault.islands) {
      const box = islandBox(island.count, stacked.has(island.dir), boardW)
      if (x > 0 && x + BOARD.islandGap + box.w > boardW) {
        height += line + BOARD.islandGap
        x = 0
        line = 0
      }
      x = x === 0 ? box.w : x + BOARD.islandGap + box.w
      line = Math.max(line, box.h)
    }
    height += line
  })
  return height
}

/**
 * THE STACK RULE (YAZ-2648): which islands show as a stack — one page, the others fanned behind it.
 *
 * A board that fits its area stacks nothing. One that does not stacks the island with the most
 * pages, then the next, until it fits or no island of `BOARD.stackMin` pages is left spread; then
 * it scrolls. An island of three pages or fewer never stacks: a stack of two hides as much as it
 * saves. One the user spread (`spread`) stays spread. The
 * island of the active tab (`keep`) goes last, so the page the user came from is in a stack only when
 * nothing else is left.
 *
 * It is a function of the board's AREA and of the tabs, and of nothing it decides: the area is
 * the scroller's own box, which the window sizes and the pages do not. So the answer cannot move
 * the question, and asking twice gives the same set. An area not measured yet (`null`, or no
 * width) stacks nothing.
 */
export function stackedIslands(shape: readonly BoardShape[], area: { w: number; h: number } | null, spread: ReadonlySet<string> = new Set(), keep: string | null = null): ReadonlySet<string> {
  const stacked = new Set<string>()
  if (area === null || area.w <= 0 || area.h <= 0) return stacked
  const order = shape
    .flatMap((vault) => vault.islands)
    .filter((island) => island.count >= BOARD.stackMin && !spread.has(island.dir))
    // The sort is stable: islands of one size go in the board's order.
    .sort((a, b) => Number(a.dir === keep) - Number(b.dir === keep) || b.count - a.count)
  for (const island of order) {
    if (boardHeight(shape, stacked, area.w) <= area.h) break
    stacked.add(island.dir)
  }
  return stacked
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
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
