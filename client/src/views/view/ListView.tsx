import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, useMemo, useRef, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { type ViewSet, type ViewDef, groupIndentOf } from '../viewSchema'
import { type LinkCandidate } from '../../links/completion'
import { belongsToTitles, cellLinkCandidates } from '../../links/folderLinks'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { type Resolver, render } from '../expr'
import { cellEditor, columnTyping } from '../editorType'
import type { FolderSettings } from '../folderSettings'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './keys'
import { GroupHeader, rowCell, rowTitle } from './GroupHeader'
import { type GroupSpot, TOP_SPOT, childSpot, groupTakesNew, spotKey } from './groupDrag'
import { PageContextMenu } from './PageContextMenu'
import { openByKey } from '../../lib/openGesture'
import { type NoteWindowLink, currentItemClass, shownRows, useNoteWindowItems } from './NoteWindow'
import { NO_READ_ONLY, writableKey } from '../readOnlyRows'
import { ReadOnlyName } from './ReadOnlyMark'
import type { ViewHover } from './viewHover'

export interface ListViewProps {
  /** The folder's hover panel (YAZ-3403, `viewHover.ts`): `ViewsPane` always passes it; Settings › Preview on hover › Folder views starts or stops the dwell (YAZ-3743). */
  hover: ViewHover
  def: ViewSet
  view: ViewDef
  records: readonly IndexRecord[]
  /** The post-search rows — the one flat list when the view has no `groupBy`. */
  rows: readonly Row[]
  /** Post-search groups from ViewsPane (empty groups dropped); null when the view has no `groupBy`. */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this page + view; owned by ViewsPane, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onOpenFile: (path: string) => void
  /** The row's right-click menu (`PageContextMenu`): its two opens, and where a failed action says so. */
  onOpenFileRight?: (path: string) => void
  onOpenFileBackground?: (path: string) => void
  /** "Open in mini window ⇧↩" (D57) and ⇧Enter (YAZ-4605 D56) in the right-click menu (YAZ-4547 D24): ViewsPane's card; absent = no item. */
  onOpenWindow?: (path: string) => void
  /** The card's link: this view writes the order it shows and marks the card's note (D24). */
  windowLink?: NoteWindowLink
  onNotice?: (message: string) => void
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers. */
  onNewInGroup?: (group: Group, name?: string, at?: GroupSpot) => void
  /** Vault root, so the picker's resolver is THE one the wikilink surfaces share (YAZ-846). */
  root: string
  /** The vault's property declarations (5E, GRO-2217): vault-wide editor inference and relation targets. */
  properties?: PropertiesResponse | null
  /** The settings of the folder whose rows these are (YAZ-819): the typing ladder's TOP rung (🔒 Q8). */
  settings: FolderSettings
  /** The WHOLE index snapshot (🔒 D2, YAZ-819) — `records` is only the folder's rows: link resolution and the pickers read this. */
  vaultRecords: readonly IndexRecord[]
  /** The snapshot's folder settings records, for a link column narrowed to a folder. */
  vaultFolders: readonly IndexRecord[]
  /** ViewsPane's resolver: a cell reads an id link as the title of the note, or folder, it names (YAZ-2293 D8). */
  resolve: Resolver
  /** The window's link resolver, by which a link column's target names its folder. */
  resolveLink: ResolveLink
  /** A cell's commit: one value of one row, through the host's writer (`FolderHost.writeValues`). */
  onWriteValue: (path: string, key: string, value: unknown) => Promise<unknown>
  /** The read-only notes (YAZ-3076 D6): their cells open no editor and their cards do not move. Absent = none. */
  readOnly?: ReadonlySet<string>
}

export type MarkerStyle = 'bullet' | 'number' | 'none'

/** `view.markerStyle`, defaulted: bullet unless the file says number or none (the menu deletes the key for bullet). */
export const markerStyleOf = (view: ViewDef): MarkerStyle =>
  view.markerStyle === 'number' || view.markerStyle === 'none' ? view.markerStyle : 'bullet'

/** `view.propertySeparator` when it is a string, else Obsidian's documented default `, `. */
const separatorOf = (view: ViewDef): string => (typeof view.propertySeparator === 'string' ? view.propertySeparator : ', ')

/**
 * List view (4F, GRO-2140): `type: list` — Obsidian's schema — renders one item per record. The
 * FIRST property in `order` is the primary line (Obsidian: the primary list item is whatever
 * sits on top of the Properties menu): `file.name` renders as a link → `onOpenFile` — the
 * default when `order` is empty or absent — while any other first property renders its typed
 * value and file.name is NOT implicitly added. The remaining `order` properties render either
 * as indented label/value rows beneath the primary line (`indentProperties: true`) or inline
 * after it, `render()`ed, empties skipped, joined by `propertySeparator` (default `, `).
 * `markerStyle` bullet | number | none draws the item marker (default bullet; number is the
 * ordinal within its list — restarting per group). Grouped results render 4C sections (the
 * shared `GroupHeader` over each group's own list) with the SAME persisted collapse state as
 * the table/board/cards (never the page's card); search narrows items and drops empty groups.
 * The three config keys are edited in the Properties menu (list views only). The primary line
 * (when not file.name) and the indented property rows edit inline through `EditableCell`
 * (5B, GRO-2142); the joined inline string stays read-only.
 */
export function ListView({ def, view, records, rows, groups, collapsed, onToggleGroup, onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenWindow, windowLink, onNotice, onNewInGroup, root, properties = null, settings, vaultRecords, vaultFolders, resolve, resolveLink, onWriteValue, readOnly = NO_READ_ONLY, hover }: ListViewProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string } | null>(null)
  // The note window (YAZ-4547 D24): the order shown through the groups, once per rows, groups or collapse change.
  const windowOrder = useMemo(() => shownRows(groups, rows, collapsed), [groups, rows, collapsed])
  const rootRef = useRef<HTMLDivElement>(null)
  useNoteWindowItems(windowLink, windowOrder, rootRef)
  /** A typed editor keeps its own (native) menu, as in the table. */
  const openMenu = (event: ReactMouseEvent, row: Row): void => {
    if (event.target instanceof Element && event.target.closest('[data-editing]') !== null) return
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, path: row.record.path, title: row.record.title })
  }
  const keys = useMemo(() => propertyKeys(def, view, records, Object.keys(settings.columns)), [def, view, records, settings])
  const primary: string | undefined = keys[0]
  const rest = keys.slice(1)
  const nameIsPrimary = primary === undefined || canonicalKey(primary) === 'file.name'
  const marker = markerStyleOf(view)
  const indent = view.indentProperties === true
  const separator = separatorOf(view)
  // per-column halves of the editor inference (5B, GRO-2142), over the view's shown rows;
  // memoised so unrelated re-renders skip the per-column row walk (7B, GRO-2148)
  const rowRecords = useMemo(() => rows.map((r) => r.record), [rows])
  const bareOf = writableKey
  const typings = useMemo(
    () => new Map(keys.map((k) => [k, columnTyping(k, rowRecords, properties, settings)])),
    [keys, rowRecords, properties, settings],
  )
  /** What the pickers resolve and complete over: the WHOLE vault, never the folder's rows alone (🔒 D2). */
  // The note editor's `[[` rows, notes and folders (YAZ-4601 D49).
  const titles = useMemo(() => cellLinkCandidates(vaultRecords, vaultFolders, resolveLink, root), [vaultRecords, vaultFolders, resolveLink, root])
  // Relation columns narrow the link picker to the notes in the FOLDER the target names
  // (YAZ-2290 D10: `belongsToTitles`); a target naming no folder falls back to all titles.
  const linkNames = useMemo(() => {
    const m = new Map<string, LinkCandidate[]>()
    for (const [key, t] of typings) if (t?.target !== undefined) m.set(key, belongsToTitles(vaultRecords, vaultFolders, resolveLink, root, t.target))
    return m
  }, [typings, vaultRecords, vaultFolders, resolveLink, root])
  const editable = (row: Row, key: string) => {
    const bare = bareOf(key)
    if (bare === null) return rowCell(row, key, resolve)
    return (
      <EditableCell
        propKey={bare}
        raw={row.record.properties[bare]}
        value={row.values[key]}
        editor={cellEditor(row.record.properties[bare], typings.get(key) ?? null)}
                        options={typings.get(key)?.options}
        titles={linkNames.get(key) ?? titles}
        resolve={resolve}
        readOnly={readOnly.has(row.record.path)}
        onCommit={(next) => onWriteValue(row.record.path, bare, next)}
      />
    )
  }

  /** The title's Enter keys (YAZ-4605 D56), the table's: this tab, ⌘ a background tab, ⌥ the right panel, ⇧ the mini window. */
  const openTitleByKey = (e: ReactKeyboardEvent, path: string): void => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    openByKey(e, path, { onOpenFile, onOpenFileRight, onOpenFileBackground, onOpenWindow })
  }

  const items = (shown: readonly Row[]) => (
    <ul className="view-list__items">
      {shown.map((row, i) => {
        const inline = indent ? '' : rest.map((k) => render(row.values[k], resolve)).filter((s) => s !== '').join(separator)
        return (
          <li key={row.record.path} className={`view-list__item${currentItemClass(windowLink, row.record.path)}`} onContextMenu={(event) => openMenu(event, row)} {...hover.itemProps(row.record.path)}>
            {marker !== 'none' && (
              <span className="view-list__marker" aria-hidden>
                {marker === 'number' ? `${i + 1}.` : '•'}
              </span>
            )}
            <div className="view-list__body">
              <div className="view-list__line">
                {nameIsPrimary ? (
                  <button type="button" className="view-list__title" onClick={() => onOpenFile(row.record.path)} onKeyDown={(e) => openTitleByKey(e, row.record.path)}>
                    {readOnly.has(row.record.path) ? <ReadOnlyName>{rowTitle(row)}</ReadOnlyName> : rowTitle(row)}
                  </button>
                ) : (
                  <span className="view-list__primary">{editable(row, primary)}</span>
                )}
                {inline !== '' && <span className="view-list__inline">{inline}</span>}
              </div>
              {indent && rest.length > 0 && (
                <div className="view-list__props">
                  {rest.map((key) => (
                    <div key={key} className="view-list__prop">
                      <span className="view-list__prop-name">{propertyLabel(def, key)}</span>
                      <span className="view-list__prop-value">{editable(row, key)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )

  /**
   * One group's section. A nested group (YAZ-4531) shows the merge rule's direct rows, then each
   * child's section INSIDE its own, so a collapsed group folds its whole branch.
   */
  const section = (g: Group, at: GroupSpot): ReactNode => {
    const gk = spotKey(g, at)
    const isCollapsed = collapsed.includes(gk)
    return (
      <section key={gk} className="view-list__group">
        <GroupHeader
          def={def}
          view={view}
          columns={keys}
          groupKey={g.key}
          label={g.label}
          rows={g.rows}
          collapsed={isCollapsed}
          onToggle={() => onToggleGroup(gk)}
          // A level a new note cannot take (a `file.*` one) has no "+", as in Table and Board (YAZ-4544).
          onNew={onNewInGroup === undefined || !groupTakesNew(view, at.level) ? undefined : () => onNewInGroup(g, undefined, at)}
          resolve={resolve}
          level={at.level}
        />
        {!isCollapsed && (g.children === undefined ? items(g.rows) : (g.direct?.length ?? 0) > 0 && items(g.direct ?? []))}
        {!isCollapsed && g.children?.map((child) => section(child, childSpot(g, at)))}
      </section>
    )
  }

  return (
    <div ref={rootRef} className="view-list" style={{ '--view-group-indent': `${groupIndentOf(view)}px` } as CSSProperties}>
      {groups === null
        ? items(rows)
        : groups.map((g) => section(g, TOP_SPOT))}
      {menu !== null && <PageContextMenu {...menu} onOpenRight={onOpenFileRight} onOpenBackground={onOpenFileBackground} onOpenWindow={onOpenWindow} onNotice={onNotice} onClose={() => setMenu(null)} />}
    </div>
  )
}
