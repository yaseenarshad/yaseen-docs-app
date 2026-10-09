/**
 * THE BRIDGE, DECLARED ONCE (YAZ-2131 🔒 D9, YAZ-2200). `CONTRACT` is every channel `window.yaseenDocs`
 * reaches, as data: an `invoke` is a request main answers (`ipcMain.handle`), a `push` is an event
 * main sends and a renderer subscribes to with `on…(listener)`, which returns its unsubscribe. The
 * preload builds the bridge from this table, main registers its handlers against it, the renderer's
 * `api` wraps it, and `YaseenDocsApi` is derived from it, so the allowlist stays fixed at build time
 * and a missing or mistyped door fails to compile. The hand-written specials are `SPECIAL`: watch
 * (multiplexed), the close/quit flush handshake, and menu Copy as / Paste as; the preload also
 * overrides three table doors to keep their wire behaviour: `state.setFolds` / `state.setBaseGroups`
 * (send a copy) and `properties.onChange` (unwraps `{ root, properties }`). Long form:
 * docs/CONTRACTS.md › Bridge API.
 */
import type { AppState, AssetResponse, AssetWriteRequest, AssetWriteResponse, BridgeError, ClipboardPasteRequest, ColdStartDiffResponse, CreateDirRequest, CreateDirResponse, CreateFileRequest, CreateFileResponse, DeleteRequest, DeleteResponse, FileClipRequest, FileClipState, FileDeletedEvent, FileHead, FileRenamedEvent, FileResponse, FileWriteRequest, FileWriteResponse, FolderPatch, GithubSyncStatus, IdsState, ImageResponse, IndexResponse, OpenLinkRequest, OpenSetResult, OpenWindowOptions, PasteRequest, PasteResponse, PdfResponse, PickFolderResponse, PropertiesResponse, PropertyDecl, RenameFileRequest, RenameFileResponse, RetitleRequest, RevealRequest, RevealResponse, SettingsState, TreeResponse, VaultConfigChange, WatchEvent, WindowIdentity, ZoomStep } from './types'

/**
 * A request main answers. `A` and `R` are phantom: at runtime only `kind`, `channel` and `arity`
 * exist. `arity` is checked against `A`, and the preload forwards exactly that many arguments,
 * which is what the hand-written bridge did.
 */
export interface Invoke<A extends unknown[], R> {
  readonly kind: 'invoke'
  readonly channel: string
  readonly arity: number
  readonly types?: (...args: A) => R
}

/** An event main sends; `T` is what the listener receives (`void` for nothing). */
export interface Push<T> {
  readonly kind: 'push'
  readonly channel: string
  readonly payload?: T
}

export const invoke = <A extends unknown[], R>(channel: string, arity: A['length']): Invoke<A, R> => ({ kind: 'invoke', channel, arity })
const push = <T = void>(channel: string): Push<T> => ({ kind: 'push', channel })

export const CONTRACT = {
  tree: invoke<[root: string], TreeResponse>('fs:tree', 1),
  readFile: invoke<[path: string], FileResponse>('fs:read', 1),
  /** The top of each note in `paths`, in their order (YAZ-2648 D6): only the head is read off disk, never the file. `null` for a path that is no note or could not be read; one never fails the rest. */
  readHeads: invoke<[paths: readonly string[]], (FileHead | null)[]>('fs:read-heads', 1),
  readPdf: invoke<[path: string], PdfResponse>('fs:read-pdf', 1),
  readImage: invoke<[path: string], ImageResponse>('fs:read-image', 1),
  writeFile: invoke<[req: FileWriteRequest], FileWriteResponse>('fs:write', 1),
  createDir: invoke<[req: CreateDirRequest], CreateDirResponse>('fs:create-dir', 1),
  createFile: invoke<[req: string | CreateFileRequest], CreateFileResponse>('fs:create-file', 1),
  /**
   * The door (YAZ-2677 🔒 D4, R17): the next ID of the vault that holds `path`, for a caller that
   * must know it before its note exists (`CreateFileRequest.id`). The number is saved before it is
   * answered, so one that is never used is a gap and no ID is given two times. Null where the vault
   * does not use IDs.
   */
  mintNoteId: invoke<[path: string], string | null>('fs:mint-note-id', 1),
  /** Bases property index for `root` (GRO-2129): full scan on first call, watcher-incremental after. */
  index: invoke<[root: string], IndexResponse>('fs:index', 1),
  /** The cold-start reconcile diff for `root` (Links E1c, GRO-2242); null before the first `index(root)` build. Read it AFTER the first index snapshot. */
  coldDiff: invoke<[root: string], ColdStartDiffResponse | null>('fs:cold-diff', 1),
  /** A local image or drawing under `root` (GRO-2139, YAZ-876): `ref` is a wikilink target or path, resolved root-relative, then by Obsidian's shortest-path rule. */
  readAsset: invoke<[root: string, ref: string], AssetResponse>('fs:read-asset', 2),
  /** Writes a drawing (string) or an image (bytes) under `root` (YAZ-876, YAZ-1661): explicit path, atomic; see `AssetWriteRequest`. */
  writeAsset: invoke<[req: AssetWriteRequest], AssetWriteResponse>('fs:write-asset', 1),
  /** Native open-directory dialog parented to the calling window (GRO-2163). */
  pickFolder: invoke<[], PickFolderResponse>('dialog:pick-folder', 0),
  /** Targeted mutators (not a generic patch) so several windows never lose each other's writes. */
  state: {
    get: invoke<[], AppState>('state:get', 0),
    setSettings: invoke<[settings: SettingsState], void>('state:set-settings', 1),
    /** Clamped to [SIDEBAR_MIN_W, SIDEBAR_MAX_W] by the main process. */
    setSidebarWidth: invoke<[width: number], void>('state:set-sidebar-width', 1),
    /** The Favorites order of the window's vaults (YAZ-2631 D1); main merges it into the one list. */
    setFavoritesOrder: invoke<[roots: readonly string[], paths: readonly string[]], void>('state:set-favorites-order', 2),
    /** Prepend to recents (de-duplicated, capped). */
    pushRecent: invoke<[path: string], void>('state:push-recent', 1),
    /** Drop a folder from recents (its directory vanished on disk, C2 — GRO-2164); unknown path is a no-op. */
    removeRecent: invoke<[path: string], void>('state:remove-recent', 1),
    /** Merge into `folders[root]`; missing root entries are created with defaults. `name` is cleaned main-side (YAZ-1974). */
    setFolder: invoke<[root: string, patch: FolderPatch], void>('state:set-folder', 2),
    /** Replace the fold keys for one file; an empty list removes the entry. The preload sends a copy of `keys`. */
    setFolds: invoke<[root: string, file: string, keys: readonly string[]], void>('state:set-folds', 3),
    /** Replace the collapsed group keys for one base view (`<basePath>::<viewName>`); an empty list removes the entry. The preload sends a copy of `collapsed`. */
    setBaseGroups: invoke<[root: string, key: string, collapsed: readonly string[]], void>('state:set-base-groups', 3),
    /** Fired in every window after any change. */
    onChange: push<AppState>('state:changed'),
  },
  window: {
    /** Who am I: main answers from `AppState.windows` by the `?win=<id>` in the window's URL. */
    identity: invoke<[], WindowIdentity>('window:identity', 0),
    /** Record this window's folder/file/tabs and chrome; main re-enforces the tabs invariant (GRO-2232). */
    setIdentity: invoke<[patch: Partial<Omit<WindowIdentity, 'id'>>], void>('window:set-identity', 1),
    open: invoke<[opts: OpenWindowOptions], void>('window:open', 1),
    /** `⌘⇧N`: same folder, same file, new window (GRO-2167). */
    duplicate: invoke<[], void>('window:duplicate', 0),
    /** The vault switcher's one door (YAZ-1767 🔒 D1, D9): raise that vault's windows or open a new one on its last file; `false` = the folder is gone and was pruned from the MRU. */
    openRecent: invoke<[path: string], boolean>('window:open-recent', 1),
    /** Open a saved set of vaults (YAZ-2602 D8, S65, S66): raise the window that shows exactly its vaults, else open one on them; a vault whose folder is gone is left out and named in `missing`; `opened: false` = no folder is left. */
    openSet: invoke<[id: string], OpenSetResult>('window:open-set', 1),
    /** Save THIS window's vaults as a set under `name` (S63); the same name replaces. `false` = refused: fewer than two vaults, an empty name, or a new name when MAX_VAULT_SETS exist (R12). */
    saveSet: invoke<[name: string], boolean>('window:save-set', 1),
    /** Rename a saved set (S67); `false` = refused: an unknown id, an empty name, or a name another set has. */
    renameSet: invoke<[id: string, name: string], boolean>('window:rename-set', 2),
    /** Forget a saved set (S67); the folders are not touched. */
    removeSet: invoke<[id: string], void>('window:remove-set', 1),
    /** Close THIS window through the REAL close path, so the flush handshake runs (GRO-2232). */
    closeSelf: invoke<[], void>('window:close-self', 0),
    /** App-wide zoom for THIS window (YAZ-1710): what the stock `zoomIn` / `zoomOut` / `resetZoom` roles did — level ± 0.5, or back to 0. */
    zoom: invoke<[step: ZoomStep], void>('window:zoom', 1),
  },
  /** Menu gestures from the main process (B3, GRO-2161; tabs GRO-2232): main sends them to the focused window only. */
  menu: {
    /** File › Open Folder… (⌘⇧O): run the pick-folder flow. */
    onOpenFolder: push('menu:open-folder'),
    /** File › Open Recent chose `path`: Welcome switches in place, a vault window opens it beside (YAZ-1914). */
    onOpenRoot: push<string>('menu:open-root'),
    /** File › Search Vault (⌘K): focus the sidebar search bar (YAZ-804). */
    onSearch: push('menu:search'),
    /** File › Switch Vault… (⌘O): open the sidebar header's vault switcher, un-collapsing the sidebar first (YAZ-1767 D8). */
    onSwitchVault: push('menu:switch-vault'),
    /** Yaseen Docs › Settings… (⌘,): open the settings dialog (YAZ-1679). */
    onSettings: push('menu:settings'),
    /** View › Toggle Sidebar (YAZ-1280). */
    onToggleSidebar: push('menu:toggle-sidebar'),
    /** View › Zoom In / Out / Actual Size (⌘+ / ⌘− / ⌘0): the renderer routes it to the focused note or the app (YAZ-1710). */
    onZoom: push<ZoomStep>('menu:zoom'),
    /** File › Close Tab (⌘W): close the active tab (GRO-2232). */
    onCloseTab: push('menu:close-tab'),
    /** Window › Next Tab (⌃Tab / ⌘⇧]): activate the tab to the right (GRO-2232). */
    onNextTab: push('menu:next-tab'),
    /** Window › Previous Tab (⌃⇧Tab / ⌘⇧[): activate the tab to the left (GRO-2232). */
    onPrevTab: push('menu:prev-tab'),
    /** Window › Tab Overview (⌘⇧M): show every open tab of the window at once, or go back to the page (YAZ-2648 D5). */
    onTabOverview: push('menu:tab-overview'),
    /** File › New Tab (⌘T): show the one blank tab, with the caret in the sidebar's search bar (YAZ-2655 D10, D11). */
    onNewTab: push('menu:new-tab'),
  },
  /** Deep links (E1, GRO-2171): main parses a `yaseendocs://` URL (`shared/links.ts`) and routes it to the best window. */
  link: {
    /** A link resolved to this window: open `path` (guaranteed inside this window's root). */
    onOpenFile: push<string>('link:open-file'),
    /** A link could not be opened (bad URL, unsupported, missing or non-regular file): show `message` unobtrusively. */
    onNotice: push<string>('link:notice'),
    /** This window's two listeners above are on (YAZ-2589 A2): main sends the pushes it held while the page loaded. */
    ready: invoke<[], void>('link:ready', 0),
  },
  /** The file lifecycle (Links E1 GRO-2194, GRO-2272, YAZ-1674): each change is one invoke plus a push to EVERY window, its own included. */
  file: {
    /** In-app rename (Links E1 GRO-2194; folders E1b GRO-2241): same-directory, extension kind unchanged; never overwrites (`ALREADY_EXISTS`). */
    rename: invoke<[req: RenameFileRequest], RenameFileResponse>('fs:rename', 1),
    /** A title edit (YAZ-2420 🔒 D16): writes `title:`, then renames the note or folder to the name built from it; a changed path is repaired and pushed as `rename`'s is. */
    retitle: invoke<[req: RetitleRequest], RenameFileResponse>('fs:retitle', 1),
    /** Store/tab repair for a rename that ALREADY happened on disk (Links E1c, GRO-2242): `newPath` must exist, `oldPath` must not; pushes the same `file:renamed`. */
    repairRename: invoke<[req: RenameFileRequest], RenameFileResponse>('file:repair-rename', 1),
    /** Fired in every window after a successful rename or repair. */
    onRenamed: push<FileRenamedEvent>('file:renamed'),
    /** In-app delete (GRO-2272): to the SYSTEM TRASH only, never `fs.rm`; refuses dot-entries and the calling window's own root. Notes linking to it stay byte-identical. */
    delete: invoke<[req: DeleteRequest], DeleteResponse>('fs:delete', 1),
    /** Fired in every window after a successful delete. */
    onDeleted: push<FileDeletedEvent>('file:deleted'),
    /** Cut / Copy (YAZ-1674, D1): replace main's ONE app-wide clipboard with the ordered selection; nothing on disk is touched. */
    clip: invoke<[req: FileClipRequest], void>('fs:clip', 1),
    /** Paste INTO `targetDir` (YAZ-1674, D2–D4): per entry, a copy takes a free name, a cut moves through the rename pipeline; read `failed` for the notices. */
    paste: invoke<[req: PasteRequest], PasteResponse>('fs:paste', 1),
    /** The clipboard now, for a window that mounted after a clip: `{ count, op, paths }`, or null when empty. Never fails. */
    clipState: invoke<[], FileClipState>('fs:clip-state', 0),
    /** Fired in every window after every clipboard change (its own included); null = empty. */
    onClipChanged: push<FileClipState>('clip:changed'),
  },
  /** OS hand-offs (GRO-2274, YAZ-963, YAZ-1577), read-only: a path that no longer exists rejects `NOT_FOUND`. */
  shell: {
    /** Show `path` in the OS file manager, selected IN ITS PARENT (`shell.showItemInFolder`). */
    reveal: invoke<[req: RevealRequest], RevealResponse>('shell:reveal', 1),
    /** Open `path` in VS Code through `vscode://file/…` — `shell.openExternal`, never a spawned process (YAZ-963). */
    openVsCode: invoke<[req: RevealRequest], RevealResponse>('shell:openVsCode', 1),
    /**
     * Hand `path` to the OS default application (YAZ-1577) — how a tree row with no in-app viewer
     * (`kind: null`) opens. An OS refusal (`shell.openPath`'s returned message) rejects `IO_ERROR`
     * carrying that message.
     */
    openDefault: invoke<[req: RevealRequest], RevealResponse>('shell:openDefault', 1),
    /** Open a validated Markdown-link target through the OS; never creates an Electron window. */
    openLink: invoke<[req: OpenLinkRequest], void>('shell:open-link', 1),
  },
  /** Vault-local config in `<root>/.yaseendocs/` (Desktop J, GRO-2188): created lazily on first write; reading never creates it. */
  vaultConfig: {
    /** Parsed `<root>/.yaseendocs/<name>`, or null when the folder/file is missing; malformed JSON rejects `INVALID_CONFIG`. */
    read: invoke<[root: string, name: string], unknown>('vaultConfig:read', 2),
    /** Creates `.yaseendocs/` on first write; atomic tmp+rename; pretty-printed JSON. `name` must be a plain `<stem>.json`. */
    write: invoke<[root: string, name: string, value: unknown], void>('vaultConfig:write', 3),
    /** Fired in every window after any vault's config change. */
    onChange: push<VaultConfigChange>('vaultConfig:changed'),
  },
  /** A vault's IDs (YAZ-2677), each for a vault of the calling window: the switch in Settings and the duplicate check. */
  ids: {
    /**
     * Save the vault's answer in its `ids.json`, and with a yes its ID letters, in capitals (🔒 D2).
     * Every other key of the file stays (R10, R12), and the read and the write are one step in main,
     * so two windows that save at one moment each keep the other's change. A yes gives every note
     * and folder its number NOW, on this Mac (R32, S64); a Mac that only sees the yes arrive by the
     * sync waits (S65). A file that is not valid JSON is not written over (`INVALID_CONFIG`).
     */
    set: invoke<[root: string, enabled: boolean, letters?: string], void>('ids:set', 3),
    /**
     * "Check for duplicates" (🔒 D7, S55 to S57): the notes that share an ID are settled now, on this
     * Mac (R32), and the answer tells the result in one line: `No duplicates.`, what was fixed, or
     * which ID another Mac must fix (then nothing was written).
     */
    check: invoke<[root: string], string>('ids:check', 1),
    /** What the rows "ID letters" and "Old IDs" show (🔒 D5, D6): the letters and the counts, from main's index. A vault that does not use IDs → `BAD_REQUEST`. */
    state: invoke<[root: string], IdsState>('ids:state', 1),
    /**
     * "Change letters" (🔒 D5, S79 to S87): main FIRST saves `letters` and puts the letters of before
     * into `was`, THEN changes each `id:` line, link, `also_in` entry, folder-value key and built
     * file name. A number never changes, and an old ID is not touched. The letters the vault has
     * now are "Finish": only the files a stopped change left are written. Resolves when it is done,
     * to the state after it.
     */
    reletter: invoke<[root: string, letters: string], IdsState>('ids:reletter', 2),
    /**
     * "Give old IDs numbers" (🔒 D6, S88 to S90): each note and folder with an old 12-character ID
     * takes the vault's next number, oldest file first, and each link, `also_in` entry, folder-value
     * key and built file name follows. A second run finishes one that stopped, with the same numbers.
     * Resolves when it is done, to the state after it.
     */
    backfill: invoke<[root: string], IdsState>('ids:backfill', 1),
  },
  /** Vault-wide property declarations over `.yaseendocs/properties.json` (YAZ-835): targeted, serialised mutators; a corrupt file rejects every write `INVALID_CONFIG`. */
  properties: {
    /** Empty declarations (no error) when .yaseendocs/properties.json does not exist; never creates anything. */
    get: invoke<[root: string], PropertiesResponse>('properties:get', 1),
    /** Upsert one vault-wide declaration. Creates the dotfolder and the file on demand. */
    setProperty: invoke<[root: string, name: string, def: PropertyDecl], void>('properties:set-property', 3),
    removeProperty: invoke<[root: string, name: string], void>('properties:remove-property', 2),
    /** Fired in every window of that root after any change, internal or external. Main sends `{ root, properties }`; the preload hands the listener `properties`. */
    onChange: push<PropertiesResponse>('properties:changed'),
  },
  /** The Favorites list over `.yaseendocs/favorites.json` (YAZ-1766 6A): absolute paths in the user's order. */
  favorites: {
    /** Absolute paths in stored order; `[]` when the file is absent or malformed. Never creates anything. */
    get: invoke<[root: string], string[]>('favorites:get', 1),
    /** Replace the list; every path must be inside `root` (→ `BAD_REQUEST`). Creates the dotfolder and file on first write. */
    set: invoke<[root: string, paths: readonly string[]], void>('favorites:set', 2),
    /** Fired in every window after any change to a vault's favorites.json, own or external; filter by `root`. */
    onChanged: push<{ root: string }>('favorites:changed'),
  },
  /** Per-vault GitHub sync, off by default (YAZ-1081); every call answers the same status the push carries. */
  github: {
    /** This root's current status, from the manager's last broadcast; for a root whose sync is OFF, a read-only inspection (remote + branch). Never a failure. */
    status: invoke<[root: string], GithubSyncStatus>('github:status', 1),
    /** Run a pass NOW (the manual "sync" button). A pass already running is joined, never raced; `off` roots answer `off`. */
    syncNow: invoke<[root: string], GithubSyncStatus>('github:sync-now', 1),
    /** The per-vault switch (D4): ON answers the first pass's real outcome, OFF is immediate and total. */
    setEnabled: invoke<[root: string, enabled: boolean], GithubSyncStatus>('github:set-enabled', 2),
    /** Fired in every window on every transition of any vault; filter by `status.root`. */
    onStatus: push<GithubSyncStatus>('github:status-changed'),
  },
} as const

/** The hand-written specials' channels: the preload writes these functions itself. */
export const SPECIAL = {
  /** `watch(root, listener)`: one shared watcher per root in main; events are multiplexed by subscription id. */
  watchSubscribe: 'watch:subscribe',
  watchUnsubscribe: 'watch:unsubscribe',
  watchEvent: 'watch:event',
  /** The close/quit flush handshake (GRO-2160): main sends `app:flush` and holds the window until `app:flushed`. */
  appFlush: 'app:flush',
  appFlushed: 'app:flushed',
  /** Edit › Copy as / Paste as: the focused editor claims the gesture, else the preload's native fallback answers through the two invokes. */
  menuCopyAs: 'menu:copy-as',
  menuPasteAs: 'menu:paste-as',
  menuCopyText: invoke<[text: string], void>('menu:copy-text', 1),
  menuPasteTextFallback: invoke<[text: string], void>('menu:paste-text-fallback', 1),
} as const

/** A table's leaves become functions: an invoke resolves its answer, a push subscribes and returns the unsubscribe. */
export type Bridge<C> = {
  -readonly [K in keyof C]: C[K] extends Invoke<infer A, infer R> ? (...args: A) => Promise<R> : C[K] extends Push<infer T> ? (listener: (payload: T) => void) => () => void : Bridge<C[K]>
}

/**
 * `window.yaseenDocs` (locked in GRO-2153, Desktop A1): the table, plus the specials. Every invoke
 * rejects with a plain `BridgeError`; `client/src/api.ts` wraps it in `BridgeRequestError`.
 */
export type YaseenDocsApi = Bridge<typeof CONTRACT> & {
  /** One watcher per root in main (`fs/treeWatcher.ts`), shared by every window; late joiners get `ready` at once. */
  watch(root: string, listener: (ev: WatchEvent) => void): () => void
  window: {
    /** The close/quit flush handshake (GRO-2160): main holds the window until every listener settled (hard 5s cap in main). */
    onFlush(listener: () => Promise<void> | void): () => void
  }
  menu: {
    /** First focused editor returning a string claims copy; empty means no selection. */
    onCopyAs(listener: (mode: 'plain' | 'markdown') => string | undefined): () => void
    /** Explicit paste targets the focused editor; return true when handled. */
    onPasteAs(listener: (request: ClipboardPasteRequest) => boolean): () => void
  }
}

/**
 * Every `ipcMain.handle` answers with an envelope: Electron serialises a thrown Error down to its
 * message, so a structured `BridgeError` must travel as data. The preload unwraps it.
 */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: BridgeError }

export const isLeaf = (v: unknown): v is Invoke<unknown[], unknown> | Push<unknown> => typeof (v as { channel?: unknown }).channel === 'string'

/** Every door in `table` with its dotted name (`file.onRenamed`), depth first. */
export const leaves = (table: object, at = ''): Array<[name: string, door: Invoke<unknown[], unknown> | Push<unknown>]> =>
  Object.entries(table).flatMap(([key, v]) => (isLeaf(v) ? [[`${at}${key}`, v] as [string, typeof v]] : leaves(v as object, `${at}${key}.`)))
