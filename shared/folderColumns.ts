/**
 * A folder's columns (YAZ-1513, YAZ-1549): the pure rules the Properties menu, the table header menu and the
 * delete sheet use, shared with the CLI's folder column commands (YAZ-4518) so both make the same change.
 */
import type { IndexRecord, PropertyDecl, PropertyKind } from './types'
import { folderValues } from './folderValues'
import { reservedKeys } from './reservedKeys'
import { groupByLevels, type FilterNode, type ViewDef, type ViewSet } from './folderViews'

/** The ONE canonical spelling of a view property key (GRO-2135): `status` → `note.status`; `file.x` / `formula.x` / `note.x` unchanged. */
export function canonicalKey(key: string): string {
  return key.startsWith('file.') || key.startsWith('formula.') || key.startsWith('note.') ? key : `note.${key}`
}

/** Effective number of leading visible columns frozen for a Table view. */
export function frozenColumnCount(value: unknown, visibleColumns: number): number {
  const visible = Math.max(0, Math.trunc(visibleColumns))
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(visible, Math.max(0, Math.trunc(value)))
}

/**
 * THE one order writer (YAZ-1549): a view with `order` replaced, its `frozenColumns` following
 * POSITIONALLY (YAZ-1007) — the frozen prefix is a count over the shown columns, so a shorter order
 * clamps the count and an empty order deletes the key. Pure; the same object comes back when nothing
 * would change. Every place that assigns an order — the Properties checklist, reorder and bulk
 * buttons, "+ Add column", the table header's Hide / Add-to-the-right / drag, and a column delete —
 * spells it through here, so no view can hold an order its frozen prefix disagrees with.
 */
export function withOrder(view: ViewDef, order: string[]): ViewDef {
  const next: ViewDef = { ...view, order }
  if (next.frozenColumns !== undefined) {
    const count = frozenColumnCount(next.frozenColumns, order.length)
    if (count === 0) delete next.frozenColumns
    else next.frozenColumns = count
  }
  return next
}

/**
 * A declaration re-typed to `kind`, with the fields that belong to OTHER kinds dropped (YAZ-1549):
 * `options` / `optionSort` ride only on the choice kinds (a choice kind is born with an empty list),
 * `target` only on the link kinds. Every kind switch — "+ Add column" at save, the detail panel's
 * Type select, "Make relation" — goes through this one rule, so a target typed under Link can never
 * ride into a Text declaration and a Select's options never outlive the Select.
 */
export function declarationForKind(decl: Partial<PropertyDecl> | undefined, kind: PropertyKind): PropertyDecl {
  const next: PropertyDecl = { ...decl, kind }
  if (kind === 'select' || kind === 'multi-select') {
    if (next.options === undefined) next.options = []
  } else {
    delete next.options
    delete next.optionSort
  }
  if (kind !== 'link' && kind !== 'multi-link') delete next.target
  else if (next.target !== undefined && next.target.trim() === '') delete next.target
  return next
}

/**
 * Column labels on the def (YAZ-1513) — the ONE rule for where a `displayName` lives and how it
 * is set, shared by the Properties menu's pencil and the table header's "Rename column…". Edits are
 * `Mutate` bodies, so every rename is one `onChange` → one `folder_settings` write through the
 * folder host, optimistic like every other config edit.
 */

const bare = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key)

/** The `def.properties` entry a key's display name lives in: as written, bare, or `note.`-prefixed; else the bare form. */
function labelEntryKey(def: ViewSet, key: string): string {
  const b = bare(key)
  for (const k of [key, b, `note.${b}`]) if (def.properties?.[k] !== undefined) return k
  return b
}

/** The stored display name, or '' when the column wears its default label. */
export function displayNameOf(def: ViewSet, key: string): string {
  return def.properties?.[labelEntryKey(def, key)]?.displayName ?? ''
}

/**
 * Set — or, for a blank name, clear — one column's display name. An emptied entry and then an
 * emptied `properties` map delete themselves (the YAML default-deletes rule), so a column back on
 * its default label leaves no key behind. The KEY never changes; only what the header says.
 */
export function setDisplayName(d: ViewSet, key: string, name: string): void {
  const k = labelEntryKey(d, key)
  const props = d.properties ?? {}
  const entry = { ...props[k] }
  if (name.trim()) entry.displayName = name.trim()
  else delete entry.displayName
  if (Object.keys(entry).length) props[k] = entry
  else delete props[k]
  if (Object.keys(props).length) d.properties = props
  else delete d.properties
}

const bareOf = (key: string): string => canonicalKey(key).slice('note.'.length)

/** The tooltip a disabled "Delete column…" wears, or null when the key may go. */
export function undeletableReason(key: string): string | null {
  const c = canonicalKey(key)
  return !c.startsWith('note.') || reservedKeys(true).has(c.slice('note.'.length)) ? 'Built-in column — hide it instead' : null
}

/**
 * The indexed notes holding the field in the block of the folder with this id — the notes a
 * delete strips, and the confirm sheet's count. A folder with no id holds no values.
 */
export function notesHolding(records: readonly IndexRecord[], folderId: string | undefined, key: string): IndexRecord[] {
  const bare = bareOf(key)
  return records.filter((record) => Object.prototype.hasOwnProperty.call(folderValues(record.properties, folderId), bare))
}

/** Every `"…"` / `'…'` literal blanked (escapes honoured), so a key spelled INSIDE a string is not a reference. */
const withoutStringLiterals = (expr: string): string => expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')

/**
 * Does a filter expression name the column? The identifier `note.<key>` or the bare `<key>` as a
 * whole token, outside string literals — a tokenizer-free check: literals go first, then a
 * word-boundary match (YAZ-1549).
 */
export function filterMentions(expr: string, key: string): boolean {
  const bare = bareOf(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w.])(note\\.)?${bare}(?![\\w])`).test(withoutStringLiterals(expr))
}

/**
 * The filter minus every leaf that names the key: an emptied `and` / `or` / `not` node goes with
 * its last leaf, and `undefined` means the whole filter went. The same node comes back when
 * nothing under it changed.
 */
export function pruneFilter(node: FilterNode, key: string): FilterNode | undefined {
  if (typeof node === 'string') return filterMentions(node, key) ? undefined : node
  const [op, children] = Object.entries(node)[0] as ['and' | 'or' | 'not', FilterNode[]]
  const kept = children.map((child) => pruneFilter(child, key)).filter((child): child is FilterNode => child !== undefined)
  if (kept.length === 0) return undefined
  if (kept.length === children.length && kept.every((child, i) => child === children[i])) return node
  return { [op]: kept } as FilterNode
}

/** Every view minus every reference to the key; untouched views come back as the same object. */
export function pruneColumnFromViews(views: readonly ViewDef[], key: string): ViewDef[] {
  const c = canonicalKey(key)
  const names = (k: unknown): boolean => typeof k === 'string' && canonicalKey(k) === c
  return views.map((view) => {
    let changed = false
    let next: ViewDef = { ...view }
    if (Array.isArray(view.order)) {
      const order = view.order.filter((k) => !names(k))
      if (order.length !== view.order.length) {
        changed = true
        next = withOrder(next, order)
      }
    }
    if (Array.isArray(view.sort)) {
      const sort = view.sort.filter((s) => !names(s.property))
      if (sort.length !== view.sort.length) {
        changed = true
        if (sort.length === 0) delete next.sort
        else next.sort = sort
      }
    }
    if (view.groupBy !== undefined) {
      const levels = groupByLevels(view)
      const kept = levels.filter((g) => !names(g.property))
      if (kept.length !== levels.length) {
        changed = true
        if (kept.length === 0) delete next.groupBy
        else next.groupBy = Array.isArray(view.groupBy) ? kept : kept[0]
      }
    }
    if (names(view.image)) {
      changed = true
      delete next.image
    }
    if (view.filters !== undefined) {
      const filters = pruneFilter(view.filters, key)
      if (filters !== view.filters) {
        changed = true
        if (filters === undefined) delete next.filters
        else next.filters = filters
      }
    }
    for (const map of ['summaries', 'columnSize', 'cardStyle'] as const) {
      const entries = view[map]
      if (entries === undefined || entries === null || typeof entries !== 'object') continue
      const keptEntries = Object.fromEntries(Object.entries(entries).filter(([k]) => !names(k)))
      if (Object.keys(keptEntries).length === Object.keys(entries).length) continue
      changed = true
      if (Object.keys(keptEntries).length === 0) delete next[map]
      else (next as Record<string, unknown>)[map] = keptEntries
    }
    return changed ? next : view
  })
}

/** The labels minus the key's entry (any spelling); undefined once none are left, so the key deletes itself. */
export function pruneColumnLabel(properties: ViewSet['properties'], key: string): ViewSet['properties'] {
  if (properties === undefined) return undefined
  const c = canonicalKey(key)
  const kept = Object.fromEntries(Object.entries(properties).filter(([k]) => canonicalKey(k) !== c))
  return Object.keys(kept).length === 0 ? undefined : kept
}
