import { useAutomationSurface } from '../automation/surfaces'
import { useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MAX_VAULT_NAME, cleanVaultName, type FocusFolder } from '@shared/types'
import { resolveItem, type FolderItem } from '../lists/focusFolders'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { TextField } from '../views/view/TextField'
import { ContextMenu } from './ContextMenu'
import { LIFT_PX } from './hooks/rowGestures'
import { rowArrows } from './Tree'
import { scopeGroup } from './menuSections'

/** Two clicks on a name inside this gap rename it, as on a session (YAZ-3147, YAZ-4460 F3). */
const RENAME_CLICK_GAP_MS = 300

/** A ghost, one stroke in the text color (YAZ-4460 demo): it reads in light and dark as the tree's other glyphs do. */
const GhostIcon = () => (
  <svg className="tree__ghost-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
    <path d="M3 14V7a5 5 0 0 1 10 0v7l-1.7-1.3L9.6 14 8 12.7 6.4 14l-1.7-1.3L3 14Z" />
    <circle cx="6.2" cy="7.2" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="9.8" cy="7.2" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)

/** The stack glyph of a focus folder (YAZ-4460 F5): never a real folder's icon, so a drop on it never reads as a move on disk. */
const StackIcon = () => (
  <svg className="focus-folder__icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
    <path d="M8 2 2 5l6 3 6-3-6-3Z" />
    <path d="m2 8 6 3 6-3" />
    <path d="m2 11 6 3 6-3" />
  </svg>
)

/** The folders folded shut, for each tab, for the session (YAZ-4470, 9): out here, so a tab switch's unmount keeps them. */
const SHUT: Record<'focus' | 'favorites', ReadonlySet<string>> = { focus: new Set(), favorites: new Set() }

interface FocusFolderListProps {
  /** Whose folders: the Focus tab's, or the Favorites tab's (YAZ-4460 demo) — the words differ, nothing else. */
  kind: 'focus' | 'favorites'
  folders: readonly FocusFolder[]
  roots: readonly string[]
  /** The rows of one folder's items that this window shows: the Focus tab's Tree, with the drag of the tab. */
  renderItems: (folder: FocusFolder, paths: string[]) => ReactNode
  /** The folder whose name field is open (a new one opens it at once, F3). */
  editing: string | null
  onEdit: (id: string | null) => void
  onRename: (id: string, name: string) => void
  /** `keep`: its items go to the top level; else they leave the list with the folder. */
  onDelete: (id: string, keep: boolean) => void
  /** A click on a ghost (F6): App's "Add vault to this window" sheet. */
  onGhost: (vault: string, path: string) => void
  /** "Hide all others" (F8): the Focus tab shows this folder alone, always open. */
  onHideOthers: (id: string) => void
  /** The folder shown alone, if one is (F8). */
  only: string | null
  /** Where a folder shows, and the door of its "Show it in ▸ Workspace / Vault" rows (YAZ-4460 demo). */
  scopesOf: (id: string) => { vault: boolean; workspace: boolean }
  onSetScope: (id: string, scope: 'workspace' | 'vault', on: boolean) => void
  /**
   * "Open all in tabs" (YAZ-4470, 17): the folder's items this window shows and the disk holds, each in a tab of its
   * own — a folder as its folder page, as "Open N in new tabs" opens one (YAZ-2290 D3); none, no item.
   */
  openableOf: (paths: string[]) => string[]
  onOpenAll: (paths: string[]) => void
  /** A folder row dragged above or below another (YAZ-4470, 13): the folders' ids in their new order. */
  onReorderFolders: (ids: string[]) => void
  /** The scope this tab shows: its check, off, takes the folder off the screen, so a box asks first. */
  scope: 'workspace' | 'vault'
}

/**
 * The focus folders on the Focus tab (YAZ-4460 F3, F5, F6, F7), above the top-level items: a fold row with the stack
 * glyph and the name, no count (YAZ-4470, 10) — two clicks on the name rename it, a right-click opens its menu — then,
 * unfolded, its items: the ones of a vault of the window as the tab's own rows, the others as grey ghosts that ask
 * to add their vault. A drop on a folder row puts the dragged item in it (`data-focus-folder`, read by the drag).
 * The folds last the session (YAZ-4470, 9): a tab switch keeps them, a relaunch opens every folder again.
 */
export function FocusFolderList({ kind, folders, roots, renderItems, editing, onEdit, onRename, onDelete, onGhost, onHideOthers, only, scopesOf, onSetScope, scope, openableOf, onOpenAll, onReorderFolders }: FocusFolderListProps) {
  const [shut, setShutHere] = useState<ReadonlySet<string>>(() => SHUT[kind])
  const setShut = (next: (was: ReadonlySet<string>) => ReadonlySet<string>) =>
    setShutHere((was) => {
      SHUT[kind] = next(was)
      return SHUT[kind]
    })
  // CLI navigation (YAZ-4502): open the named group, and each group that holds the target.
  useAutomationSurface(`groups:${kind}`, {
    ready: true,
    inspect: () => ({ open: folders.filter((folder) => !shut.has(folder.id)).map((folder) => folder.id) }),
    reveal: (target) => setShut((previous) => {
      const next = new Set(previous)
      for (const folder of folders) {
        const contains = target.path !== undefined && folder.items.some((item) => {
          const resolved = resolveItem(item, roots)
          return 'path' in resolved && (target.path === resolved.path || target.path!.startsWith(`${resolved.path}/`))
        })
        if (folder.id === target.group || contains) next.delete(folder.id)
      }
      return next
    }),
  })
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  // "Delete focus folder" asks first (YAZ-4460 demo): two clicks, as "Delete session".
  const [deleting, setDeleting] = useState<FocusFolder | null>(null)
  // "Show it in": the shown list's check off, while the other list holds the folder — it moves there; a box asks first.
  const [moving, setMoving] = useState<FocusFolder | null>(null)
  const other = scope === 'workspace' ? 'vault' : 'workspace'
  const leave = (id: string) => {
    const f = folders.find((x) => x.id === id) ?? null
    // In no other list, off here is the folder's end: the Delete box.
    if (scopesOf(id)[other]) setMoving(f)
    else setDeleting(f)
  }
  // The drag of a folder row (YAZ-4470, 13): it lifts after LIFT_PX, a line shows where it lands, the release moves it,
  // and Esc or a release off the folders moves nothing. The click that ends a drag does not fold the row.
  const [dropAt, setDropAt] = useState<{ id: string; edge: 'before' | 'after' } | null>(null)
  const dragged = useRef(false)
  const pressFolder = (e: MouseEvent, id: string) => {
    if (e.button !== 0 || folders.length < 2) return
    const y0 = e.clientY
    let lifted = false
    let at: { id: string; edge: 'before' | 'after' } | null = null
    const over = (ev: globalThis.MouseEvent) => {
      const row = ev.target instanceof Element ? ev.target.closest<HTMLElement>('[data-focus-folder]') : null
      const to = row?.dataset.focusFolder
      if (row === null || to === undefined) return null
      const box = row.getBoundingClientRect()
      return { id: to, edge: ev.clientY < box.top + box.height / 2 ? ('before' as const) : ('after' as const) }
    }
    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('keydown', key, true)
      setDropAt(null)
    }
    const move = (ev: globalThis.MouseEvent) => {
      if (!lifted && Math.abs(ev.clientY - y0) < LIFT_PX) return
      lifted = true
      at = over(ev)
      setDropAt(at)
    }
    const up = (ev: globalThis.MouseEvent) => {
      stop()
      if (!lifted) return
      dragged.current = true
      at = over(ev)
      if (at === null || at.id === id) return
      const without = folders.map((f) => f.id).filter((x) => x !== id)
      const i = without.indexOf(at.id)
      if (i < 0) return
      const to = at.edge === 'before' ? i : i + 1
      onReorderFolders([...without.slice(0, to), id, ...without.slice(to)])
    }
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return
      ev.stopPropagation()
      lifted = false
      stop()
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('keydown', key, true)
  }
  const lastNameClick = useRef<{ id: string; at: number }>({ id: '', at: -Infinity })
  const toggle = (id: string) =>
    setShut((was) => {
      const next = new Set(was)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const click = (e: MouseEvent, id: string) => {
    if (dragged.current) {
      dragged.current = false
      return
    }
    if ((e.target as Element).closest('.tree__label') !== null) {
      const at = performance.now()
      if (lastNameClick.current.id === id && at - lastNameClick.current.at <= RENAME_CLICK_GAP_MS) return onEdit(id)
      lastNameClick.current = { id, at }
    }
    toggle(id)
  }
  return (
    <>
      {/* The tree's levels (YAZ-4450 demo): a folder is a level-0 folder row and its items a level-1 tree, so the sidebar's level lines, thread, sticky rows and arrow setting reach them as they reach Files. */}
      <ul className="tree focus-folders" role="tree" onKeyDown={(e) => rowArrows(e, () => undefined)} aria-label={kind === 'focus' ? 'Focus folders' : 'Favorite folders'}>
        {folders.map((folder) => {
          const open = folder.id === only || !shut.has(folder.id)
          const resolved = folder.items.map((item) => ({ item, at: resolveItem(item, roots) }))
          const paths = resolved.flatMap((r) => ('path' in r.at ? [r.at.path] : []))
          const ghosts = resolved.filter((r): r is { item: FolderItem; at: { ghost: string; clash?: true } } => 'ghost' in r.at)
          return (
            <li key={folder.id} role="treeitem" aria-expanded={editing === folder.id ? undefined : open}>
              {editing === folder.id ? (
                <div className="create-inline" style={{ paddingLeft: 8 }}>
                  <TextField className="create-inline__input" value={folder.name} aria-label={kind === 'focus' ? 'Focus folder name' : 'Favorite folder name'} autoFocus selectOnMount maxLength={MAX_VAULT_NAME} normalize={cleanVaultName} onCommit={(next) => onRename(folder.id, next)} onDone={() => onEdit(null)} />
                </div>
              ) : (
                <button type="button" data-walk="" className={`tree__row tree__row--sticky focus-folder${dropAt?.id === folder.id ? ` focus-folder--${dropAt.edge}` : ''}`} data-focus-folder={folder.id} aria-expanded={open} onMouseDown={(e) => pressFolder(e, folder.id)} onClick={(e) => click(e, folder.id)} onContextMenu={(e) => {
                    // Its own menu only: the tab's blank-space menu must not open under it.
                    e.preventDefault()
                    e.stopPropagation()
                    setMenu({ x: e.clientX, y: e.clientY, id: folder.id })
                  }}>
                  <span className={`tree__chevron${open ? ' tree__chevron--open' : ''}`} />
                  <StackIcon />
                  <span className="tree__label">{folder.name}</span>
                </button>
              )}
              {open && (
                <div className="focus-folder__items">
                  {paths.length > 0 && renderItems(folder, paths)}
                  {ghosts.length > 0 && (
                    <ul className="tree" role="group" style={{ '--tree-depth': 1 } as CSSProperties}>
                      {ghosts.map(({ item, at }) => (
                        <li key={`${item.vault}/${item.path}`} role="treeitem">
                          <button type="button" data-walk="" className="tree__row tree__row--ghost" style={{ paddingLeft: 36 }} title={at.clash === true ? `Two vaults in this window are named "${at.ghost}": the app cannot tell which one holds it` : `In "${at.ghost}", which is not in this window`} onClick={() => (at.clash === true ? undefined : onGhost(at.ghost, item.path))} onContextMenu={(e) => (e.preventDefault(), e.stopPropagation())}>
                            <span className="tree__label">
                              {/* A ghost reads as one at a glance (YAZ-4460 demo): a ghost glyph where its file icon would be, in the row's color. */}
                              <GhostIcon />
                              {item.path.slice(item.path.lastIndexOf('/') + 1).replace(/\.md$/, '')}
                            </span>
                            <span className="tree__vault">{at.ghost}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {folder.items.length === 0 && (
                    <p className="sidebar__msg focus-folder__empty">
                      Empty. Drag items here, or right-click a file → {kind === 'focus' ? 'Add to focus' : 'Add to favorites'} ▸ {folder.name}.
                    </p>
                  )}
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
            sections={[[...(() => {
              const f = folders.find((x) => x.id === menu.id)
              const paths = f === undefined ? [] : openableOf(f.items.flatMap((item) => { const at = resolveItem(item, roots); return 'path' in at ? [at.path] : [] }))
              return paths.length === 0 ? [] : [{ id: 'focus-folder-open-all', label: 'Open all in tabs', tip: 'Open each item of this folder in a tab of its own. A folder opens as its folder page.', onSelect: () => onOpenAll(paths) }]
            })()], [{ id: 'focus-folder-rename', label: 'Rename', onSelect: () => onEdit(menu.id) }, ...(only === menu.id ? [] : [{ id: 'focus-folder-only', label: 'Hide all others', onSelect: () => onHideOthers(menu.id) }])], scopeGroup(kind, scopesOf(menu.id), (to, on) => onSetScope(menu.id, to, on), { scope, ask: () => leave(menu.id) }), [{ id: 'focus-folder-delete', label: kind === 'focus' ? 'Delete focus folder' : 'Delete favorite folder', danger: true, onSelect: () => setDeleting(folders.find((f) => f.id === menu.id) ?? null) }]]}
            onClose={() => setMenu(null)}
          />,
          document.body,
        )}
      {moving !== null &&
        createPortal(
          <ConfirmSheet
            labelId="confirm-move-focus-folder-text"
            text={
              <>
                <strong>
                  Remove the {kind === 'focus' ? 'focus' : 'favorite'} folder &quot;{moving.name}&quot; from the {scope} list?
                </strong>
                <br />
                It leaves this list with its items. It stays in the {other} list. Your files do not change.
              </>
            }
            confirmLabel="Remove"
            danger
            onConfirm={() => {
              setMoving(null)
              onSetScope(moving.id, scope, false)
            }}
            onCancel={() => setMoving(null)}
          />,
          document.body,
        )}
      {deleting !== null &&
        createPortal(
          <ConfirmSheet
            labelId="confirm-delete-focus-folder-text"
            text={(() => {
              const away = deleting.items.filter((item) => 'ghost' in resolveItem(item, roots)).length
              return (
                <>
                  <strong>
                    Delete the {kind === 'focus' ? 'focus' : 'favorite'} folder &quot;{deleting.name}&quot;?
                  </strong>
                  <br />
                  {deleting.items.length === 0 ? 'It is empty.' : `Keep its items at the top level of ${kind === 'focus' ? 'Focus' : 'Favorites'}, or remove them from ${kind === 'focus' ? 'focus' : 'favorites'} with the folder.`}
                  {away > 0 && ` ${away === 1 ? 'One item is' : `${away} items are`} in a vault that is not in this window, and ${away === 1 ? 'it leaves' : 'they leave'} ${kind === 'focus' ? 'focus' : 'favorites'} either way.`} Your files do not change.
                </>
              )
            })()}
            // The safe answer is the default (Enter): the items stay. With no item to keep, it is a plain Delete.
            confirmLabel={deleting.items.length === 0 ? 'Delete' : 'Keep items'}
            danger={deleting.items.length === 0}
            onConfirm={() => {
              setDeleting(null)
              onDelete(deleting.id, true)
            }}
            onCancel={() => setDeleting(null)}
            other={
              deleting.items.length > 0 && (
                <button
                  type="button"
                  className="confirm__btn confirm__btn--other confirm__btn--danger"
                  onClick={() => {
                    setDeleting(null)
                    onDelete(deleting.id, false)
                  }}
                >
                  Remove items too
                </button>
              )
            }
          />,
          document.body,
        )}
    </>
  )
}
