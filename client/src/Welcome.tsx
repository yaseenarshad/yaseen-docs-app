import { useEffect, useReducer, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { MAX_RECENT_ROOTS, cleanVaultName, type RecentRoots, type VaultSet } from '@shared/types'
import { api, BridgeRequestError } from './api'
import appIcon from './assets/welcome-icon.png'
import { basename } from './lib/paths'
import { relativeTime } from './lib/relativeTime'
import { storage } from './lib/storage'
import { ContextMenu } from './sidebar/ContextMenu'
import { buildVaultMenuSections, buildVaultSetMenuSections, type VaultMenuHandlers } from './sidebar/vaultMenuSections'
import { GROUP_SETS_TEXT, SETS_MISSING_TEXT } from './sidebar/VaultSwitcher'
import { TextField } from './views/view/TextField'

/**
 * The Welcome screen (C2, GRO-2164): shown only when this window has no folder (D3) — the app
 * name, the recent folders as one-click rows, and the Open folder… button. No dialog opens by
 * itself. The rows are snapshotted at mount, so a row whose folder turned out to be gone stays
 * visible with its "Folder not found" note after App drops the MRU entry.
 *
 * The saved workspaces (YAZ-3886) stand first, under "Workspaces", as in the ⌘O panel (YAZ-2602 S64):
 * every one, last used first, then a line and "Folders" above the recent folders. With none saved the
 * page has no label and no line. A workspace row opens through main's `openSet` door; with no folder
 * left it greys with "Folders not found", the panel's words. Its rows are snapshotted at mount too: a row
 * does not move when main makes its workspace the last used.
 *
 * The look (YAZ-3886 P1–P3, demo round 1): the app's icon stands left of its name, on one line, so the
 * rows keep the height; each row is its own soft tile; a folder's path under the home folder reads "~/…",
 * and a long one is cut from the left, so its end — the folder names — shows (Q1).
 *
 * A right-click (Q2) opens the ⌘O panel's menus: a folder row's is `buildVaultMenuSections` without
 * "Add to this window" and "Open in this window" — on this page both are a click — and a workspace row's
 * is "Rename" and "Remove from workspaces". A dead folder row has no menu (the door pruned its entry, as
 * in ⌘O); a dead workspace row keeps its own: the workspace is still saved. Remove takes the row off at
 * once, and a rename turns the name into an inline field where it stands.
 *
 * The page scrolls in its own box when it is taller than the window, and stays centred when it is not.
 */

/** The row's "2 hours ago" is `lib/relativeTime` (shared with the comment stream since YAZ-1472); the old name stays for its test. */
export { relativeTime as relativeLastOpened }

interface WelcomeProps {
  /** MRU order, straight from `AppState.recents`. */
  recents: RecentRoots
  /** The saved workspaces, last used first, as `AppState.vaultSets` holds them at mount (MAX_VAULT_SETS at most). */
  sets: VaultSet[]
  /** Resolves false when the folder is gone on disk (App drops the MRU entry; the row shows the note). */
  onOpenRecent: (path: string) => Promise<boolean>
  /** Resolves false when none of the workspace's folders is left (the row shows the note). */
  onOpenSet: (id: string) => Promise<boolean>
  onPickFolder: () => void
  /** True while the native folder dialog is open; the button is disabled meanwhile. */
  picking: boolean
  /** App's passive notice: what a menu item did, or why it could not. */
  onNotice: VaultMenuHandlers['onNotice']
}

/** A row's menu or inline name field: a folder row's (its path) or a workspace row's (its id). */
type RowRef = { kind: 'folder' | 'set'; key: string }

export function Welcome({ recents, sets, onOpenRecent, onOpenSet, onPickFolder, picking, onNotice }: WelcomeProps) {
  const [rows, setRows] = useState(() => recents.slice(0, MAX_RECENT_ROOTS))
  const [workspaces, setWorkspaces] = useState(() => sets)
  /**
   * The rows keep their order from the mount, but follow the store (YAZ-3978): a workspace that another window
   * removes leaves, and a rename or new vaults show. Its door would otherwise answer "Folders not found".
   */
  const stored = useSyncExternalStore(storage.subscribe, storage.getVaultSets)
  const liveWorkspaces = workspaces.flatMap((s) => stored.filter((now) => now.id === s.id))
  /** The rows whose door answered false: a folder's path, or a workspace's id. */
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())
  const [menu, setMenu] = useState<(RowRef & { x: number; y: number }) | null>(null)
  const [renaming, setRenaming] = useState<RowRef | null>(null)
  /** A display name lives in the store, not in this page's state: a change there draws the page again. */
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const now = Date.now()
  /** This user's home folder (P2): null until main answers, and the paths show in full meanwhile. */
  const [home, setHome] = useState<string | null>(null)
  useEffect(() => {
    api.app.home().then(setHome, () => undefined)
  }, [])
  const shown = (path: string): string => (home !== null && path.startsWith(home) && (path[home.length] === '/' || path[home.length] === '\\') ? `~${path.slice(home.length)}` : path)

  const settle = (key: string, opening: Promise<boolean>): void =>
    void opening.then((opened) => {
      if (!opened) setMissing((prev) => new Set(prev).add(key))
    })
  const failed = (what: string) => (err: unknown) => onNotice(`Can't ${what}: ${err instanceof Error ? err.message : String(err)}`, 'error')

  const openMenu = (kind: RowRef['kind'], key: string, e: MouseEvent): void => {
    e.preventDefault()
    if (kind === 'folder' && missing.has(key)) return
    setMenu({ kind, key, x: e.clientX, y: e.clientY })
  }
  /** Set display name (YAZ-1974 D5) — `null` is Reset to folder name. */
  const saveName = (path: string, raw: string | null): void => {
    storage.setVaultName(path, raw)
    redraw()
  }
  /** Remove from recent vaults (D3): the MRU entry and the vault's number go (YAZ-2555 A2) — the folder is untouched — and the row leaves at once. */
  const removeRow = (path: string): void => {
    storage.removeRecentRoot(path)
    if (storage.vaultKey(path) !== null) storage.setVaultKey(path, null)
    setRows((prev) => prev.filter((r) => r.path !== path))
  }
  /** Main refuses a name that another workspace has (YAZ-2602 S67); the row follows a yes. */
  const renameSet = (id: string, name: string): void =>
    void api.window.renameSet(id, name).then((renamed) => {
      if (renamed) setWorkspaces((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)))
      else onNotice("Can't rename: a workspace has that name")
    }, failed('rename the workspace'))
  /** Remove from workspaces (S67): main forgets the entry — the folders are untouched — and the row leaves at once. */
  const removeSet = (id: string): void => {
    void api.window.removeSet(id).catch(failed('remove the workspace'))
    setWorkspaces((prev) => prev.filter((s) => s.id !== id))
  }
  /** Reveal in Finder and Open in VS Code: a folder that is gone says so, as the sidebar's do (YAZ-963). */
  const shell = (door: 'reveal' | 'openVsCode', what: string) => (path: string) =>
    void api.shell[door]({ path }).catch((err: unknown) =>
      onNotice(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? `Can't ${what} "${storage.vaultName(path)}" — it is no longer there` : `Can't ${what}: ${err instanceof Error ? err.message : String(err)}`, 'error'),
    )

  /** The ⌘O menu's target (YAZ-1974 D4/D5): no vault is in this window, so none is current or alone here. */
  const folderTarget = (path: string) => {
    const name = storage.vaultName(path)
    return { path, name, isCurrent: false, isAloneHere: false, renamed: name !== basename(path), keyed: storage.keyedVaults(), hotkeys: storage.getSettings().hotkeys }
  }
  const isRenaming = (kind: RowRef['kind'], key: string): boolean => renaming?.kind === kind && renaming.key === key
  const when = (key: string, gone: string, text: string) => <span className={`welcome__recent-when${missing.has(key) ? ' welcome__recent-when--missing' : ''}`}>{missing.has(key) ? gone : text}</span>

  return (
    // The page scrolls in its own box (YAZ-3978): `.editor` clips, and 20 workspaces with 10 folders do not fit a window.
    <div className="welcome-scroll">
      <div className="welcome">
        <h1 className="welcome__title">
          <img className="welcome__icon" src={appIcon} alt="" width={36} height={36} />
          Yaseen Docs
        </h1>
        {liveWorkspaces.length > 0 && (
          <>
            <div className="welcome__label">{GROUP_SETS_TEXT}</div>
            <ul className="welcome__recents">
              {liveWorkspaces.map((s) => {
                const time = when(s.id, SETS_MISSING_TEXT, s.lastUsed === 0 ? '' : relativeTime(s.lastUsed, now))
                const vaults = <span className="welcome__recent-path">{s.roots.map(storage.vaultName).join(' + ')}</span>
                return (
                  <li key={s.id}>
                    {isRenaming('set', s.id) ? (
                      <div className="welcome__recent welcome__recent--renaming">
                        <TextField className="welcome__rename" value={s.name} aria-label="Workspace name" autoFocus selectOnMount normalize={cleanVaultName} onCommit={(name) => renameSet(s.id, name)} onDone={() => setRenaming(null)} />
                        {time}
                        {vaults}
                      </div>
                    ) : (
                      <button type="button" className="welcome__recent" disabled={missing.has(s.id)} onClick={() => settle(s.id, onOpenSet(s.id))} onContextMenu={(e) => openMenu('set', s.id, e)}>
                        <span className="welcome__recent-name">{s.name}</span>
                        {time}
                        {vaults}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="welcome__label welcome__label--rule">Folders</div>
          </>
        )}
        {rows.length === 0 ? (
          <p className="welcome__empty">No recent folders yet.</p>
        ) : (
          <ul className="welcome__recents">
            {rows.map((r) => {
              const time = when(r.path, 'Folder not found', relativeTime(r.lastOpened, now))
              // Cut from the left (Q1): `bdi` keeps the path's own order inside the right-to-left box.
              const path = (
                <span className="welcome__recent-path welcome__recent-path--tail">
                  <bdi>{shown(r.path)}</bdi>
                </span>
              )
              return (
                <li key={r.path}>
                  {isRenaming('folder', r.path) ? (
                    <div className="welcome__recent welcome__recent--renaming">
                      <TextField className="welcome__rename" value={storage.vaultName(r.path)} placeholder={basename(r.path)} aria-label="Display name" autoFocus selectOnMount normalize={(draft) => draft.trim()} onCommit={(next) => saveName(r.path, next)} onDone={() => setRenaming(null)} />
                      {time}
                      {path}
                    </div>
                  ) : (
                    <button type="button" className="welcome__recent" disabled={missing.has(r.path)} onClick={() => settle(r.path, onOpenRecent(r.path))} onContextMenu={(e) => openMenu('folder', r.path, e)}>
                      <span className="welcome__recent-name">{storage.vaultName(r.path)}</span>
                      {time}
                      {path}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <button type="button" className="btn btn--primary" disabled={picking} onClick={onPickFolder}>
          Open folder…
        </button>
        {menu?.kind === 'folder' && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            sections={buildVaultMenuSections(
              folderTarget(menu.key),
              {
                // Main's door: the window that shows the vault alone comes up, else THIS empty window takes it (YAZ-3487 D1).
                onOpenAlone: (path) => settle(path, api.window.openAlone(path)),
                onOpenFilesWindow: (path) => void api.window.openFiles(path).catch(failed('open a Files window')),
                onRename: (path) => setRenaming({ kind: 'folder', key: path }),
                onResetName: (path) => saveName(path, null),
                onSetKey: (path, key) => storage.setVaultKey(path, key),
                onReveal: shell('reveal', 'reveal'),
                onOpenVsCode: shell('openVsCode', 'open in VS Code'),
                onRemove: removeRow,
                onNotice,
              },
            )}
            onClose={() => setMenu(null)}
          />
        )}
        {menu?.kind === 'set' && (
          <ContextMenu x={menu.x} y={menu.y} sections={buildVaultSetMenuSections(menu.key, { onRename: (id) => setRenaming({ kind: 'set', key: id }), onRemove: removeSet })} onClose={() => setMenu(null)} />
        )}
      </div>
    </div>
  )
}
