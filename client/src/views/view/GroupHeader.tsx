import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { isShortcut } from '../../links/shortcuts'
import { HIGHLIGHT_HEX } from '../../editor/marks/highlightColours'
import { type ViewSet, type ViewDef, type GroupBySpec, shownGroupLevels } from '../viewSchema'
import { type Row, propertyLabel } from '../engine'
import { ErrorValue, FileValue, LinkValue, type Resolver, type Value, linkText, render } from '../expr'
import { summarize } from '../summaries'
import { ShortcutIcon } from './icons'
import { canonicalKey } from './keys'

/**
 * One group's header content (4C, GRO-2137), shared by Table today and Cards / List / Board
 * later: chevron collapse toggle, the group value rendered by type, count, and the per-group
 * summaries (recomputed over the group's SHOWN rows, like the table's total row in 4B).
 */

/**
 * Stable string identity for one group, the key persisted in the app state's `baseGroups`:
 * `∅` for the trailing "No value" group, `v:<render(key)>` otherwise (the prefix keeps any
 * rendered value from colliding with the sentinel). Deterministic across sessions — and `render`
 * with NO resolver on purpose (YAZ-2293 D8): the key is the link as STORED, `v:[[<id>]]`, so
 * renaming the note a group is headed by never reopens the group.
 */
export const groupKeyOf = (key: Value | null): string => (key === null ? '∅' : `v:${render(key)}`)

/**
 * The same identity at ANY level (YAZ-745, YAZ-4531): the `groupKeyOf` of each ancestor, outer
 * first, then the group's own, joined by U+001F — so the same value under two parents collapses
 * independently, a top-level key is plain `groupKeyOf`, and an inner key stored when there were
 * two levels (outer, U+001F, inner) still names its group. It is persisted in `baseGroups`, so the
 * encoding is a contract.
 */
export const groupPathKeyOf = (keys: readonly (Value | null)[]): string => keys.map(groupKeyOf).join('\u001f')

/** The stored summary kind for a column, whichever key form (`priority` / `note.priority`) the file uses. */
export function summaryKindOf(view: ViewDef, key: string): string | undefined {
  const s = view.summaries
  if (s === undefined) return undefined
  const k = Object.keys(s).find((x) => canonicalKey(x) === canonicalKey(key))
  return k !== undefined && typeof s[k] === 'string' ? s[k] : undefined
}

/** One value inside a list / link cell (shared with TableView's cells); through `resolve`, an id link reads as its note's title (`linkText`, YAZ-2293 D8). */
export function chip(v: Value, key?: number, resolve?: Resolver) {
  const link = v instanceof LinkValue || v instanceof FileValue
  const text = v instanceof LinkValue ? linkText(v, resolve) : v instanceof FileValue ? v.record.title : render(v, resolve)
  return (
    <span key={key} className={`view-table__chip${link ? ' view-table__chip--link' : ''}`} title={text}>
      {text}
    </span>
  )
}

/**
 * The page's TITLE wherever a skin shows its `file.name` column (YAZ-1513/1549): the record's
 * `title` (YAZ-2420 🔒 D14), never the file name — one spelling for the table's name cell, the
 * board's card title, the card's title and the list's primary. `file.name`'s VALUE is the title
 * too (🔒 D18), so the column sorts and filters by what it shows. A row that is in the folder
 * by a SHORTCUT (YAZ-2290 D2) wears the mark after it — here, so every skin marks it alike.
 */
export const rowTitle = (row: Row): ReactNode => <RowTitle row={row} />

/** The folder whose rows the skins are drawing, as the index names it; null (no folder host) marks nothing. */
export const ViewFolder = createContext<string | null>(null)

/**
 * The page's folders for the Folder column and the Folder group headers (YAZ-4564 D26/D27), from `ViewsPane`:
 * the page's folder as the index names it, a folder's title as its Folder group is headed, and the door that
 * opens a folder's page in a new tab (absent: nothing opens). Null outside a folder page.
 */
export interface FolderPagesValue {
  folder: string
  title: (dir: string) => string
  open?: (dir: string) => void
}
export const FolderPages = createContext<FolderPagesValue | null>(null)

/** The `file.folder` column (YAZ-4564 D26): every view draws its cell here, the rest through `cellContent`. */
export const rowCell = (row: Row, key: string, resolve?: Resolver): ReactNode =>
  canonicalKey(key) === 'file.folder' ? <FolderCell row={row} value={row.values[key]} resolve={resolve} /> : cellContent(row.values[key], resolve)

/**
 * Empty for a note directly in the page's folder; else the chip of the folder the note lives in, by the title
 * its Folder group shows. A click opens that folder's page; the vault root has no page, so its chip opens nothing.
 */
function FolderCell({ row, value, resolve }: { row: Row; value: Value; resolve?: Resolver }) {
  const pages = useContext(FolderPages)
  if (pages === null) return <>{cellContent(value, resolve)}</>
  const dir = row.record.folder
  if (dir === pages.folder) return null
  const title = pages.title(dir)
  const open = pages.open
  if (open === undefined || dir === '') return <span className="view-table__chip" title={title}>{title}</span>
  return (
    <button
      type="button"
      className="view-table__chip view-table__chip--link view-folder-chip"
      title={title}
      onClick={(e) => {
        e.stopPropagation() // a board card's click opens the card
        open(dir)
      }}
    >
      {title}
    </button>
  )
}

function RowTitle({ row }: { row: Row }) {
  const folder = useContext(ViewFolder)
  return (
    <>
      {row.record.title}
      {folder !== null && isShortcut(row.record, folder) && <ShortcutIcon />}
    </>
  )
}

/** Typed cell body (shared by table cells and board cards): error chip, read-only checkbox (editing is 5B), chips for lists/links, `render()` for the rest. */
export function cellContent(v: Value, resolve?: Resolver) {
  if (v instanceof ErrorValue)
    return (
      <span className="view-table__chip view-table__chip--error" title={v.message}>
        #ERROR
      </span>
    )
  if (typeof v === 'boolean') return <input type="checkbox" checked={v} disabled readOnly />
  if (Array.isArray(v)) return v.map((item, i) => chip(item, i, resolve))
  if (v instanceof LinkValue || v instanceof FileValue) return chip(v, undefined, resolve)
  return render(v, resolve)
}

/** The group value by type: chips for lists and links/files, `render()` for the rest. */
function groupValue(v: Value, resolve?: Resolver) {
  if (Array.isArray(v)) return v.map((item, i) => chip(item, i, resolve))
  if (v instanceof LinkValue || v instanceof FileValue) return chip(v, undefined, resolve)
  return render(v, resolve)
}

type Colour = keyof typeof HIGHLIGHT_HEX

/**
 * A group level's header look (YAZ-3742 D5): its `highlight` as a wash of that highlight colour
 * (`--view-group-hl`, painted at 40% by views.css) and `large` as 14px bold. An unknown colour name
 * paints nothing. The Sort menu's "Aa" chip wears the same look under its own `base` class, so a
 * query for the headers' values never finds the chip.
 */
export function groupValueLook(spec: GroupBySpec | undefined, base = 'view-group__value'): { className: string; style?: CSSProperties } {
  const hex = typeof spec?.highlight === 'string' && Object.hasOwn(HIGHLIGHT_HEX, spec.highlight) ? HIGHLIGHT_HEX[spec.highlight as Colour] : undefined
  const className = [base, hex !== undefined && `${base}--highlight`, spec?.large === true && `${base}--large`].filter(Boolean).join(' ')
  return hex === undefined ? { className } : { className, style: { '--view-group-hl': hex } as CSSProperties }
}

export interface GroupHeaderProps {
  def: ViewSet
  view: ViewDef
  /** The host view's column keys (`propertyKeys`); one summary renders per summarised column, in this order. */
  columns: readonly string[]
  /** The engine group's key; null = the "No value" group. */
  groupKey: Value | null
  /** What the engine calls the group (`Group.label`): a Folder group's is its folder's title (YAZ-2541), which its key, the path, does not say. */
  label: string
  /** The group's SHOWN (post-search) rows: the count and summaries are computed over exactly these. */
  rows: readonly Row[]
  collapsed: boolean
  onToggle: () => void
  /** Create a note in this group (5D, GRO-2144); absent → no "+" affordance. */
  onNew?: () => void
  /** The vault's resolver: a group keyed by an id link is headed by that note's title (YAZ-2293 D8). */
  resolve?: Resolver
  /** The group's `groupBy` level, outer = 0 (the default): its spec gives the header's style (YAZ-3742). */
  level?: number
}

export function GroupHeader({ def, view, columns, groupKey, label, rows, collapsed, onToggle, onNew, resolve, level = 0 }: GroupHeaderProps) {
  // `level` counts the levels that group (YAZ-4544): an entry with no property is none.
  const look = groupValueLook(shownGroupLevels(view)[level])
  // A Folder level's group (YAZ-4564 D27) opens that folder's page; the page's own folder and the vault root have none.
  const pages = useContext(FolderPages)
  const open = pages?.open
  const openFolder =
    open !== undefined && typeof groupKey === 'string' && groupKey !== '' && groupKey !== pages?.folder && shownGroupLevels(view)[level]?.property === 'file.folder'
      ? () => open(groupKey)
      : undefined
  return (
    <div className="view-group">
      <button type="button" className="view-group__toggle" aria-expanded={!collapsed} aria-label={`Toggle group ${label}`} onClick={onToggle}>
        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {/* A text name too long for the header is cut; the tooltip holds the rest, as a chip's does. */}
      <span className={`${look.className}${groupKey === null ? ' view-group__value--none' : ''}`} style={look.style} title={typeof groupKey === 'string' ? label : undefined}>
        {typeof groupKey === 'string' ? label : groupKey === null ? 'No value' : groupValue(groupKey, resolve)}
      </span>
      <span className="view-group__count">{rows.length}</span>
      {openFolder !== undefined && (
        <button type="button" className="view-group__open" aria-label={`Open folder page ${label}`} title="Open folder page" onClick={openFolder}>
          ↗
        </button>
      )}
      {onNew !== undefined && (
        <button type="button" className="view-group__new" aria-label={`New note in group ${label}`} title="New note" onClick={onNew}>
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      )}
      {columns.map((key) => {
        const kind = summaryKindOf(view, key)
        if (kind === undefined) return null
        return (
          <span key={key} className="view-group__summary" title={`${propertyLabel(def, key)} ${kind}`}>
            <span className="view-group__summary-kind">{kind}</span>
            {render(summarize(kind, rows.map((r) => r.values[key]), def.summaries), resolve)}
          </span>
        )
      })}
    </div>
  )
}
