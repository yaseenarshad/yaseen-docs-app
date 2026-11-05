import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MAX_VAULT_NAME, cleanVaultName, type FocusFolder } from '@shared/types'
import { resolveItem, type FolderItem } from '../lists/focusFolders'
import { TextField } from '../views/view/TextField'
import { ContextMenu } from './ContextMenu'
import { FileIcon } from './FileIcon'

/** Two clicks on a name inside this gap rename it, as on a session (YAZ-3147, YAZ-4460 F3). */
const RENAME_CLICK_GAP_MS = 300

/** The stack glyph of a focus folder (YAZ-4460 F5): never a real folder's icon, so a drop on it never reads as a move on disk. */
const StackIcon = () => (
  <svg className="focus-folder__icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
    <path d="M8 2 2 5l6 3 6-3-6-3Z" />
    <path d="m2 8 6 3 6-3" />
    <path d="m2 11 6 3 6-3" />
  </svg>
)

interface FocusFolderListProps {
  folders: readonly FocusFolder[]
  roots: readonly string[]
  /** The rows of one folder's items that this window shows: the Focus tab's Tree, with the drag of the tab. */
  renderItems: (folder: FocusFolder, paths: string[]) => ReactNode
  /** The folder whose name field is open (a new one opens it at once, F3). */
  editing: string | null
  onEdit: (id: string | null) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  /** A click on a ghost (F6): App's "Add vault to this window" sheet. */
  onGhost: (vault: string, path: string) => void
  /** "Hide all others" (F8): the Focus tab shows this folder alone, always open. */
  onHideOthers: (id: string) => void
  /** The folder shown alone, if one is (F8). */
  only: string | null
}

/**
 * The focus folders on the Focus tab (YAZ-4460 F3, F5, F6, F7), above the top-level items: a fold row with the stack
 * glyph, the name and its count — two clicks on the name rename it, a right-click offers Rename and Delete — then,
 * unfolded, its items: the ones of a vault of the window as the tab's own rows, the others as grey ghosts that ask
 * to add their vault. A drop on a folder row puts the dragged item in it (`data-focus-folder`, read by the drag).
 * The folds live while the tab shows, as the Sessions tab's do.
 */
export function FocusFolderList({ folders, roots, renderItems, editing, onEdit, onRename, onDelete, onGhost, onHideOthers, only }: FocusFolderListProps) {
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set())
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const lastNameClick = useRef<{ id: string; at: number }>({ id: '', at: -Infinity })
  const toggle = (id: string) =>
    setShut((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const click = (e: MouseEvent, id: string) => {
    if ((e.target as Element).closest('.tree__label') !== null) {
      const at = performance.now()
      if (lastNameClick.current.id === id && at - lastNameClick.current.at <= RENAME_CLICK_GAP_MS) return onEdit(id)
      lastNameClick.current = { id, at }
    }
    toggle(id)
  }
  return (
    <>
      <ul className="tree focus-folders" aria-label="Focus folders">
        {folders.map((folder) => {
          const open = folder.id === only || !shut.has(folder.id)
          const resolved = folder.items.map((item) => ({ item, at: resolveItem(item, roots) }))
          const paths = resolved.flatMap((r) => ('path' in r.at ? [r.at.path] : []))
          const ghosts = resolved.filter((r): r is { item: FolderItem; at: { ghost: string } } => 'ghost' in r.at)
          return (
            <li key={folder.id}>
              {editing === folder.id ? (
                <div className="create-inline" style={{ paddingLeft: 8 }}>
                  <TextField className="create-inline__input" value={folder.name} aria-label="Focus folder name" autoFocus selectOnMount maxLength={MAX_VAULT_NAME} normalize={cleanVaultName} onCommit={(next) => onRename(folder.id, next)} onDone={() => onEdit(null)} />
                </div>
              ) : (
                <button type="button" className="tree__row focus-folder" data-focus-folder={folder.id} aria-expanded={open} onClick={(e) => click(e, folder.id)} onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, id: folder.id }))}>
                  <span className={`tree__chevron${open ? ' tree__chevron--open' : ''}`} />
                  <StackIcon />
                  <span className="tree__label">{folder.name}</span>
                  <span className="tree__count">{folder.items.length}</span>
                </button>
              )}
              {open && (
                <div className="focus-folder__items">
                  {paths.length > 0 && renderItems(folder, paths)}
                  {ghosts.length > 0 && (
                    <ul className="tree">
                      {ghosts.map(({ item, at }) => (
                        <li key={`${item.vault}/${item.path}`}>
                          <button type="button" className="tree__row tree__row--ghost" style={{ paddingLeft: 26 }} title={`In "${at.ghost}", which is not in this window`} onClick={() => onGhost(at.ghost, item.path)}>
                            <span className="tree__label">
                              <FileIcon path={item.path} />
                              {item.path.slice(item.path.lastIndexOf('/') + 1).replace(/\.md$/, '')}
                            </span>
                            <span className="tree__vault">{at.ghost}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {folder.items.length === 0 && <p className="sidebar__msg focus-folder__empty">Empty. Drag items here, or right-click a file → Add to focus ▸ {folder.name}.</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {menu !== null &&
        createPortal(
          <ContextMenu
            x={menu.x}
            y={menu.y}
            sections={[[{ id: 'focus-folder-rename', label: 'Rename', onSelect: () => onEdit(menu.id) }, ...(only === menu.id ? [] : [{ id: 'focus-folder-only', label: 'Hide all others', onSelect: () => onHideOthers(menu.id) }])], [{ id: 'focus-folder-delete', label: 'Delete focus folder', danger: true, onSelect: () => onDelete(menu.id) }]]}
            onClose={() => setMenu(null)}
          />,
          document.body,
        )}
    </>
  )
}
