import { useCallback, useState } from 'react'
import type { BaseView } from '../baseFile'
import { ViewTypeIcon } from './icons'
import { Popover } from './Popover'
import { TextField } from './TextField'

export interface ViewTabsProps {
  views: BaseView[]
  active: number
  onSelect: (index: number) => void
  onAdd: () => void
  onRename: (index: number, name: string) => void
  onDuplicate: (index: number) => void
  onDelete: (index: number) => void
  onMove: (index: number, dir: -1 | 1) => void
  /** Embed chrome (6A, GRO-2145): switching only — no "+", no "…" menu, no rename. */
  readOnly?: boolean
}

/** View switcher (GRO-2135): one tab per view, "+" adds, the active tab's "…" / right-click opens the view menu. */
export function ViewTabs({ views, active, onSelect, onAdd, onRename, onDuplicate, onDelete, onMove, readOnly = false }: ViewTabsProps) {
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const closeMenu = useCallback(() => setMenuFor(null), [])

  const item = (label: string, disabled: boolean, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="base-popover__item"
      disabled={disabled}
      onClick={() => {
        setMenuFor(null)
        run()
      }}
    >
      {label}
    </button>
  )

  return (
    <div className="base-tabs" role="tablist">
      {views.map((v, i) => {
        const isActive = i === active
        return (
          <div key={i} className={`base-tab${isActive ? ' base-tab--active' : ''}`}>
            {renaming === i ? (
              <TextField
                className="base-tab__rename"
                aria-label="View name"
                autoFocus
                value={v.name}
                onCommit={(name) => {
                  if (name.trim()) onRename(i, name.trim())
                }}
                onDone={() => setRenaming(null)}
              />
            ) : (
              <button
                type="button"
                role="tab"
                className="base-tab__btn"
                aria-selected={isActive}
                onClick={() => onSelect(i)}
                onContextMenu={(e) => {
                  if (readOnly) return
                  e.preventDefault()
                  onSelect(i)
                  setMenuFor(i)
                }}
              >
                <ViewTypeIcon type={v.type} />
                <span>{v.name}</span>
              </button>
            )}
            {isActive && renaming !== i && !readOnly && (
              <button
                type="button"
                className="base-tab__more"
                aria-label="View menu"
                title="View menu"
                aria-haspopup="menu"
                aria-expanded={menuFor === i}
                onClick={() => setMenuFor(menuFor === i ? null : i)}
              >
                …
              </button>
            )}
            {menuFor === i && (
              <Popover label="View menu" className="base-popover--menu" onClose={closeMenu}>
                <div role="menu">
                  {item('Rename', false, () => setRenaming(i))}
                  {item('Duplicate', false, () => onDuplicate(i))}
                  {item('Delete', views.length <= 1, () => onDelete(i))}
                  {item('Move left', i === 0, () => onMove(i, -1))}
                  {item('Move right', i === views.length - 1, () => onMove(i, 1))}
                </div>
              </Popover>
            )}
          </div>
        )
      })}
      {!readOnly && (
        <button type="button" className="base-tab__add" aria-label="Add view" title="Add view" onClick={onAdd}>
          +
        </button>
      )}
    </div>
  )
}
