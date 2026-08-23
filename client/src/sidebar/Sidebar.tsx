import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { SettingsState, TreeNode, TreeResponse } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { createNewNote } from '../bases/newNote'
import { ensureFolder, newEntityParts, typeLabel, usableFolder } from '../bases/scaffold'
import { useRegistry } from '../bases/useRegistry'
import type { WatchSource } from '../hooks/useWatch'
import { basename } from '../lib/paths'
import { storage } from '../lib/storage'
import { countLinkReferences } from '../links/renameLinks'
import { treeHasFile, treeReducer } from '../lib/treeState'
import { ConfirmDelete, type DeleteTarget } from './ConfirmDelete'
import { ContextMenu } from './ContextMenu'
import { entryPath, renamedPath, targetDirFor, type EntryKind } from './createEntry'
import { HotkeysButton } from './HotkeysPanel'
import { NewTypeDialog } from './NewTypeDialog'
import { SettingsCog } from './SettingsPanel'
import { Tree, type PendingCreate, type PendingRename, type TreeFileMove } from './Tree'

interface SidebarProps {
  root: string
  activeFile: string | null
  watch: WatchSource
  onOpenFile: (path: string) => void
  /** ⌘-click on a file row (I3 LOCKED ruling, GRO-2235): open in a background tab; App passes `useTabs`' openBackground. */
  onOpenFileBackground: (path: string) => void
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
  /**
   * Context-menu "Rename" committed (files E1 GRO-2194, folders E1b GRO-2241) — and the
   * drag-a-file-onto-a-folder move (E1b) lands here too, as a plain old→new rename: App
   * orchestrates flush → index/tree snapshots → `fs:rename` → link rewrites, and routes ANY
   * failure to the passive notice — this promise never rejects, so the inline input just
   * closes.
   */
  onRenameFile: (oldPath: string, newPath: string) => Promise<void>
  /**
   * Context-menu "Delete" confirmed (GRO-2272): App moves the entry to the system Trash and
   * routes ANY failure to the passive notice — this promise never rejects, so the sheet just
   * closes. No link rewriting happens downstream (LOCKED decision C).
   */
  onDeleteFile: (path: string) => Promise<void>
  /** Show a transient, unobtrusive message — never a dialog (E1, GRO-2171). App owns the banner. */
  onNotice: (message: string) => void
}

/**
 * What the open context menu targets (GRO-2296). Every item has its OWN field: no item
 * derives its target — or its visibility — from another item's value.
 *
 * This split exists because the items are about to diverge. `copyPath` gains a blank-space
 * fallback to the vault ROOT (GRO-2273) and `revealPath` will want the same (GRO-2274),
 * while `renamePath` must NOT: main refuses to rename a window's own vault root
 * (`BAD_REQUEST`, E1b GRO-2241), so offering it would be an item that can only ever fail.
 * Before the split, `renamePath` was literally `menu.copyPath` and the two would have moved
 * together silently.
 */
interface MenuTargets {
  x: number
  y: number
  /** Where "New …" creates: a dir row → itself, a file row → its parent, blank space → the root. */
  targetDir: string
  /** The right-clicked row's kind; null for blank space. Drives the Rename input's mode. */
  rowKind: 'file' | 'dir' | null
  /** "Copy path" — the right-clicked row (file or folder), or the vault ROOT for blank space (GRO-2273). */
  copyPath: string | null
  /** "Copy link" — FILE rows only; a folder link would only fail main's markdown guard (E3, GRO-2173). */
  copyLinkPath: string | null
  /** "Open in new window" — FILE rows only (D2, GRO-2168). */
  newWindowPath: string | null
  /** "Rename" — a concrete row only, NEVER blank space: the vault root is not renameable (E1b, GRO-2241). */
  renamePath: string | null
  /** "Delete" — a concrete row only, NEVER blank space: there is no target, and main refuses the vault root (GRO-2272). */
  deletePath: string | null
  /** "Reveal in Finder" — the row, or the vault ROOT for blank space (GRO-2274); same target as `copyPath`. */
  revealPath: string | null
}

/**
 * Notes and subfolders inside `dir`, counted RECURSIVELY from the already-loaded tree
 * (GRO-2272 `C3-`) — a delete takes the whole subtree, so a shallow count would understate
 * what the user is about to lose. No fetch: the sidebar already holds this tree.
 */
export function countChildren(nodes: readonly TreeNode[], dir: string): { notes: number; folders: number } {
  const found = findDir(nodes, dir)
  if (found === null) return { notes: 0, folders: 0 }
  let notes = 0
  let folders = 0
  const walk = (children: readonly TreeNode[]): void => {
    for (const child of children) {
      if (child.type === 'dir') {
        folders++
        walk(child.children)
      } else notes++
    }
  }
  walk(found)
  return { notes, folders }
}

function findDir(nodes: readonly TreeNode[], dir: string): readonly TreeNode[] | null {
  for (const node of nodes) {
    if (node.type !== 'dir') continue
    if (node.path === dir) return node.children
    if (dir.startsWith(`${node.path}/`)) {
      const hit = findDir(node.children, dir)
      if (hit !== null) return hit
    }
  }
  return null
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
  onOpenFileBackground,
  onPickFolder,
  pickDisabled,
  onCollapse,
  settings,
  onChangeSettings,
  onRootMissing,
  onFileMissing,
  onRenameFile,
  onDeleteFile,
  onNotice,
}: SidebarProps) {
  const [tree, setTree] = useState<TreeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, dispatch] = useReducer(treeReducer, root, storage.getExpanded)
  const [menu, setMenu] = useState<MenuTargets | null>(null)
  const [creating, setCreating] = useState<{ kind: EntryKind; parentDir: string; type?: string; label?: string } | null>(null)
  const [renamingEntry, setRenamingEntry] = useState<{ path: string; kind: 'file' | 'dir' } | null>(null)
  const [newTypeOpen, setNewTypeOpen] = useState(false)
  // The delete confirm sheet's target (GRO-2272 `C3-`); null when the sheet is closed.
  const [confirmingDelete, setConfirmingDelete] = useState<DeleteTarget | null>(null)
  // File drag-to-move (E1b, GRO-2241): the dragged file row + the highlighted drop target.
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)

  // The vault's type registry (Bible B, GRO-2202): feeds the "New ▸" submenu — always present;
  // an empty (or unreadable) registry collapses it to "New type…" (Round 10 Q4, GRO-2226).
  const reg = useRegistry(root).registry
  const newTypes = useMemo(() => Object.entries(reg?.types ?? {}).map(([name, def]) => ({ name, label: typeLabel(name, def) })), [reg])

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

  // A stale tab ACTIVATED after its file vanished on disk (I3, GRO-2235): when the activation
  // CHANGES to an in-root file the cached tree does not show, confirm against a FRESH tree —
  // the inline-create flow activates a just-created file before `refresh()` lands, so the
  // cached tree can be behind — and close it through the same onFileMissing path. A file
  // deleted WHILE it is the active editor stays open (no activation change — recreated by the
  // next save), and background tabs are never probed (out of scope, noted in GRO-2235).
  const lastActive = useRef(activeFile)
  const treeRef = useRef(tree)
  treeRef.current = tree
  useEffect(() => {
    if (activeFile === lastActive.current) return
    lastActive.current = activeFile
    if (activeFile === null || !activeFile.startsWith(`${root.replace(/\/+$/, '')}/`)) return
    if (treeRef.current !== null && treeHasFile(treeRef.current.tree, activeFile)) return
    let cancelled = false // the activation moved on (or the sidebar unmounted): the probe's verdict is stale
    api.tree(root).then(
      (res) => {
        if (!cancelled && !treeHasFile(res.tree, activeFile)) onFileMissing()
      },
      () => undefined, // a root-level failure is refresh()'s problem, not this probe's
    )
    return () => {
      cancelled = true
    }
  }, [activeFile, root, onFileMissing])

  // ---- New note / new base / new folder (GRO-2022, GRO-2126): right-click menu → inline name input ----

  const openMenu = useCallback(
    (node: TreeNode | null, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const filePath = node?.type === 'file' ? node.path : null
      setMenu({
        x: e.clientX,
        y: e.clientY,
        targetDir: targetDirFor(node, root),
        rowKind: node?.type ?? null,
        // ONE field per item, each resolved on its own (GRO-2296). Several are the same
        // expression TODAY and must stay independent anyway — `copyPath`'s root fallback
        // below is exactly the divergence the split exists for.
        //
        // Blank space copies the vault ROOT (GRO-2273): the blank area already means "the
        // root" everywhere else here (`targetDirFor` sends "New note" there), and VS Code's
        // empty-Explorer menu does the same. Trailing separators are stripped so the copied
        // bytes match the root the rest of the app uses.
        copyPath: node?.path ?? root.replace(/\/+$/, ''),
        copyLinkPath: filePath,
        newWindowPath: filePath,
        renamePath: node?.path ?? null,
        deletePath: node?.path ?? null,
        revealPath: node?.path ?? root.replace(/\/+$/, ''),
      })
    },
    [root],
  )

  /** Context menu "Open in new window" (D2, GRO-2168): a fresh window on {root, file}; this one untouched. (⌘-click opens a background tab instead since I3.) */
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

  /** "New ▸ <type>" (GRO-2202): the input shows where the click was; the page may land in the registry folder. */
  const startCreateTyped = useCallback(
    (type: string) => {
      if (menu === null) return
      if (menu.targetDir !== root) dispatch({ type: 'expandTo', root, file: `${menu.targetDir}/x` })
      setCreating({ kind: 'file', parentDir: menu.targetDir, type, label: newTypes.find((t) => t.name === type)?.label ?? type })
      setMenu(null)
    },
    [menu, root, newTypes],
  )

  const submitCreate = useCallback(
    async (name: string) => {
      if (creating === null) return
      // A typed create (GRO-2202): usable registry folder ?? the right-clicked dir (an invalid
      // stored folder is treated as absent — GRO-2226), scaffold from the registry (+ template),
      // all in one atomic content-at-create call — ALREADY_EXISTS fails loudly.
      if (creating.type !== undefined) {
        const def = reg?.types[creating.type] ?? { properties: {} }
        const folder = usableFolder(def)
        const dir = folder === null ? creating.parentDir : await ensureFolder(root, folder)
        const p = entryPath(dir, name, 'file')
        const { properties, body } = await newEntityParts(root, creating.type, def)
        await createNewNote(p, properties, body)
        setCreating(null)
        refresh()
        onOpenFile(p)
        return
      }
      const p = entryPath(creating.parentDir, name, creating.kind)
      // Notes and bases both go through createFile; the main process seeds `.base` with a minimal view.
      if (creating.kind === 'dir') await api.createDir(p)
      else await api.createFile(p)
      setCreating(null)
      refresh()
      // The main pane picks the editor or the base host from the opened path's extension.
      if (creating.kind !== 'dir') onOpenFile(p)
    },
    [creating, reg, root, refresh, onOpenFile],
  )

  const cancelCreate = useCallback(() => setCreating(null), [])

  /**
   * Reveal in Finder (GRO-2274). Read-only, so there is no confirm and nothing to repair —
   * but a STALE row (deleted or moved externally) rejects `NOT_FOUND`, and that has to be
   * visible: `showItemInFolder` is silent on a missing path, so without a notice the menu
   * item would just look broken.
   */
  const reveal = useCallback(
    (path: string) => {
      api.reveal({ path }).catch((err: unknown) => {
        onNotice(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? `Can't reveal "${basename(path)}" — it is no longer there` : `Can't reveal: ${err instanceof Error ? err.message : String(err)}`)
      })
    },
    [onNotice],
  )

  // ---- Delete (GRO-2272): context menu "Delete" → confirm sheet → App trashes the entry ----

  /**
   * Counts for the sheet, computed ONCE when it opens rather than on every render.
   *
   * Both come from data already in hand — the loaded tree and the vault index — so the delete
   * path makes no extra fetch. When the index is unavailable the backlink line is simply
   * omitted (`backlinks: undefined`): a missing count must never block a delete.
   */
  const askDelete = useCallback(
    (path: string) => {
      const kind: 'file' | 'dir' = menu?.rowKind === 'file' ? 'file' : 'dir'
      const target: DeleteTarget = { path, kind }
      if (kind === 'dir') target.children = countChildren(tree?.tree ?? [], path)
      setConfirmingDelete(target)
      // The index is only needed for the count, so it rides in asynchronously and the sheet
      // opens immediately. Failure leaves the line out; it never blocks or spins.
      api.index(root).then(
        ({ records }) => {
          const n = countLinkReferences({ root, oldPath: path, kind, records, tree: tree?.tree })
          setConfirmingDelete((current) => (current !== null && current.path === path ? { ...current, backlinks: n } : current))
        },
        () => undefined,
      )
    },
    [menu, root, tree],
  )

  const confirmDelete = useCallback(
    (dontAskAgain: boolean) => {
      const target = confirmingDelete
      setConfirmingDelete(null)
      if (target === null) return
      if (dontAskAgain) onChangeSettings({ ...settings, confirmDelete: false })
      // Fire and forget: App owns the result and routes every failure to the passive notice.
      void onDeleteFile(target.path)
    },
    [confirmingDelete, onDeleteFile, onChangeSettings, settings],
  )

  // ---- Rename (files E1 GRO-2194, folders E1b GRO-2241): context menu "Rename" → inline input over the row ----

  const submitRename = useCallback(
    async (name: string) => {
      if (renamingEntry === null) return
      const target = renamedPath(renamingEntry.path, name, renamingEntry.kind)
      setRenamingEntry(null)
      if (target === renamingEntry.path) return // same name = no-op
      // App owns the whole flow (and routes failures to the passive notice — never a dialog);
      // the tree row follows via the watcher's unlink+add refresh.
      await onRenameFile(renamingEntry.path, target)
    },
    [renamingEntry, onRenameFile],
  )

  const renaming: PendingRename | null =
    renamingEntry === null ? null : { path: renamingEntry.path, onSubmit: submitRename, onCancel: () => setRenamingEntry(null) }

  // ---- File drag-to-move (E1b, GRO-2241): drop a FILE row on a folder row or the root header ----

  const dropOnDir = useCallback(
    (dir: string) => {
      const path = dragging
      setDragging(null)
      setDropDir(null)
      if (path === null) return
      const target = `${dir}/${basename(path)}`
      if (target === path) return // dropped into its own folder: nothing to do
      // The SAME rename flow as the context menu — never-overwrite and every failure as a
      // passive notice come with it; link updates and the tab remap ride the same pipeline.
      void onRenameFile(path, target)
    },
    [dragging, onRenameFile],
  )

  const fileMove: TreeFileMove = {
    dragging,
    dropDir,
    start: setDragging,
    end: () => {
      setDragging(null)
      setDropDir(null)
    },
    hover: setDropDir,
    drop: dropOnDir,
  }

  const pending: PendingCreate | null =
    creating === null
      ? null
      : {
          kind: creating.kind,
          parentDir: creating.parentDir,
          placeholder: creating.type === undefined ? undefined : `New ${creating.label ?? creating.type}`,
          onSubmit: submitCreate,
          onCancel: cancelCreate,
        }

  return (
    <aside className="sidebar">
      {/* The root header doubles as the "move to the vault root" drop target (E1b). */}
      <div
        className={`sidebar__header${dropDir === root ? ' sidebar__header--drop' : ''}`}
        onDragOver={(e) => {
          if (dragging === null) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          if (dropDir !== root) setDropDir(root)
        }}
        onDragLeave={() => {
          if (dropDir === root) setDropDir(null)
        }}
        onDrop={(e) => {
          e.preventDefault()
          dropOnDir(root)
        }}
      >
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
            onOpenFileBackground={onOpenFileBackground}
            onNodeContextMenu={openMenu}
            pending={pending}
            renaming={renaming}
            move={fileMove}
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
          copyLinkPath={menu.copyLinkPath}
          newWindowPath={menu.newWindowPath}
          onOpenNewWindow={openFileNewWindow}
          renamePath={menu.renamePath}
          onRename={(path) => setRenamingEntry({ path, kind: menu.rowKind === 'file' ? 'file' : 'dir' })}
          deletePath={menu.deletePath}
          onDelete={askDelete}
          revealPath={menu.revealPath}
          onReveal={reveal}
          newTypes={newTypes}
          onNewTyped={startCreateTyped}
          onNewType={() => {
            setMenu(null)
            setNewTypeOpen(true)
          }}
          onNewNote={() => startCreate('file')}
          onNewBase={() => startCreate('base')}
          onNewFolder={() => startCreate('dir')}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmingDelete !== null && <ConfirmDelete target={confirmingDelete} onConfirm={confirmDelete} onCancel={() => setConfirmingDelete(null)} />}
      {newTypeOpen && <NewTypeDialog root={root} onClose={() => setNewTypeOpen(false)} onCreated={refresh} />}
    </aside>
  )
}
