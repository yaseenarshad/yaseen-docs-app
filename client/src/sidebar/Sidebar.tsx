import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { SettingsState, TreeNode, TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { basename } from '../lib/paths'
import { storage } from '../lib/storage'
import { treeHasFile, treeReducer } from '../lib/treeState'
import { ContextMenu } from './ContextMenu'
import { entryPath, targetDirFor, type EntryKind } from './createEntry'
import { HotkeysButton } from './HotkeysPanel'
import { SettingsCog } from './SettingsPanel'
import { Tree, type PendingCreate } from './Tree'

interface SidebarProps {
  root: string
  activeFile: string | null
  watch: WatchSource
  onOpenFile: (path: string) => void
  onPickFolder: () => void
  /** True while the native folder dialog is open; the "change" button is disabled meanwhile. */
  pickDisabled: boolean
  /** Hide the sidebar (GRO-2023); App renders the floating reopen button while hidden. */
  onCollapse: () => void
  /** Editor spacing preferences shown in the footer cog (GRO-2024); App owns and applies them. */
  settings: SettingsState
  onChangeSettings: (next: SettingsState) => void
  /** The stored root could not be read (e.g. deleted); parent decides what to do. */
  onRootMissing: () => void
  /** The restored last file is not in the tree any more (checked once per root). */
  onFileMissing: () => void
}

/** Panel-left pictogram shared by the collapse and reopen buttons (GRO-2023). */
export function SidebarPanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="5.75" y1="2.5" x2="5.75" y2="13.5" />
    </svg>
  )
}

/** Mounted with `key={root}` by App, so all state below is per root. */
export function Sidebar({
  root,
  activeFile,
  watch,
  onOpenFile,
  onPickFolder,
  pickDisabled,
  onCollapse,
  settings,
  onChangeSettings,
  onRootMissing,
  onFileMissing,
}: SidebarProps) {
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, dispatch] = useReducer(treeReducer, root, storage.getExpanded)
  const [menu, setMenu] = useState<{ x: number; y: number; targetDir: string; copyPath: string | null; filePath: string | null } | null>(null)
  const [creating, setCreating] = useState<{ kind: EntryKind; parentDir: string } | null>(null)

  const refresh = useCallback(() => {
    api.tree(root).then(
      (res) => {
        setTree(res)
        setError(null)
      },
      (err: unknown) => {
        if (err instanceof BridgeRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) onRootMissing()
        else setError(err instanceof BridgeRequestError ? err.message : 'Failed to load folder')
      },
    )
  }, [root, onRootMissing])

  useEffect(() => refresh(), [refresh])

  // Refresh on structural changes; `ready` also fires on every watch (re)subscription, covering missed events.
  useEffect(
    () =>
      watch.subscribe((ev) => {
        if (ev.type === 'error') setError(ev.message)
        else if (ev.type !== 'change') refresh()
      }),
    [watch, refresh],
  )

  useEffect(() => {
    storage.setExpanded(root, expanded)
  }, [root, expanded])

  useEffect(() => {
    if (activeFile !== null) dispatch({ type: 'expandTo', root, file: activeFile })
  }, [root, activeFile])

  // Stored lastFile that no longer exists → drop it (first tree only, so a file deleted on disk
  // while it is being edited stays open and is recreated by the next save). Files OUTSIDE the
  // root (opened via a pasted `#/abs/path.md` URL, GRO-2069) are never in the tree — skip them.
  const validated = useRef(false)
  useEffect(() => {
    if (tree === null || validated.current) return
    validated.current = true
    if (activeFile !== null && activeFile.startsWith(`${root.replace(/\/+$/, '')}/`) && !treeHasFile(tree.tree, activeFile))
      onFileMissing()
  }, [tree, activeFile, root, onFileMissing])

  // ---- New note / new base / new folder (GRO-2022, GRO-2126): right-click menu → inline name input ----

  const openMenu = useCallback(
    (node: TreeNode | null, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setMenu({
        x: e.clientX,
        y: e.clientY,
        targetDir: targetDirFor(node, root),
        copyPath: node?.path ?? null,
        // FILE rows only: feeds both "Copy link" (E3, GRO-2173) and "Open in new window" (D2).
        filePath: node?.type === 'file' ? node.path : null,
      })
    },
    [root],
  )

  /** ⌘-click / "Open in new window" (D2, GRO-2168): a fresh window on {root, file}; this one untouched. */
  const openFileNewWindow = useCallback(
    (path: string) => {
      window.yaseenDocs.window.open({ root, file: path }).catch((err: unknown) => console.error('[sidebar] window.open failed:', err))
    },
    [root],
  )

  const startCreate = useCallback(
    (kind: EntryKind) => {
      if (menu === null) return
      // The input renders inside the target dir's children, so that dir must be open;
      // expandTo opens every dir ABOVE the given path, so a synthetic child opens targetDir itself.
      if (menu.targetDir !== root) dispatch({ type: 'expandTo', root, file: `${menu.targetDir}/x` })
      setCreating({ kind, parentDir: menu.targetDir })
      setMenu(null)
    },
    [menu, root],
  )

  const submitCreate = useCallback(
    async (name: string) => {
      if (creating === null) return
      const p = entryPath(creating.parentDir, name, creating.kind)
      // Notes and bases both go through createFile; the main process seeds `.base` with a minimal view.
      if (creating.kind === 'dir') await api.createDir(p)
      else await api.createFile(p)
      setCreating(null)
      refresh()
      // The main pane picks the editor or the base host from the opened path's extension.
      if (creating.kind !== 'dir') onOpenFile(p)
    },
    [creating, refresh, onOpenFile],
  )

  const cancelCreate = useCallback(() => setCreating(null), [])

  const pending: PendingCreate | null =
    creating === null ? null : { ...creating, onSubmit: submitCreate, onCancel: cancelCreate }

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <button type="button" className="sidebar__root" onClick={onPickFolder} disabled={pickDisabled} title={root}>
          <span className="sidebar__root-name">{basename(root)}</span>
          <span className="sidebar__root-hint">change</span>
        </button>
        <button type="button" className="sidebar__collapse" onClick={onCollapse} title="Hide sidebar" aria-label="Hide sidebar">
          <SidebarPanelIcon />
        </button>
      </div>
      <div className="sidebar__body" onContextMenu={(e) => openMenu(null, e)}>
        {error !== null && <p className="sidebar__msg sidebar__msg--error">{error}</p>}
        {tree === null && error === null && <p className="sidebar__msg">Loading…</p>}
        {tree !== null && tree.tree.length === 0 && pending === null && (
          <p className="sidebar__msg">No notes here.</p>
        )}
        {tree !== null && (
          <Tree
            nodes={tree.tree}
            dirPath={root}
            expanded={new Set(expanded)}
            activeFile={activeFile}
            onToggle={(dir) => dispatch({ type: 'toggle', dir })}
            onOpenFile={onOpenFile}
            onOpenFileNewWindow={openFileNewWindow}
            onNodeContextMenu={openMenu}
            pending={pending}
          />
        )}
      </div>
      <div className="sidebar__footer">
        <SettingsCog settings={settings} onChange={onChangeSettings} />
        <HotkeysButton />
      </div>
      {menu !== null && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          copyPath={menu.copyPath}
          copyLinkPath={menu.filePath}
          newWindowPath={menu.filePath}
          onOpenNewWindow={openFileNewWindow}
          onNewNote={() => startCreate('file')}
          onNewBase={() => startCreate('base')}
          onNewFolder={() => startCreate('dir')}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  )
}
