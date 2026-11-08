import { useMemo, useState } from 'react'
import type { FolderPagesSettings, IndexRecord, PropertiesResponse } from '@shared/types'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { defaultLabel, propertyLabel } from '../engine'
import { undeletableReason } from '../deleteColumn'
import type { ColumnTyping } from '../editorType'
import type { ColumnDecl } from '../folderSettings'
import { type Mutate, type ViewDef, type ViewSet, MAX_GROUP_LEVELS } from '../viewSchema'
import { useViewDefaults } from '../viewDefaults'
import type { FolderHost } from '../ViewsPane'
import { AddColumn } from './AddColumn'
import { ColumnDetail, columnKind, columnTypeLabel } from './ColumnDetail'
import { displayNameOf, setDisplayName } from './columnLabel'
import { setViewOrder, withOrder } from './columnOrder'
import { UNFROZE_COLUMNS, frozenColumnCount } from './frozenColumns'
import { groupAppend, groupLevels, groupOnly, groupRemoveLevel } from './groupLevels'
import { FlyoutItem, FlyoutParent, useFlyout } from '../../components/Flyout'
import { canonicalKey } from './keys'
import { TextField } from './TextField'
import { textInCellsOf } from './TableLookSettings'

export interface TableHeaderMenuProps {
  x: number
  y: number
  /** The right-clicked column, or null for the `#` gutter header. */
  columnKey: string | null
  def: ViewSet
  viewIndex: number
  /** The view's shown keys, in order — what a hide or an insert edits. */
  keys: readonly string[]
  /** Every key the folder already offers, declared columns included — "Add column" refuses a repeat. Asked only once the form opens. */
  takenKeys: () => readonly string[]
  /** The app's own keys in this vault: "Add column" refuses them (YAZ-4544). */
  reserved: ReadonlySet<string>
  /** The folder's rows: the type line infers an undeclared column's kind from them (YAZ-4533). */
  records: readonly IndexRecord[]
  /** The kind the table's cells wrap by (`wrapKind`), so the Text › ✓ and the cells read ONE source (YAZ-4544 4E). */
  wrapKind: string | null | undefined
  /** The vault's property declarations, the type line's and the editor's fallback. */
  properties: PropertiesResponse | null
  /** The host's AHEAD declarations — spread under a new one — and the doors "Edit column…" writes through (YAZ-4533). */
  folder: Pick<FolderHost, 'settings' | 'setColumn' | 'deleteColumn' | 'valueCount'>
  onUpdate: Mutate
  /** `FolderHost.setColumns`: declare on the folder AND show, one write. */
  declareColumn: (columns: Record<string, ColumnDecl>, views: ViewDef[]) => void
  /** "Delete column…" (YAZ-1513): hands the key to the table, which asks first (`ConfirmDeleteColumn`). Absent → no such item. */
  onDeleteColumn?: (key: string) => void
  onClose: () => void
}

/** `next` goes right after `after` in `keys` — or last, if `after` is not shown (it was just hidden, say). */
export function insertAfter(keys: readonly string[], after: string, next: string): string[] {
  const at = keys.findIndex((k) => canonicalKey(k) === canonicalKey(after))
  return at === -1 ? [...keys, next] : [...keys.slice(0, at + 1), next, ...keys.slice(at + 1)]
}

/** The kinds whose cells are chips (YAZ-4582 D29): what wrapped on `main`, so with no choice they wrap and the rest clip. */
const CHIP_KINDS: ReadonlySet<string> = new Set(['list', 'link', 'multi-link', 'select', 'multi-select'])

/** The kind a column wraps by (YAZ-4544 4E): its typing over the table's shown rows — the cells' and the menu's one source. */
export const wrapKind = (typing: ColumnTyping): string | null | undefined => typing?.assigned ?? typing?.dominant

/**
 * Does the column wrap (YAZ-4582 D29)? `columnWrap` under its key, in any spelling: `true` Wrap, `false` Clip.
 * With no entry, Settings › Folder pages › Text in cells (YAZ-4585): Wrap, Clip, or by its kind, the default: a chip
 * column wraps and a text, number or date column is one line, as on `main`.
 */
export function wrapsColumn(view: ViewDef, key: string, kind: string | null | undefined, textInCells: FolderPagesSettings['textInCells'] = 'kind'): boolean {
  const c = canonicalKey(key)
  const chosen = Object.entries(view.columnWrap ?? {}).find(([k, wrap]) => typeof wrap === 'boolean' && canonicalKey(k) === c)?.[1]
  return chosen ?? (textInCells === 'kind' ? kind != null && CHIP_KINDS.has(kind) : textInCells === 'wrap')
}

/**
 * The table header's context menu (YAZ-1513), on the row menu's own surface. Every write is the
 * Properties menu's: "Rename column…" is `setDisplayName` through `onUpdate` (an inline field
 * holding the stored display name, the default label as its placeholder — Enter commits, an emptied field goes back to the default,
 * Esc cancels); "Hide column" is `setViewOrder` without the key (a table may hide `file.name`,
 * YAZ-1007); "Add column to the right…" is the SAME "+ Add column" form, landing the new key
 * after this column instead of at the end; "Delete column…" (confirm-first, `views/deleteColumn.ts`)
 * is disabled with a tooltip for built-in keys. The `#` header offers only "Hide row numbers".
 * A grey "<Type> · <key>" line tops the column menu, and "Edit column…" opens `ColumnDetail` — the
 * Properties menu's own column editor — inside it (YAZ-4533). Freeze / ✓ Frozen / Unfreeze write the same
 * `frozenColumns` the Properties menu writes (YAZ-4534). Sort, Group and Text are flyouts (YAZ-4588 D42), each
 * ✓ on this column's state: Sort › writes `sort` (one rule on this column, or this column's rule removed),
 * Group › writes `groupBy` (`groupLevels.ts`), and Text › "Wrap text" / "Clip text" (YAZ-4582 D29) write
 * `columnWrap[<canonical key>]` (`true` Wrap, `false` Clip); the choice its kind (or Settings › Folder pages, YAZ-4585) makes anyway deletes the
 * entry in any spelling, and an empty map.
 */
export function TableHeaderMenu({ x, y, columnKey, def, viewIndex, keys, takenKeys, reserved, records, wrapKind, properties, folder, onUpdate, declareColumn, onDeleteColumn, onClose }: TableHeaderMenuProps) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'add' | 'edit'>('menu')
  const flyout = useFlyout<'sort' | 'group' | 'text'>()
  // The view's own Text in cells, else Settings' (YAZ-4544 10A).
  const textInCells = textInCellsOf(def.views[viewIndex], useViewDefaults())
  /** Once per menu, not per keystroke in its fields: the kind may walk the rows. */
  const typeLabel = useMemo(() => (columnKey === null ? '' : columnTypeLabel(columnKey, records, properties, folder.settings)), [columnKey, records, properties, folder.settings])
  const kind = useMemo(() => (columnKey === null ? null : columnKind(columnKey, records, properties, folder.settings)), [columnKey, records, properties, folder.settings])
  /** A Select or Multi-select column (YAZ-4544): its "Sort A to Z" sorts by value, not in option order (D1). */
  const hasOptions = kind === 'select' || kind === 'multi-select'
  const columns = folder.settings.columns

  if (columnKey === null) {
    return (
      <ContextMenuSurface x={x} y={y} onClose={onClose}>
        <button
          type="button"
          className="ctx-menu__item"
          role="menuitem"
          onClick={() => {
            onUpdate((d) => {
              d.views[viewIndex].rowNumbers = false
            })
            onClose()
          }}
        >
          Hide row numbers
        </button>
      </ContextMenuSurface>
    )
  }

  const key = columnKey
  const label = propertyLabel(def, key)
  const reason = undeletableReason(key)
  const c = canonicalKey(key)
  // A hide, an unfreeze and a level removed each offer Undo (YAZ-4594 S29).
  const hide = () => onUpdate((d) => setViewOrder(d, viewIndex, keys.filter((k) => canonicalKey(k) !== c)), `Hid ${label}`)
  const index = keys.findIndex((k) => canonicalKey(k) === c)
  const frozen = frozenColumnCount(def.views[viewIndex].frozenColumns, keys.length)
  /** One write, then the menu closes; `undo`, the toast of a gesture that takes something away (S29). */
  const write = (edit: (v: ViewDef) => void, undo?: string) => () => {
    onUpdate((d) => edit(d.views[viewIndex]), undo)
    onClose()
  }
  /**
   * One rule on this column replaces the sort (YAZ-4534). A to Z / Z to A on a Select column sort by value, as the
   * label says (YAZ-4544); its Option order / Reversed option order are the rule with no `by` (YAZ-4588 D42).
   */
  const sortBy = (direction: 'ASC' | 'DESC', byValue: boolean) => write((v) => {
      v.sort = [hasOptions && byValue ? { property: c, direction, by: 'value' } : { property: c, direction }]
    })
  const view = def.views[viewIndex]
  /** This column's sort rule, for the ✓: its order, as the Sort menu reads it (`DirectionPicker`). */
  const rule = view.sort?.find((s) => canonicalKey(s.property) === c)
  const ruleDirection = rule?.direction === 'DESC' ? 'DESC' : 'ASC'
  const ruleByValue = !hasOptions || rule?.by === 'value'
  const sortRow = (label: string, direction: 'ASC' | 'DESC', byValue: boolean) => (
    <FlyoutItem label={label} checked={rule !== undefined && ruleDirection === direction && ruleByValue === byValue} onSelect={sortBy(direction, byValue)} />
  )
  const levels = groupLevels(view)
  const levelKeys = levels.map((l) => canonicalKey(l.property))
  /** This column's level; Folder may be two, and "Remove" takes the deeper (YAZ-2541). */
  const ownLevel = levelKeys.lastIndexOf(c)
  const wrapped = wrapsColumn(def.views[viewIndex], key, wrapKind, textInCells)
  const setWrap = (wrap: boolean) =>
    write((v) => {
      const next = Object.fromEntries(Object.entries(v.columnWrap ?? {}).filter(([k]) => canonicalKey(k) !== c))
      if (wrap !== wrapsColumn({ ...v, columnWrap: undefined }, key, wrapKind, textInCells)) next[c] = wrap
      if (Object.keys(next).length) v.columnWrap = next
      else delete v.columnWrap
    })
  /** The last frozen column, or not (the table block's ✓ rule, YAZ-3696): a click on ✓ unfreezes. */
  const frozenHere = index >= 0 && frozen === index + 1

  return (
    <ContextMenuSurface x={x} y={y} onClose={onClose}>
      <div className="view-header-menu">
        {mode === 'edit' ? (
          <ColumnDetail
            columnKey={key}
            def={def}
            view={def.views[viewIndex]}
            viewIndex={viewIndex}
            records={records}
            onUpdate={onUpdate}
            properties={properties}
            folder={folder}
            shown={keys.some((k) => canonicalKey(k) === canonicalKey(key))}
            canHide
            onHide={hide}
            onBack={() => setMode('menu')}
            onLeave={onClose}
          />
        ) : mode === 'rename' ? (
          <TextField
            className="view-input view-header-menu__rename"
            aria-label={`Rename ${label}`}
            autoFocus
            value={displayNameOf(def, key)}
            placeholder={defaultLabel(key)}
            onCommit={(name) => onUpdate((d) => setDisplayName(d, key, name))}
            onDone={onClose}
          />
        ) : mode === 'add' ? (
          <AddColumn
            autoOpen
            taken={takenKeys()}
            shown={keys}
            reserved={reserved}
            onCancel={onClose}
            onShow={(existing) => {
              onUpdate((d) => setViewOrder(d, viewIndex, insertAfter(keys, key, existing)))
              onClose()
            }}
            onSave={(name, column) => {
              declareColumn(
                { ...columns, [name]: column },
                def.views.map((v, i) => (i === viewIndex ? withOrder(v, insertAfter(keys, key, `note.${name}`)) : v)),
              )
              onClose()
            }}
          />
        ) : (
          <>
            <div className="ctx-menu__heading" role="presentation">
              {typeLabel} · {canonicalKey(key)}
            </div>
            <div className="ctx-menu__group" onMouseEnter={() => flyout.hover(null)}>
              <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => setMode('edit')}>
                Edit column…
              </button>
              <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => setMode('rename')}>
                Rename column…
              </button>
              <button
                type="button"
                className="ctx-menu__item"
                role="menuitem"
                onClick={() => {
                  hide()
                  onClose()
                }}
              >
                Hide column
              </button>
              <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => setMode('add')}>
                Add column to the right…
              </button>
            </div>
            <div className="ctx-menu__group">
              <FlyoutParent label="Sort" open={flyout.open === 'sort'} onHover={() => flyout.hover('sort')} onOpen={() => flyout.openNow('sort')} onCloseFlyout={() => flyout.openNow(null)}>
                <div className="ctx-menu__group" role="group">
                  {sortRow('A to Z', 'ASC', true)}
                  {sortRow('Z to A', 'DESC', true)}
                  {hasOptions && sortRow('Option order', 'ASC', false)}
                  {hasOptions && sortRow('Reversed option order', 'DESC', false)}
                </div>
                {rule !== undefined && (
                  <div className="ctx-menu__group" role="group">
                    <FlyoutItem
                      label="Remove sort"
                      onSelect={write((v) => {
                        const rest = (v.sort ?? []).filter((s) => canonicalKey(s.property) !== c)
                        if (rest.length) v.sort = rest
                        else delete v.sort
                      })}
                    />
                  </div>
                )}
              </FlyoutParent>
              <FlyoutParent label="Group" open={flyout.open === 'group'} onHover={() => flyout.hover('group')} onOpen={() => flyout.openNow('group')} onCloseFlyout={() => flyout.openNow(null)}>
                <div className="ctx-menu__group" role="group">
                  <FlyoutItem label="Group by this column" onSelect={write((v) => groupOnly(v, key))} />
                  {/* Hidden when this column is a level; Folder may group twice (YAZ-2541). Hidden with nothing grouped, where it is "Group by this column" (YAZ-4544 4F, D42). */}
                  {levels.length > 0 && (ownLevel === -1 || c === 'file.folder') && (
                    <FlyoutItem
                      label="Add as next group level"
                      disabled={levels.length >= MAX_GROUP_LEVELS}
                      tip={levels.length >= MAX_GROUP_LEVELS ? 'Three levels at most' : undefined}
                      onSelect={write((v) => groupAppend(v, key))}
                    />
                  )}
                </div>
                {levels.length > 0 && (
                  <div className="ctx-menu__group" role="group">
                    <div className="ctx-menu__heading" role="presentation">
                      Levels
                    </div>
                    {levels.map((l, i) => (
                      <div key={i} className="ctx-menu__item view-header-menu__level" role="presentation" data-hint={levelKeys[i] === c ? '✓' : undefined}>
                        {propertyLabel(def, l.property)}
                      </div>
                    ))}
                  </div>
                )}
                {ownLevel !== -1 && (
                  <div className="ctx-menu__group" role="group">
                    <FlyoutItem label="Remove this group level" onSelect={write((v) => groupRemoveLevel(v, ownLevel), `Removed group level ${label}`)} />
                  </div>
                )}
              </FlyoutParent>
              <FlyoutParent label="Text" open={flyout.open === 'text'} onHover={() => flyout.hover('text')} onOpen={() => flyout.openNow('text')} onCloseFlyout={() => flyout.openNow(null)}>
                <div className="ctx-menu__group" role="group">
                  <FlyoutItem label="Wrap text" checked={wrapped} onSelect={setWrap(true)} />
                  <FlyoutItem label="Clip text" checked={!wrapped} onSelect={setWrap(false)} />
                </div>
              </FlyoutParent>
            </div>
            <div className="ctx-menu__group" onMouseEnter={() => flyout.hover(null)}>
              <button
                type="button"
                className="ctx-menu__item"
                role="menuitem"
                onClick={write((v) => {
                  if (frozenHere) delete v.frozenColumns
                  else v.frozenColumns = index + 1
                }, frozenHere ? UNFROZE_COLUMNS : undefined)}
              >
                {frozenHere ? '✓ Frozen up to this column' : 'Freeze up to this column'}
              </button>
              <button
                type="button"
                className="ctx-menu__item"
                role="menuitem"
                disabled={frozen === 0}
                onClick={write((v) => {
                  delete v.frozenColumns
                }, UNFROZE_COLUMNS)}
              >
                Unfreeze columns
              </button>
            </div>
            {onDeleteColumn && (
              <div className="ctx-menu__group" onMouseEnter={() => flyout.hover(null)}>
                <button
                  type="button"
                  className="ctx-menu__item ctx-menu__item--danger"
                  role="menuitem"
                  disabled={reason !== null}
                  title={reason ?? undefined}
                  onClick={() => {
                    onDeleteColumn(key)
                    onClose()
                  }}
                >
                  Delete column…
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </ContextMenuSurface>
  )
}
