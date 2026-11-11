/**
 * Super tables (YAZ-4869, S1–S5; CONTRACTS rule 41a): a note table whose views show as tabs over it. The table stays
 * the source: tab "Table" is the table itself, as before, and each other tab is a VIEW of the same rows, drawn by the
 * zoom pill's anchor (`tableZoomPill.tsx`, the lazy `SuperTable.tsx`). The views live in the table comment
 * (`viewGrammar.ts`); a plain table costs nothing.
 *
 * This file is the eager part, small on purpose:
 * - THE RULES and the six-dot menu's two rows' work: `superRule` (a body cell that spans rows, Time slots), on and off.
 * - THE ACTIVE TAB is outside the file: a node decoration hides the table while a view shows (`SUPER_HIDDEN_CLASS`,
 *   `table.css`), and the tab is kept per note, per table (its index in the note) in the app state's view groups
 *   (`storage.setViewGroups`, as the folder pages keep their collapsed groups). A tab switch changes no document.
 * - THE REDRAW: a transaction marks the Super tables it changed; the plugin view asks only their anchors to draw again
 *   (`renderSuper`), debounced while you type there. Typing in another block finds no Super table around the step and
 *   asks nothing.
 * - THE HEADER RENAME (item 15): an `appendTransaction` that acts only when a key changes a Super table's header row,
 *   and renames the column in that table's views in the same step.
 * - FIND (item 25): when ⌘F's current match is in a Super table that shows a view, the anchor shows that row.
 */
import { closeHistory } from '@milkdown/kit/prose/history'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from '@milkdown/kit/prose/state'
import { TableMap } from '@milkdown/kit/prose/tables'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { storage } from '../../../lib/storage'
import { findThreadAnchor } from '../../find/findInPage'
import { cellStartsAt } from '../cells'
import { changedTables, typingOnly, type TableAttrs } from '../tableStyle'
import { columnKeys, renameColumns, type TableViewDef } from './viewGrammar'

/** On the table block while one of its views shows: `table.css` hides it. */
export const SUPER_HIDDEN_CLASS = 'table-super-hidden'

/** Where the note is, for what this Mac remembers of its tables (the active tab, the collapsed groups). */
export interface SuperPlace {
  root: string
  notePath: string
}

/** A table anchor's doors (`tableZoomPill.tsx`): draw again (debounced while typing), and show a found row. */
export interface SuperAnchor extends HTMLElement {
  renderSuper?: (typing: boolean) => void
  findRow?: (row: number) => void
}

interface SuperState {
  /** The hide decoration of each table that shows a view; its spec holds the view's name. */
  hidden: DecorationSet
  /** The Super tables the last counted transaction changed, by position. */
  dirty: readonly number[]
  typing: boolean
  /** Counts each transaction that marked a table: the plugin view looks only when it moves. */
  generation: number
  place: SuperPlace | null
}

export const superKey = new PluginKey<SuperState>('mdapp-super-tables')

interface SuperMeta {
  pos: number
  view: string | null
}

// ---------- the rules (S1) ----------

/** Why `table` cannot be a Super table (items 17, 18), or `null`. */
export function superRule(table: ProseNode): string | null {
  let spans = false
  table.forEach((row, _, r) => {
    if (r > 0) row.forEach((cell) => (spans ||= (cell.attrs.rowspan as number) > 1))
  })
  if (spans) return 'A cell spans rows'
  if ((table.attrs.calendar as number) > 0) return 'Time slots are on'
  return null
}

const isTable = (node: ProseNode | null | undefined): node is ProseNode => node?.type.name === 'table'

/** "Turn into Super table": one undo step. Off (no change) while `superRule` says no. */
export function turnIntoSuper(view: EditorView, pos: number): void {
  const table = view.state.doc.nodeAt(pos)
  if (!isTable(table) || table.attrs.superTable === true || superRule(table) !== null) return
  view.dispatch(closeHistory(view.state.tr).setNodeAttribute(pos, 'superTable', true))
}

/** "Turn back into a plain table": `super`, every view and every `view` part kept as text go; the rows stay. One undo step. */
export function turnBackPlain(view: EditorView, pos: number): void {
  const table = view.state.doc.nodeAt(pos)
  if (!isTable(table)) return
  const attrs = table.attrs as TableAttrs
  const unknownParts = attrs.unknownParts.filter((part) => !/^(view|super)(\s|$)/.test(part.text))
  view.dispatch(closeHistory(view.state.tr).setNodeMarkup(pos, undefined, { ...attrs, superTable: false, views: [], unknownParts }))
}

/** A table's views, in one undo step. */
export function setViews(view: EditorView, pos: number, views: readonly TableViewDef[]): void {
  const table = view.state.doc.nodeAt(pos)
  if (!isTable(table) || JSON.stringify(table.attrs.views) === JSON.stringify(views)) return
  view.dispatch(closeHistory(view.state.tr).setNodeAttribute(pos, 'views', views))
}

/** A new table as Settings › Tables › New tables start as says (item 22): the slash menu's "Table" row. */
export function newTableNode(table: ProseNode): ProseNode {
  return storage.getSettings().tableNewStyle === 'super' ? table.type.create({ ...table.attrs, superTable: true }, table.content) : table
}

// ---------- where a table is ----------

/** The table around `pos` (its own position, node, and the row `pos` is in), or `null`. */
export function tableAround(doc: ProseNode, pos: number): { pos: number; node: ProseNode; row: number } | null {
  if (pos < 0 || pos > doc.content.size) return null
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (isTable(node)) return { pos: $pos.before(depth), node, row: $pos.index(depth) }
  }
  return null
}

/** The table's place among the note's tables, 0 first: the key of what this Mac remembers of it. */
export function tableIndexAt(doc: ProseNode, pos: number): number {
  let n = 0
  doc.nodesBetween(0, pos, (node) => {
    if (node.type.name !== 'table') return !node.isTextblock
    n++
    return false
  })
  return n
}

/** The header row's column keys (`columnKeys`): a merged header cell names its first column only. */
export function headerKeys(table: ProseNode): string[] {
  const map = TableMap.get(table)
  const texts: string[] = []
  for (let c = 0; c < map.width; c++) texts.push(cellStartsAt(map, 0, c) ? table.nodeAt(map.map[c]!)!.textContent : '')
  return columnKeys(texts)
}

// ---------- what this Mac remembers (outside the file) ----------

const memory = new Map<string, string[]>()

/** The key of one table's remembered list: `<note>::table:<index>::<what>`. */
const memoryKey = (place: SuperPlace | null, index: number, what: string): string => `${place?.notePath ?? ''}::table:${index}::${what}`

export function remembered(place: SuperPlace | null, index: number, what: string): string[] {
  const key = memoryKey(place, index, what)
  return place === null ? (memory.get(key) ?? []) : storage.getViewGroups(place.root, key)
}

export function remember(place: SuperPlace | null, index: number, what: string, list: readonly string[]): void {
  const key = memoryKey(place, index, what)
  if (place === null) {
    if (list.length === 0) memory.delete(key)
    else memory.set(key, [...list])
    // Without a note (a test, an editor with no file) the list is this session's, kept small.
    if (memory.size > 200) memory.delete(memory.keys().next().value!)
    return
  }
  storage.setViewGroups(place.root, key, list)
}

export const superPlace = (state: EditorState): SuperPlace | null => superKey.getState(state)?.place ?? null

// ---------- the active tab ----------

const hide = (pos: number, node: ProseNode, name: string): Decoration => Decoration.node(pos, pos + node.nodeSize, { class: SUPER_HIDDEN_CLASS }, { superView: name })

const hiddenAt = (set: DecorationSet, pos: number): Decoration[] => set.find(pos, pos + 1, (spec) => typeof spec.superView === 'string').filter((deco) => deco.from === pos)

/** The view the table at `pos` shows, or `null` for "Table". */
export function activeViewAt(state: EditorState, pos: number): string | null {
  const set = superKey.getState(state)?.hidden
  return set === undefined ? null : ((hiddenAt(set, pos)[0]?.spec.superView as string | undefined) ?? null)
}

/**
 * Show a view of the table at `pos`, or "Table" (`null`). No document change; this Mac remembers it. The caret leaves
 * a table that a view hides, so no key edits what you cannot see.
 */
export function setActiveTab(view: EditorView, pos: number, name: string | null): void {
  const table = view.state.doc.nodeAt(pos)
  if (!isTable(table)) return
  remember(superPlace(view.state), tableIndexAt(view.state.doc, pos), 'tab', name === null ? [] : [name])
  const tr = view.state.tr.setMeta(superKey, { pos, view: name } satisfies SuperMeta)
  const { from, to } = view.state.selection
  if (name !== null && from >= pos && to <= pos + table.nodeSize) tr.setSelection(Selection.near(tr.doc.resolve(pos + table.nodeSize), 1))
  view.dispatch(tr)
}

// ---------- the plugin ----------

/** The anchor before the table at `pos` (the zoom pill's widget), or `null`. */
function anchorAt(view: EditorView, pos: number): SuperAnchor | null {
  const anchor = view.nodeDOM(pos)?.previousSibling
  return anchor instanceof HTMLElement && anchor.classList.contains('table-zoom-anchor') ? (anchor as SuperAnchor) : null
}

const isSuper = (node: ProseNode): boolean => node.attrs.superTable === true

/** A view name the table still has. */
const hasView = (node: ProseNode, name: unknown): boolean => isSuper(node) && (node.attrs.views as TableViewDef[]).some((v) => v.name === name)

function initState(doc: ProseNode, place: SuperPlace | null): SuperState {
  const decorations: Decoration[] = []
  let index = 0
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return !node.isTextblock
    const [name] = isSuper(node) ? remembered(place, index, 'tab') : []
    if (name !== undefined && hasView(node, name)) decorations.push(hide(pos, node, name))
    index++
    return false
  })
  return { hidden: DecorationSet.create(doc, decorations), dirty: [], typing: false, generation: 0, place }
}

function applyState(tr: Transaction, prev: SuperState): SuperState {
  const meta = tr.getMeta(superKey) as SuperMeta | undefined
  if (!tr.docChanged && meta === undefined) return prev
  let hidden = tr.docChanged ? prev.hidden.map(tr.mapping, tr.doc) : prev.hidden
  const dirty = new Set<number>()
  const typing = tr.docChanged && typingOnly(tr)
  if (typing) {
    // A key: only the table around the step, when it is a Super table. Typing anywhere else marks nothing.
    tr.steps.forEach((step, i) => {
      const around = tableAround(tr.doc, tr.mapping.slice(i).map((step as unknown as { from: number }).from))
      if (around !== null && isSuper(around.node)) dirty.add(around.pos)
    })
  } else if (tr.docChanged) {
    for (const [pos, node] of changedTables(tr)) {
      if (isSuper(node)) dirty.add(pos)
      // Back to plain, or its view deleted or renamed: the table shows again.
      const stale = hiddenAt(hidden, pos).filter((deco) => !hasView(node, deco.spec.superView))
      if (stale.length > 0) hidden = hidden.remove(stale)
    }
  }
  if (meta !== undefined) {
    const node = tr.doc.nodeAt(meta.pos)
    hidden = hidden.remove(hiddenAt(hidden, meta.pos))
    if (isTable(node) && meta.view !== null && hasView(node, meta.view)) hidden = hidden.add(tr.doc, [hide(meta.pos, node, meta.view)])
    dirty.add(meta.pos)
  }
  if (dirty.size === 0) return { ...prev, hidden }
  return { hidden, dirty: [...dirty], typing, generation: prev.generation + 1, place: prev.place }
}

/** Each key that changed a Super table's header row renames that column in its views (item 15), in the same step. */
function renameHeaders(trs: readonly Transaction[], state: EditorState): Transaction | null {
  const renames = new Map<number, Array<[string[], string[]]>>()
  trs.forEach((tr, k) => {
    if (!tr.docChanged || !typingOnly(tr)) return
    tr.steps.forEach((step, i) => {
      const before = tableAround(tr.docs[i]!, (step as unknown as { from: number }).from)
      if (before === null || before.row !== 0 || !isSuper(before.node) || (before.node.attrs.views as TableViewDef[]).length === 0) return
      const at = tr.mapping.slice(i).map(before.pos)
      const after = (i + 1 < tr.steps.length ? tr.docs[i + 1]! : tr.doc).nodeAt(tr.mapping.slice(i, i + 1).map(before.pos))
      if (!isTable(after)) return
      let pos = at
      for (const later of trs.slice(k + 1)) pos = later.mapping.map(pos)
      const list = renames.get(pos) ?? []
      list.push([headerKeys(before.node), headerKeys(after)])
      renames.set(pos, list)
    })
  })
  let out: Transaction | null = null
  for (const [pos, list] of renames) {
    const table = state.doc.nodeAt(pos)
    if (!isTable(table)) continue
    let views = table.attrs.views as TableViewDef[]
    for (const [before, after] of list) views = renameColumns(views, before, after) ?? views
    if (views !== table.attrs.views) out = (out ?? state.tr).setNodeAttribute(pos, 'views', views)
  }
  return out
}

/** Register in the note editor only (`createCrepe`, with the zoom pill): `place` is the note, for what this Mac remembers. */
export const createSuperTables = (place: SuperPlace | null) =>
  $prose(
    () =>
      new Plugin<SuperState>({
        key: superKey,
        state: {
          init: (_, { doc }) => initState(doc, place),
          apply: applyState,
        },
        props: { decorations: (state) => superKey.getState(state)!.hidden },
        appendTransaction: (trs, _old, state) => renameHeaders(trs, state),
        view: () => ({
          update: (view, prev) => {
            const before = superKey.getState(prev)!
            const after = superKey.getState(view.state)!
            if (before.generation !== after.generation) for (const pos of after.dirty) anchorAt(view, pos)?.renderSuper?.(after.typing)
            // Find (item 25): a new current match in a table that shows a view.
            const match = findThreadAnchor(view.state)
            if (match === null || match === findThreadAnchor(prev)) return
            const around = tableAround(view.state.doc, match)
            if (around !== null && activeViewAt(view.state, around.pos) !== null) anchorAt(view, around.pos)?.findRow?.(around.row)
          },
        }),
      }),
  )
