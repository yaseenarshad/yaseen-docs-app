import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { TreeResponse } from '@shared/types'
import { api, ApiRequestError } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { basename } from '../lib/paths'
import { storage } from '../lib/storage'
import { treeHasFile, treeReducer } from '../lib/treeState'
import { Tree } from './Tree'

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
  onRootMissing,
  onFileMissing,
}: SidebarProps) {
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, dispatch] = useReducer(treeReducer, root, storage.getExpanded)

  const refresh = useCallback(() => {
    api.tree(root).then(
      (res) => {
        setTree(res)
        setError(null)
      },
      (err: unknown) => {
        if (err instanceof ApiRequestError && (err.code === 'NOT_FOUND' || err.code === 'NOT_A_DIRECTORY')) onRootMissing()
        else setError(err instanceof ApiRequestError ? err.message : 'Failed to load folder')
      },
    )
  }, [root, onRootMissing])

  useEffect(() => refresh(), [refresh])

  // Refresh on structural changes; `ready` also fires on every SSE (re)connect, covering missed events.
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
  // while it is being edited stays open and is recreated by the next save).
  const validated = useRef(false)
  useEffect(() => {
    if (tree === null || validated.current) return
    validated.current = true
    if (activeFile !== null && !treeHasFile(tree.tree, activeFile)) onFileMissing()
  }, [tree, activeFile, onFileMissing])

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
      <div className="sidebar__body">
        {error !== null && <p className="sidebar__msg sidebar__msg--error">{error}</p>}
        {tree === null && error === null && <p className="sidebar__msg">Loading…</p>}
        {tree !== null && tree.tree.length === 0 && <p className="sidebar__msg">No markdown files here.</p>}
        {tree !== null && (
          <Tree
            nodes={tree.tree}
            expanded={new Set(expanded)}
            activeFile={activeFile}
            onToggle={(dir) => dispatch({ type: 'toggle', dir })}
            onOpenFile={onOpenFile}
          />
        )}
      </div>
    </aside>
  )
}
