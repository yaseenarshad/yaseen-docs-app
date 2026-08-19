import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { TreeResponse } from '@shared/types'
import { api, ApiRequestError } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { storage } from '../lib/storage'
import { treeHasFile, treeReducer } from '../lib/treeState'
import { basename } from './FolderPicker'
import { Tree } from './Tree'

interface SidebarProps {
  root: string
  activeFile: string | null
  watch: WatchSource
  onOpenFile: (path: string) => void
  onPickFolder: () => void
  /** The stored root could not be read (e.g. deleted); parent decides what to do. */
  onRootMissing: () => void
  /** The restored last file is not in the tree any more (checked once per root). */
  onFileMissing: () => void
}

export function Sidebar({ root, activeFile, watch, onOpenFile, onPickFolder, onRootMissing, onFileMissing }: SidebarProps) {
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

  useEffect(() => {
    dispatch({ type: 'replace', dirs: storage.getExpanded(root) })
    refresh()
  }, [root, refresh])

  // Tree refresh on structural changes; `ready` also fires on SSE reconnect (missed events).
  useEffect(
    () =>
      watch.subscribe((ev) => {
        if (ev.type === 'add' || ev.type === 'unlink' || ev.type === 'addDir' || ev.type === 'unlinkDir' || ev.type === 'ready') refresh()
      }),
    [watch, refresh],
  )

  useEffect(() => {
    storage.setExpanded(root, expanded)
  }, [root, expanded])

  useEffect(() => {
    if (activeFile !== null) dispatch({ type: 'expandTo', root, file: activeFile })
  }, [root, activeFile])

  // Stored lastFile that no longer exists → drop it gracefully (first tree per root only, so a file
  // deleted on disk while it is being edited stays open and is recreated by the next save).
  const validatedRoot = useRef<string | null>(null)
  useEffect(() => {
    if (tree === null || tree.root !== root || validatedRoot.current === root) return
    validatedRoot.current = root
    if (activeFile !== null && !treeHasFile(tree.tree, activeFile)) onFileMissing()
  }, [tree, root, activeFile, onFileMissing])

  return (
    <aside className="sidebar">
      <button type="button" className="sidebar__root" onClick={onPickFolder} title={root}>
        <span className="sidebar__root-name">{basename(root)}</span>
        <span className="sidebar__root-hint">change</span>
      </button>
      <div className="sidebar__body">
        {error !== null && <p className="sidebar__msg sidebar__msg--error">{error}</p>}
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
