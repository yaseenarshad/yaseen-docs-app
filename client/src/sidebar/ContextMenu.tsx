import { useEffect, useLayoutEffect, useRef, useState } from 'react'

interface ContextMenuProps {
  x: number
  y: number
  /** Absolute path of the right-clicked row (file or folder); null for blank space (GRO-2069). */
  copyPath: string | null
  /** The right-clicked FILE row's own `[[wikilink]]`, ready to copy; null (folders, blank space) hides "Copy link" — neither is a note to name (E3 GRO-2173, YAZ-957). */
  copyLinkText: string | null
  /**
   * "Copy N paths" — the whole selection in the panel's own order (🔒 D5, YAZ-1337; ⚡ YAZ-1338
   * appends the paths whose rows are hidden), newline-joined on click; null hides the item, which
   * is every menu opened outside a 2+ selection. Its own target, never `copyPath` in a list: that
   * one falls back to the vault root on blank space.
   */
  copyPaths: string[] | null
  /** "Open N in new tabs" — the same selection, asked separately (🔒 D5); null hides the item. */
  openTabPaths: string[] | null
  /** One background tab per path (I3's opener, GRO-2235) — the caller owns the loop's semantics. */
  onOpenInNewTabs: (paths: string[]) => void
  /**
   * The panel's passive notice (YAZ-1337): a clipboard write that never lands says so, the way
   * `PageContextMenu` reports it. Optional so a mount with no notice channel simply stays quiet.
   */
  onNotice?: (message: string) => void
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
   * Row to open in VS Code — the SAME target rule as `revealPath` (YAZ-963): file, folder, or
   * the vault ROOT for blank space. Optional, unlike its sibling: a mount that offers no VS Code
   * target simply omits the pair and the item is not rendered.
   */
  openVsCodePath?: string | null
  onOpenVsCode?: (path: string) => void
  onNewNote: () => void
  /** Create a note born a folder page — the flag and nothing else (🔒 D4 + D1, YAZ-841). */
  onNewFolderPage: () => void
  /**
   * Create a DISK folder — null hides the item (YAZ-948). Topics pages and blank space still
   * browse by meaning and omit it; YAZ-1080's explicit Uncategorized disk-folder targets reuse
   * the Files directory menu and therefore supply it.
   */
  onNewFolder: (() => void) | null
  /**
   * The folder-page toggle's own target (🔒 D2, YAZ-817): MARKDOWN FILE rows only — null on
   * folders and on blank space, neither of which can carry the flag.
   */
  folderPagePath: string | null
  /** Is that page a folder page ALREADY? One item, two labels — the flag picks which (🔒 D2). */
  folderPageIsOn: boolean
  /** The direction rides along with the target so the caller never re-derives it after the close. */
  onToggleFolderPage: (path: string, isOn: boolean) => void
  onClose: () => void
}

/** Right-click menu for the file tree (GRO-2022). The overlay catches click-away and stray right-clicks. */
export function ContextMenu({ x, y, copyPath, copyPaths, openTabPaths, onOpenInNewTabs, onNotice, copyLinkText, newWindowPath, onOpenNewWindow, renamePath, onRename, deletePath, onDelete, revealPath, onReveal, openVsCodePath, onOpenVsCode, onNewNote, onNewFolderPage, onNewFolder, folderPagePath, folderPageIsOn, onToggleFolderPage, onClose }: ContextMenuProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Viewport clamping (GRO-2204): render at the cursor, then measure and pull the menu back
  // inside the window instead of spilling off an edge.
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = menuRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setPos({ left: Math.max(0, Math.min(x, window.innerWidth - r.width)), top: Math.max(0, Math.min(y, window.innerHeight - r.height)) })
  }, [x, y])

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
        {/* The multi-select pair (🔒 D5, YAZ-1337) leads the menu: when a right-click lands inside
            a selection, what the user is pointing at is the SELECTION — so its two actions come
            before the singular items, which go on targeting the one row underneath. Both leave
            the selection standing: acting on it is not the same as ending it. */}
        {copyPaths !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              // The failure is REPORTED (`PageContextMenu`'s idiom): a clipboard the OS refused is
              // silent otherwise, and a copy that quietly did nothing is the worst kind of no-op.
              void navigator.clipboard.writeText(copyPaths.join('\n')).catch((error: unknown) => {
                onNotice?.(`Can't copy paths: ${error instanceof Error ? error.message : String(error)}`)
              })
              onClose()
            }}
          >
            Copy {copyPaths.length} paths
          </button>
        )}
        {openTabPaths !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onOpenInNewTabs(openTabPaths)
              onClose()
            }}
          >
            Open {openTabPaths.length} in new tabs
          </button>
        )}
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
        {/* Open in VS Code (YAZ-963): Reveal's sibling, so it sits directly beside it in the
            same OS-actions group — same target rule, same read-only posture, same passive
            notice when the row is stale. */}
        {openVsCodePath != null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onOpenVsCode?.(openVsCodePath)
              onClose()
            }}
          >
            Open in VS Code
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
        {copyLinkText !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(copyLinkText)
              onClose()
            }}
          >
            Copy link
          </button>
        )}
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewNote}>
          New note
        </button>
        {/* Directly after "New note" (🔒 D4, YAZ-817): a folder page is a NOTE born with one
            flag (🔒 D1), so it belongs beside the note it is a kind of. It creates beside the
            right-clicked row like the rest of this group — the act-on-this-row toggle below is
            the other half of the gesture, and the two must not drift together. */}
        <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewFolderPage}>
          New folder page
        </button>
        {onNewFolder !== null && (
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={onNewFolder}>
            New folder
          </button>
        )}
        {/* The folder-page toggle (🔒 D2, YAZ-817): ONE state-aware item, both directions. It
            acts ON the right-clicked page rather than creating beside it, so it sits after the
            create group — and above Rename, because the destructive pair keeps the bottom. The
            reverse label is the one that opens a confirm sheet (🔒 D5); the forward one writes
            immediately (🔒 D1), which is why neither reads like a warning. */}
        {folderPagePath !== null && (
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onToggleFolderPage(folderPagePath, folderPageIsOn)
              onClose()
            }}
          >
            {folderPageIsOn ? 'Turn back into normal page' : 'Turn into folder page'}
          </button>
        )}
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
