/**
 * ⌘F on a folder page (YAZ-4613, D64): the find engine behind the `views` find bar, as `findInPage.ts` is the page's.
 *
 * It matches the text the view shows — a table's shown cells, a Board, List or Cards card's title and shown fields, a
 * Calendar card's title — read as the export reads it (`cellText`, YAZ-4594), over the view's ROWS and never the DOM:
 * one walk per query, debounced. A collapsed group's rows count; landing on one opens its group. Only mounted cells and
 * cards are marked, with `data-find` (an attribute React does not own, the table selection's idiom, YAZ-4593): a search
 * renders no view, and a scroll or a mount marks the new items in one pass of a mutation observer, while find is open.
 * Esc lands the focus on the current match: in a table that is its cell, the one-cell selection (YAZ-4593).
 */
import { createContext, type RefObject, useEffect, useMemo, useRef } from 'react'
import { type FindChannel, type FindController, type FindResult, createFindChannel } from '../../editor/find/findChannel'
import type { Group, Row } from '../engine'
import { type CellTextContext, cellText } from '../exportView'
import { TOP_SPOT, type GroupSpot, childSpot, spotKey } from './groupDrag'
import { canonicalKey } from './keys'
import { cssZoom } from '../../lib/cssZoom'
import { leastScroll, SHOW_GAP } from '../../editor/find/leastScroll'

/** The nearest ancestor that scrolls on this axis, or null. */
function scrollParent(el: HTMLElement, axis: 'x' | 'y'): HTMLElement | null {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const style = getComputedStyle(p)
    const overflow = axis === 'y' ? style.overflowY : style.overflowX
    if (/(auto|scroll)/.test(overflow) && (axis === 'y' ? p.scrollHeight > p.clientHeight : p.scrollWidth > p.clientWidth)) return p
  }
  return null
}


/**
 * Shows a match WHOLE with the least scroll, and none when it shows already (YAZ-3746 13BA): `scrollIntoView` counted
 * the table's sticky header, frozen rows and totals as room, so a match scrolled in from below could stop under the
 * header. The room here is the scroller's box less the table's sticky parts: below the header and the frozen rows
 * (and the find bar, where it floats over the match), above the totals row, and right of the frozen columns.
 */
export function showWhole(el: HTMLElement): void {
  const r = el.getBoundingClientRect()
  const table = el.closest('table')
  const y = scrollParent(el, 'y')
  if (y !== null) {
    const box = y.getBoundingClientRect()
    let top = box.top
    let bottom = box.bottom
    if (table !== null && el.closest('tbody') !== null) {
      const head = table.tHead?.getBoundingClientRect()
      if (head !== undefined && head.height > 0) top = Math.max(top, head.bottom)
      for (const row of table.querySelectorAll<HTMLElement>('tbody tr.view-table__row--frozen')) if (!row.contains(el)) top = Math.max(top, row.getBoundingClientRect().bottom)
      const foot = table.tFoot?.getBoundingClientRect()
      if (foot !== undefined && foot.height > 0 && foot.top > top) bottom = Math.min(bottom, foot.top)
    }
    // The find bar itself floats over the page's top right: a match under it is covered too.
    for (const bar of document.querySelectorAll<HTMLElement>('.find-bar')) {
      const b = bar.getBoundingClientRect()
      if (b.height > 0 && b.left < r.right && b.right > r.left && b.top < box.top + box.height / 2) top = Math.max(top, b.bottom)
    }
    const zoom = cssZoom(y)
    const dy = leastScroll({ start: r.top, end: r.bottom }, { start: top, end: bottom }, SHOW_GAP)
    if (dy !== 0) y.scrollTop += dy / zoom
  }
  const x = scrollParent(el, 'x')
  if (x !== null && !el.classList.contains('view-table__frozen')) {
    const box = x.getBoundingClientRect()
    let left = box.left
    const right = box.right
    if (table !== null) {
      const stuck = el.closest('tr')?.querySelectorAll<HTMLElement>('.view-table__frozen, .view-table__gutter')
      for (const cell of stuck ?? []) left = Math.max(left, cell.getBoundingClientRect().right)
    }
    const zoom = cssZoom(x)
    const at = el.getBoundingClientRect()
    const dx = leastScroll({ start: at.left, end: at.right }, { start: left, end: right }, SHOW_GAP)
    if (dx !== 0) x.scrollLeft += dx / zoom
  }
}

/** The pause after a keystroke before the rows are searched (D64: about 120 ms). */
export const FIND_DEBOUNCE_MS = 120
/** The mark on a mounted match: `active` on the current one, empty on the others. */
export const FIND_ATTR = 'data-find'

/** What the view shows, read when a search runs. `table` matches cells; `cards` whole cards; `titles` (Calendar) titles. */
export interface FindSource {
  kind: 'table' | 'cards' | 'titles'
  /** The view's rows after filters, sort and the search box; no groups: they are the order. */
  rows: readonly Row[]
  groups: readonly Group[] | null
  /** The shown columns, in the table's order (`propertyKeys`): a cell's `data-cell` column index reads into it. */
  keys: readonly string[]
  ctx: CellTextContext
}

/** One match: a table cell (`key`), or a card (`key` null). `groups`: the collapse keys of the groups above it. */
export interface ViewMatch {
  path: string
  key: string | null
  groups: readonly string[]
}

/** The table's side (written at each render): scroll a windowed table to the line of `path`'s row, so it mounts. */
export interface ViewFindLink {
  scrollTo: ((path: string) => void) | null
}
export const ViewFind = createContext<ViewFindLink | null>(null)

/**
 * Every match in display order: group by group, a group's direct rows before its inner groups (the table's walk), each
 * row's cells left to right. A row shown under two groups (fan-out) is matched once, under the first.
 */
export function findMatches(source: FindSource, query: string): ViewMatch[] {
  const needle = query.toLowerCase()
  const out: ViewMatch[] = []
  if (needle === '') return out
  const { kind, keys, ctx } = source
  const seen = new Set<string>()
  const has = (text: string) => text.toLowerCase().includes(needle)
  const fields = keys.filter((k) => canonicalKey(k) !== 'file.name')
  const visit = (row: Row, groups: readonly string[]) => {
    const path = row.record.path
    if (seen.has(path)) return
    seen.add(path)
    if (kind === 'table') {
      for (const key of keys) if (has(cellText(row, key, ctx))) out.push({ path, key, groups })
    } else if (has(row.record.title) || (kind === 'cards' && fields.some((k) => has(cellText(row, k, ctx))))) out.push({ path, key: null, groups })
  }
  if (source.groups === null) {
    for (const row of source.rows) visit(row, [])
    return out
  }
  const walk = (list: readonly Group[], at: GroupSpot, above: readonly string[]) => {
    for (const g of list) {
      const groups = [...above, spotKey(g, at)]
      for (const row of g.children === undefined ? g.rows : g.direct ?? []) visit(row, groups)
      if (g.children !== undefined) walk(g.children, childSpot(g, at), groups)
    }
  }
  walk(source.groups, TOP_SPOT, [])
  return out
}

export interface ViewFinderDeps {
  channel: FindChannel
  pane: () => HTMLElement | null
  /** Null on the Page tab and on a view type find does not know. */
  source: () => FindSource | null
  link: ViewFindLink
  /** The view's collapsed group keys now, and the door that opens some of them. */
  collapsed: () => readonly string[]
  expand: (keys: readonly string[]) => void
}

export interface ViewFinder {
  /** The rows changed (an edit, a filter, another view tab) while find is open: search again, keep the place. */
  refresh: () => void
  dispose: () => void
}

const NONE: FindResult = { total: 0, activeIndex: -1 }

export function createViewFinder({ channel, pane, source, link, collapsed, expand }: ViewFinderDeps): ViewFinder {
  let query = ''
  let matches: ViewMatch[] = []
  /** The matches by path: the keys of a row's matching cells (null for a card). Built once per search. */
  let byPath = new Map<string, Set<string | null>>()
  let active = -1
  let keys: readonly string[] = []
  let kind: FindSource['kind'] = 'table'
  /** The Calendar's rows the last search read: a page to another month brings other rows, and a new search. */
  let searched: readonly Row[] | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  /** The current match still has to be brought into view: a group to open, or a windowed line to mount first. */
  let pending = false
  let observer: MutationObserver | null = null
  /** Where the focus was when find opened: Esc goes back there when no match is current. */
  let opener: Element | null = null
  let wasOpen = false

  const result = (): FindResult => (matches.length === 0 ? NONE : { total: matches.length, activeIndex: active })

  /** The mounted element of a match: its cell in a table, else its card. */
  const elementOf = (m: ViewMatch): HTMLElement | null => {
    const item = pane()?.querySelector<HTMLElement>(`[data-hover-item="${CSS.escape(m.path)}"]`) ?? null
    if (item === null || m.key === null) return item
    return item.querySelector<HTMLElement>(`td[data-cell$=":${keys.indexOf(m.key)}"]`)
  }

  /** Marks the mounted matches: one pass over the mounted items, never a render. */
  const paint = () => {
    const root = pane()
    if (root === null) return
    for (const el of root.querySelectorAll(`[${FIND_ATTR}]`)) el.removeAttribute(FIND_ATTR)
    if (matches.length === 0) return
    const at = matches[active]
    for (const item of root.querySelectorAll<HTMLElement>('[data-hover-item]')) {
      const path = item.dataset.hoverItem!
      const hits = byPath.get(path)
      if (hits === undefined) continue
      if (kind !== 'table') {
        item.setAttribute(FIND_ATTR, at.path === path ? 'active' : '')
        continue
      }
      for (const td of item.querySelectorAll<HTMLElement>('td[data-cell]')) {
        const key = keys[Number(td.dataset.cell!.split(':')[1])]
        if (hits.has(key)) td.setAttribute(FIND_ATTR, at.path === path && at.key === key ? 'active' : '')
      }
    }
  }

  /** Brings the current match into view: opens its groups, mounts its windowed line, then scrolls to it. */
  const reveal = () => {
    const m = matches[active]
    if (m === undefined) return
    pending = true
    paint()
    const shut = new Set(collapsed())
    const closed = m.groups.filter((k) => shut.has(k))
    if (closed.length > 0) return expand(closed)
    const el = elementOf(m)
    // A table's line or a board's card not drawn yet (YAZ-3746 13AX): the view draws it, and `onMutate` finishes the jump.
    if (el === null) return link.scrollTo?.(m.path)
    pending = false
    showWhole(el)
  }

  /** A mount (a scroll, an opened group, a calendar page) marks the new items and finishes a pending jump. */
  const onMutate = () => {
    const src = source()
    if (src?.kind === 'titles' && src.rows !== searched) return schedule(false)
    paint()
    if (pending) reveal()
  }
  const watch = (on: boolean) => {
    const root = pane()
    if (!on || root === null) {
      observer?.disconnect()
      observer = null
    } else if (observer === null) {
      observer = new MutationObserver(onMutate)
      observer.observe(root, { childList: true, subtree: true })
    }
  }

  const run = (land: boolean) => {
    timer = null
    const src = source()
    const before = matches[active]
    matches = src === null ? [] : findMatches(src, query)
    keys = src?.keys ?? []
    kind = src?.kind ?? 'table'
    searched = src?.rows ?? null
    byPath = new Map()
    for (const m of matches) {
      const hits = byPath.get(m.path)
      if (hits === undefined) byPath.set(m.path, new Set([m.key]))
      else hits.add(m.key)
    }
    // An edit or a longer query keeps the current match when it still matches; else the first.
    const kept = before === undefined ? -1 : matches.findIndex((m) => m.path === before.path && m.key === before.key)
    active = matches.length === 0 ? -1 : Math.max(0, kept)
    pending = false
    watch(query !== '')
    if (land) reveal()
    else paint()
    channel.sync(result())
  }
  function schedule(land: boolean) {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => run(land), FIND_DEBOUNCE_MS)
  }
  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const controller: FindController = {
    search(next) {
      query = next
      if (next !== '') {
        schedule(true)
        return result()
      }
      cancel()
      matches = []
      active = -1
      watch(false)
      paint()
      return NONE
    },
    step(delta) {
      if (timer !== null) {
        cancel()
        run(false)
      }
      if (matches.length === 0) return NONE
      active = (active + delta + matches.length) % matches.length
      reveal()
      return result()
    },
    close() {
      cancel()
      const m = matches[active]
      const el = m === undefined ? null : elementOf(m)
      matches = []
      active = -1
      pending = false
      watch(false)
      paint()
      // Only a close from the bar (Esc, ×) moves the focus; a switch to the Page tab leaves it where the click put it.
      const from = document.activeElement
      if (from !== null && from !== document.body && from.closest('.find-bar') === null) return
      const back = el ?? (opener?.isConnected === true ? opener : null)
      if (back instanceof HTMLElement) back.focus()
    },
  }

  const unbind = channel.bind(controller)
  const unsubscribe = channel.subscribe(() => {
    const { open } = channel.getState()
    // Read before the bar mounts its input and takes the focus.
    if (open && !wasOpen) opener = document.activeElement
    wasOpen = open
  })
  return {
    refresh() {
      if (channel.getState().open && query !== '') schedule(false)
    },
    dispose() {
      cancel()
      watch(false)
      unbind()
      unsubscribe()
    },
  }
}

/**
 * ViewsPane's side: one channel and one finder per folder page mount. `source`, `collapsed` and `expand` are read at
 * each search, never at render; `changed` lists what makes the rows change, so an open find searches again.
 */
export function useViewFind(
  paneRef: RefObject<HTMLElement | null>,
  latest: { source: () => FindSource | null; collapsed: readonly string[]; expand: (keys: readonly string[]) => void },
  changed: readonly unknown[],
  off: boolean,
): { channel: FindChannel; link: ViewFindLink } {
  const channel = useMemo(createFindChannel, [])
  const link = useMemo<ViewFindLink>(() => ({ scrollTo: null }), [])
  const now = useRef(latest)
  now.current = latest
  const finder = useRef<ViewFinder | null>(null)
  useEffect(() => {
    const made = createViewFinder({
      channel,
      link,
      pane: () => paneRef.current,
      source: () => now.current.source(),
      collapsed: () => now.current.collapsed,
      expand: (keys) => now.current.expand(keys),
    })
    finder.current = made
    return made.dispose
  }, [channel, link, paneRef])
  useEffect(() => finder.current?.refresh(), changed) // eslint-disable-line react-hooks/exhaustive-deps -- the caller's list
  // The Page tab has its own find (the page's): a find left open on a view closes there.
  useEffect(() => {
    if (off) channel.close()
  }, [off, channel])
  return { channel, link }
}
