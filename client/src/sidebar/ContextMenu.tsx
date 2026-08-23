import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { fileLink } from '@shared/links'

/** The submenu's CSS `top: -5px`, needed to compute its viewport overflow. */
const SUB_TOP = -5

interface ContextMenuProps {
  x: number
  y: number
  /** Absolute path of the right-clicked row (file or folder); null for blank space (GRO-2069). */
  copyPath: string | null
  /** Absolute path of the right-clicked FILE row; null (folders, blank space) hides "Copy link" — a folder link would only fail main's markdown guard (E3, GRO-2173). */
  copyLinkPath: string | null
  /** Absolute path of the right-clicked FILE row; null (folders, blank space) hides "Open in new window" (D2, GRO-2168). */
  newWindowPath: string | null
  onOpenNewWindow: (path: string) => void
  /** Absolute path of the right-clicked row — FILE (Links E1, GRO-2194) or FOLDER (E1b, GRO-2241); null (blank space) hides "Rename". */
  renamePath: string | null
  onRename: (path: string) => void
  /** Absolute path of the right-clicked row — file or folder; null (blank space) hides "Delete" (GRO-2272). */
  deletePath: string | null
  onDelete: (path: string) => void
  /** Row to reveal in Finder — file, folder, or the vault ROOT for blank space (GRO-2274). */
  revealPath: string | null
  onReveal: (path: string) => void
  /**
   * Registered types for the "New ▸" submenu (Bible B, GRO-2202; Round 10 Q4 LOCKED, GRO-2226):
   * one item per type + "New type…" at the bottom. The submenu is ALWAYS present — [] collapses
   * it to the single "New type…" item, the fresh-vault bootstrap entry (supersedes the Round 9
   * Q1 "empty registry → no menu change" wording; the lazy rule still guarantees nothing is
   * created by merely seeing it).
   */
  newTypes: Array<{ name: string; label: string }>
  onNewTyped: (type: string) => void
  /** "New type…": schema entry + starter base in one action (Round 9 record). */
  onNewType: () => void
  onNewNote: () => void
  /** Create an Obsidian-compatible `.base` file (GRO-2126). */
  onNewBase: () => void
  onNewFolder: () => void
  onClose: () => void
}

/** Right-click menu for the file tree (GRO-2022). The overlay catches click-away and stray right-clicks. */
export function ContextMenu({ x, y, copyPath, copyLinkPath, newWindowPath, onOpenNewWindow, renamePath, onRename, deletePath, onDelete, revealPath, onReveal, newTypes, onNewTyped, onNewType, onNewNote, onNewBase, onNewFolder, onClose }: ContextMenuProps) {
  const [subOpen, setSubOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Viewport clamping (GRO-2204): render at the cursor, then measure and pull the menu back
  // inside the window; the submenu flips left / slides up instead of spilling off an edge.
  const menuRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const [sub, setSub] = useState({ flip: false, up: 0 })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(0, Math.min(x, window.innerWidth - r.width)), top: Math.max(0, Math.min(y, window.innerHeight - r.height)) })
  }, [x, y])

  useLayoutEffect(() => {
    if (!subOpen) return
    const group = groupRef.current
    const el = subRef.current
    if (group === null || el === null) return
    const g = group.getBoundingClientRect()
    const s = el.getBoundingClientRect()
    const overflow = g.top + SUB_TOP + s.height - window.innerHeight
    setSub({ flip: g.right + s.width > window.innerWidth, up: Math.max(0, Math.min(overflow, g.top + SUB_TOP)) })
  }, [subOpen, pos])

  return (
    <div
      className="ctx-overlay"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div ref={menuRef} className="ctx-menu" style={{ left: pos.left, top: pos.top }} onMouseDown={(e) => e.stopPropagation()} role="menu">
        {newWindowPath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onOpenNewWindow(newWindowPath)
              onClose()
            }}
          >
            Open in new window
          </button>
        )}
        {/* Reveal in Finder (GRO-2274): available on every row type AND on blank space, where
            it reveals the vault root — the same target Copy path uses. Grouped with the other
            read-only utilities, deliberately above the destructive item. */}
        {revealPath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onReveal(revealPath)
              onClose()
            }}
          >
            Reveal in Finder
          </button>
        )}
        {copyPath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(copyPath)
              onClose()
            }}
          >
            Copy path
          </button>
        )}
        {copyLinkPath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(fileLink(copyLinkPath))
              onClose()
            }}
          >
            Copy link
          </button>
        )}
        {/* Always present (Round 10 Q4, GRO-2226): an empty registry collapses it to "New type…". */}
        <div ref={groupRef} className="ctx-menu__group" onMouseEnter={() => setSubOpen(true)} onMouseLeave={() => setSubOpen(false)}>
          <button
            type="button"
            className="ctx-menu__item ctx-menu__item--sub"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={subOpen}
            onClick={() => setSubOpen((o) => !o)}
          >
            New
            <span className="ctx-menu__sub-arrow" aria-hidden="true">
              ▸
            </span>
          </button>
          {subOpen && (
            <div ref={subRef} className={`ctx-submenu${sub.flip ? ' ctx-submenu--left' : ''}`} style={sub.up > 0 ? { top: SUB_TOP - sub.up } : undefined} role="menu">
              {newTypes.map((t) => (
                <button key={t.name} type="button" className="ctx-menu__item" role="menuitem" onClick={() => onNewTyped(t.name)}>
                  New {t.label}
                </button>
              ))}
              <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewType}>
                New type…
              </button>
            </div>
          )}
        </div>
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewNote}>
          New note
        </button>
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewBase}>
          New base
        </button>
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewFolder}>
          New folder
        </button>
        {/* Rename and Delete render LAST (GRO-2272 `C1a-`, LOCKED): VS Code's Explorer puts
            both at the bottom, and destructive-last is safer on its own merits — Delete used
            to sit directly under Rename, which is the misclick pair that matters most.
            Delete opens the confirm sheet; it must NEVER delete directly. Both are null on
            blank space: no target, and main refuses the vault root anyway. */}
        {renamePath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onRename(renamePath)
              onClose()
            }}
          >
            Rename
          </button>
        )}
        {deletePath !== null && (
          <button
            type="button"
            className="ctx-menu__item ctx-menu__item--danger"
            role="menuitem"
            onClick={() => {
              onDelete(deletePath)
              onClose()
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
