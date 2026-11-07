import { useMemo, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { defaultLabel, propertyLabel } from '../engine'
import { undeletableReason } from '../deleteColumn'
import type { ColumnDecl } from '../folderSettings'
import type { Mutate, ViewDef, ViewSet } from '../viewSchema'
import type { FolderHost } from '../ViewsPane'
import { AddColumn } from './AddColumn'
import { ColumnDetail, columnTypeLabel } from './ColumnDetail'
import { displayNameOf, setDisplayName } from './columnLabel'
import { setViewOrder, withOrder } from './columnOrder'
import { canonicalKey } from './keys'
import { TextField } from './TextField'

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
  /** The folder's rows: the type line infers an undeclared column's kind from them (YAZ-4533). */
  records: readonly IndexRecord[]
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

/**
 * The table header's context menu (YAZ-1513), on the row menu's own surface. Every write is the
 * Properties menu's: "Rename column…" is `setDisplayName` through `onUpdate` (an inline field
 * holding the stored display name, the default label as its placeholder — Enter commits, an emptied field goes back to the default,
 * Esc cancels); "Hide column" is `setViewOrder` without the key (a table may hide `file.name`,
 * YAZ-1007); "Add column to the right…" is the SAME "+ Add column" form, landing the new key
 * after this column instead of at the end; "Delete column…" (confirm-first, `views/deleteColumn.ts`)
 * is disabled with a tooltip for built-in keys. The `#` header offers only "Hide row numbers".
 * A grey "<Type> · <key>" line tops the column menu, and "Edit column…" opens `ColumnDetail` — the
 * Properties menu's own column editor — inside it (YAZ-4533).
 */
export function TableHeaderMenu({ x, y, columnKey, def, viewIndex, keys, takenKeys, records, properties, folder, onUpdate, declareColumn, onDeleteColumn, onClose }: TableHeaderMenuProps) {
  const [mode, setMode] = useState<'menu' | 'rename' | 'add' | 'edit'>('menu')
  /** Once per menu, not per keystroke in its fields: the kind may walk the rows. */
  const typeLabel = useMemo(() => (columnKey === null ? '' : columnTypeLabel(columnKey, records, properties, folder.settings)), [columnKey, records, properties, folder.settings])
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
  const hide = () => onUpdate((d) => setViewOrder(d, viewIndex, keys.filter((k) => canonicalKey(k) !== canonicalKey(key))))

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
            onCancel={onClose}
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
            {onDeleteColumn && (
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
            )}
          </>
        )}
      </div>
    </ContextMenuSurface>
  )
}
