import { type MouseEvent as ReactMouseEvent, useMemo, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import type { ViewSet, ViewDef } from '../viewSchema'
import { basenameCandidates, type LinkCandidate } from '../../links/completion'
import { belongsToBasenames } from '../../links/folderLinks'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { type Resolver, render } from '../expr'
import { cellEditor, columnTyping } from '../editorType'
import type { FolderSettings } from '../folderSettings'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './keys'
import { GroupHeader, cellContent, groupKeyOf, rowTitle } from './GroupHeader'
import { PageContextMenu } from './PageContextMenu'

export interface ListViewProps {
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
  onNotice?: (message: string) => void
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers. */
  onNewInGroup?: (group: Group) => void
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
export function ListView({ def, view, records, rows, groups, collapsed, onToggleGroup, onOpenFile, onOpenFileRight, onOpenFileBackground, onNotice, onNewInGroup, root, properties = null, settings, vaultRecords, vaultFolders, resolve, resolveLink, onWriteValue }: ListViewProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; title: string } | null>(null)
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
  const bareOf = (key: string) => (canonicalKey(key).startsWith('note.') ? canonicalKey(key).slice(5) : null)
  const typings = useMemo(
    () => new Map(keys.map((k) => [k, columnTyping(k, rowRecords, properties, settings)])),
    [keys, rowRecords, properties, settings],
  )
  /** What the pickers resolve and complete over: the WHOLE vault, never the folder's rows alone (🔒 D2). */
  const basenames = useMemo(() => basenameCandidates(vaultRecords), [vaultRecords])
  // Relation columns narrow the link picker to the notes in the FOLDER the target names
  // (YAZ-2290 D10: `belongsToBasenames`); a target naming no folder falls back to all basenames.
  const linkNames = useMemo(() => {
    const m = new Map<string, LinkCandidate[]>()
    for (const [key, t] of typings) if (t?.target !== undefined) m.set(key, belongsToBasenames(vaultRecords, vaultFolders, resolveLink, root, t.target))
    return m
  }, [typings, vaultRecords, vaultFolders, resolveLink, root])
  const editable = (row: Row, key: string) => {
    const bare = bareOf(key)
    if (bare === null) return cellContent(row.values[key], resolve)
    return (
      <EditableCell
        propKey={bare}
        raw={row.record.properties[bare]}
        value={row.values[key]}
        editor={cellEditor(row.record.properties[bare], typings.get(key) ?? null)}
                        options={typings.get(key)?.options}
        basenames={linkNames.get(key) ?? basenames}
        resolve={resolve}
        onCommit={(next) => onWriteValue(row.record.path, bare, next)}
      />
    )
  }

  const items = (shown: readonly Row[]) => (
    <ul className="view-list__items">
      {shown.map((row, i) => {
        const inline = indent ? '' : rest.map((k) => render(row.values[k], resolve)).filter((s) => s !== '').join(separator)
        return (
          <li key={row.record.path} className="view-list__item" onContextMenu={(event) => openMenu(event, row)}>
            {marker !== 'none' && (
              <span className="view-list__marker" aria-hidden>
                {marker === 'number' ? `${i + 1}.` : '•'}
              </span>
            )}
            <div className="view-list__body">
              <div className="view-list__line">
                {nameIsPrimary ? (
                  <button type="button" className="view-list__title" onClick={() => onOpenFile(row.record.path)}>
                    {rowTitle(row)}
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

  return (
    <div className="view-list">
      {groups === null
        ? items(rows)
        : groups.map((g) => {
            const gk = groupKeyOf(g.key)
            const isCollapsed = collapsed.includes(gk)
            return (
              <section key={gk} className="view-list__group">
                <GroupHeader
                  def={def}
                  view={view}
                  columns={keys}
                  groupKey={g.key}
                  rows={g.rows}
                  collapsed={isCollapsed}
                  onToggle={() => onToggleGroup(gk)}
                  onNew={onNewInGroup === undefined ? undefined : () => onNewInGroup(g)}
                  resolve={resolve}
                />
                {!isCollapsed && items(g.rows)}
              </section>
            )
          })}
      {menu !== null && <PageContextMenu {...menu} onOpenRight={onOpenFileRight} onOpenBackground={onOpenFileBackground} onNotice={onNotice} onClose={() => setMenu(null)} />}
    </div>
  )
}
