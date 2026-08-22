/**
 * Shared renderer/main contracts for Yaseen Docs (locked in GRO-1961, bridge in GRO-2153) —
 * see docs/CONTRACTS.md for the prose version.
 *
 * All paths are ABSOLUTE, POSIX-style (`/Users/...`). The main process imposes no
 * jail: any absolute path on the machine may be read or written.
 */

// ---------- Errors ----------

export type BridgeErrorCode =
  | 'BAD_REQUEST' // missing/invalid argument
  | 'NOT_ABSOLUTE' // path is not absolute
  | 'NOT_FOUND' // path does not exist
  | 'NOT_A_DIRECTORY' // expected a directory
  | 'NOT_A_FILE' // expected a regular file
  | 'UNSUPPORTED_EXTENSION' // file extension is neither markdown nor .base
  | 'ALREADY_EXISTS' // create target already exists
  | 'FORBIDDEN' // OS permission denied
  | 'TOO_LARGE' // file exceeds MAX_FILE_BYTES
  | 'IO_ERROR' // any other fs error
  | 'PICKER_FAILED' // native folder dialog could not be run
  | 'INVALID_CONFIG' // a vault config file (e.g. .yaseendocs/types.json) is unusable; the mutation is refused, the file never touched

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const
/** Obsidian Bases files: YAML views over the vault's notes, first-class alongside markdown. */
export const BASE_EXTENSIONS = ['.base'] as const
export type FileKind = 'markdown' | 'base'
export const MAX_FILE_BYTES = 10 * 1024 * 1024

// ---------- tree(root) ----------

export type TreeNode =
  | {
      type: 'dir'
      name: string
      path: string
      children: TreeNode[]
    }
  | {
      type: 'file'
      name: string
      path: string
      /** Byte size. */
      size: number
      /** mtime in epoch ms. */
      mtime: number
      /** `markdown` for `.md`/`.markdown`, `base` for `.base` (see `shared/fileKind.ts`). */
      kind: FileKind
    }

export interface TreeResponse {
  root: string
  /** Recursive tree of the root. Only vault files (`.md`/`.markdown` → `kind: 'markdown'`, `.base` → `kind: 'base'`) are included; every directory shows, vault files or not (GRO-2022). Hidden (dot) entries and `node_modules` skipped. */
  tree: TreeNode[]
  /** Main-process time (epoch ms) when the tree was computed. */
  generatedAt: number
}

// ---------- Bases property index (GRO-2127; bridge method index(root) — Desktop D10) ----------

/** One markdown note as the Bases query engine sees it. `.base` files are never records. */
export interface IndexRecord {
  /** Absolute path. */
  path: string
  /** File name with extension. */
  name: string
  /** File name without extension. */
  basename: string
  /** Root-relative folder, '/' separators, '' at the root. */
  folder: string
  /** 'md' | 'markdown' (no dot). */
  ext: string
  size: number
  /** birthtime ms (ctime ms when the platform has no birthtime). */
  ctime: number
  mtime: number
  /** Parsed frontmatter; {} when absent or invalid (then `frontmatterError` is set). YAML core schema: dates stay strings. */
  properties: Record<string, unknown>
  frontmatterError?: string
  /** Frontmatter `tags`/`tag` + inline `#tags`; no leading '#'; nested 'a/b' kept; de-duplicated, order of first appearance. */
  tags: string[]
  /** `[[target]]` targets (`|alias` and `#heading` stripped) from body + frontmatter string values; embeds excluded. */
  links: string[]
  /** `![[target]]` targets. */
  embeds: string[]
}

export interface IndexResponse {
  root: string
  /** Every markdown note under `root` (dot-entries and `node_modules` skipped), sorted by path. */
  records: IndexRecord[]
  /** Main-process time (epoch ms) when this snapshot was taken. */
  generatedAt: number
  /** Assigned property types from `.obsidian/types.json` (5B, GRO-2142); absent when the vault has none. */
  types?: Record<string, string>
}

// ---------- readFile(path) ----------

export interface FileResponse {
  path: string
  /** Raw UTF-8 file contents, byte-for-byte (frontmatter included; client splits it). */
  content: string
  mtime: number
  size: number
}

// ---------- readAsset(root, ref) (Bases 4E, GRO-2139 — Desktop D10: bridge method, never a route) ----------

/** Allowed image extensions for `readAsset` (no dot); anything else rejects `UNSUPPORTED_EXTENSION`. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'] as const

export interface AssetResponse {
  /** Absolute path the ref resolved to. */
  path: string
  /** Mime type derived from the extension. */
  mime: string
  /** The file's bytes, base64-encoded (the renderer builds a `data:` URL). */
  data: string
  /** Byte size; capped at MAX_FILE_BYTES (above → `TOO_LARGE`). */
  size: number
}

// ---------- writeFile(req) ----------

export interface FileWriteRequest {
  path: string
  /** Full file contents to write (frontmatter already re-prepended by client). Written atomically (tmp + rename). */
  content: string
  /**
   * Optional optimistic-concurrency guard: the mtime the renderer last read.
   * If provided and the file's current mtime differs, the call rejects with a
   * `BridgeError` whose code is `CONFLICT` (carrying the disk `mtime`) and does NOT write.
   */
  expectedMtime?: number
}

export interface FileWriteResponse {
  path: string
  mtime: number
  size: number
}

// ---------- createDir(path) ----------

export interface CreateDirResponse {
  path: string
}

// ---------- createFile(path) ----------

export interface CreateFileResponse {
  path: string
  mtime: number
  /** 0 for markdown; the seed's byte length for `.base`. */
  size: number
}

// ---------- pickFolder() ----------

/**
 * Opens Electron's native open-directory dialog, parented to the calling window, and resolves
 * once the user picks a folder or cancels. Dialog failure → rejects `PICKER_FAILED`. One dialog
 * in flight per window: a call while that window's dialog is open resolves `{ cancelled: true }`.
 */
export type PickFolderResponse =
  | {
      /** Absolute path of the chosen folder, without trailing slash. */
      path: string
    }
  | {
      /** The user dismissed the dialog. */
      cancelled: true
    }

// ---------- watch(root, listener) ----------

/**
 * Delivered to the listener for as long as the subscription lives. A `ready` event is sent
 * once the watcher has completed its initial scan (at once for late joiners of a shared root).
 */
export type WatchEvent =
  | { type: 'ready'; root: string }
  | { type: 'add'; path: string; mtime: number }
  | { type: 'change'; path: string; mtime: number }
  | { type: 'unlink'; path: string }
  | { type: 'addDir'; path: string }
  | { type: 'unlinkDir'; path: string }
  | { type: 'error'; message: string }

// ---------- App state (main-owned `yaseendocs.json`, D9 — GRO-2159) ----------

/** `AppState.recents` — most-recent first, max MAX_RECENT_ROOTS, de-duplicated. */
export type RecentRoots = Array<{ path: string; lastOpened: number }>
export const MAX_RECENT_ROOTS = 10

/** Pure: prepend `path` to the MRU list, de-duplicated, capped — shared by the client cache and the main store. */
export function addRecentRoot(list: RecentRoots, path: string, now: number): RecentRoots {
  return [{ path, lastOpened: now }, ...list.filter((r) => r.path !== path)].slice(0, MAX_RECENT_ROOTS)
}

/** Collapsed outline fold keys per file (see client `outlineFoldKeys.ts`) are capped at this many. */
export const MAX_FOLD_KEYS_PER_FILE = 500

/** Collapsed group keys per base view (Bases 4C, GRO-2137) are capped at this many. */
export const MAX_COLLAPSED_GROUP_KEYS = 200

/**
 * `AppState.settings` — app-global editor preferences (GRO-2024). Applied as CSS custom
 * properties on the app container; never written into the markdown on disk.
 */
export interface SettingsState {
  /** Line height within a block (Google-Docs-style presets). */
  lineSpacing: number
  /** Vertical padding above and below each block, px (spacing between blocks = 2×). */
  blockGap: number
  /** Accent the root → caret bullet path (GRO-2094). View-only; never written into the file. */
  bulletThreading: boolean
  /** Thread line width in px: 1 | 2 | 3, like logseq-bullet-threading (GRO-2109). */
  threadWidth: number
  /** Custom thread colour as `#rrggbb`, or null = the app accent (GRO-2109). */
  threadColor: string | null
  /** Appearance (Desktop K, GRO-2218): explicit values win; `system` tracks the OS live. */
  theme: Theme
}

export const THREAD_WIDTHS: readonly number[] = [1, 2, 3]

/** Obsidian's Appearance vocabulary and order — also exactly Electron's `nativeTheme.themeSource`. */
export type Theme = 'system' | 'light' | 'dark'
export const THEMES: readonly Theme[] = ['system', 'light', 'dark']

/** Matches the app's pre-settings look (Crepe: line-height 1.5, block padding 4px); threading on, 2px, accent. */
export const DEFAULT_SETTINGS: SettingsState = {
  lineSpacing: 1.5,
  blockGap: 4,
  bulletThreading: true,
  threadWidth: 2,
  threadColor: null,
  theme: 'system',
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** One open window; restored on relaunch (GRO-2160). `root` null = Welcome screen. */
export interface WindowEntry {
  id: string
  root: string | null
  file: string | null
  bounds: WindowBounds
}

/** View state that only means something inside that folder (the retired localStorage mdapp.expanded / lastFile / folds). */
export interface FolderState {
  expanded: string[]
  lastFile: string | null
  /** file → collapsed outline fold keys (max MAX_FOLD_KEYS_PER_FILE). Never written to the markdown. */
  folds: Record<string, string[]>
  /** `<basePath>::<viewName>` → collapsed group keys (max MAX_COLLAPSED_GROUP_KEYS). Never written to the `.base` file (GRO-2137). */
  baseGroups: Record<string, string[]>
}

/**
 * The whole persisted app state — one user-global JSON file, owned by the main process
 * (`~/Library/Application Support/Yaseen Docs/yaseendocs.json`). Settings are global so
 * they apply to every folder and travel to another machine by copying this one file.
 */
export interface AppState {
  version: 1
  settings: SettingsState
  sidebarCollapsed: boolean
  /** Most-recent first, max 10, de-duplicated. */
  recents: RecentRoots
  windows: WindowEntry[]
  folders: Record<string, FolderState>
}

/** A fresh default state (a factory, so no caller can mutate a shared constant). */
export function defaultAppState(): AppState {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, sidebarCollapsed: false, recents: [], windows: [], folders: {} }
}

export function defaultFolderState(): FolderState {
  return { expanded: [], lastFile: null, folds: {}, baseGroups: {} }
}

// ---------- Vault-local config (`<root>/.yaseendocs/`, Desktop J — GRO-2188) ----------

/**
 * Pushed to every window after a config file under `<root>/.yaseendocs/` changes — an own
 * `vaultConfig.write` or an external edit (sync tools). Renderers filter by their own root,
 * the same posture as `state:changed`, and re-read the named file.
 */
export interface VaultConfigChange {
  root: string
  /** Config file name inside `.yaseendocs/`, e.g. `types.json`. */
  name: string
}

/**
 * Per-vault config in `<root>/.yaseendocs/` — the Obsidian-`.obsidian/` analogue: travels with
 * the folder. Created lazily on first write; reading never creates it. The folder is invisible
 * everywhere (tree/sidebar, vault index, shared watcher).
 */
export interface VaultConfigApi {
  /** Parsed `<root>/.yaseendocs/<name>`, or null when the folder/file is missing or the JSON is malformed. */
  read(root: string, name: string): Promise<unknown>
  /** Creates `.yaseendocs/` on first write; atomic tmp+rename; pretty-printed JSON. `name` must be a plain `<stem>.json`. */
  write(root: string, name: string, value: unknown): Promise<void>
  /** Fired in every window after any vault's config change; returns an unsubscribe. */
  onChange(listener: (change: VaultConfigChange) => void): () => void
}

// ---------- Type & property registry (`<root>/.yaseendocs/types.json` — contract locked on GRO-2120, bridge Bible A GRO-2201) ----------

/**
 * The editor set that exists (5B's `EditorKind`) plus the link/multi-link split. An unknown
 * `kind` string on disk is preserved there and read back as `text` (forward compat).
 */
export const REGISTRY_PROPERTY_KINDS = ['text', 'number', 'date', 'checkbox', 'list', 'link', 'multi-link'] as const
export type RegistryPropertyKind = (typeof REGISTRY_PROPERTY_KINDS)[number]

export interface RegistryPropertyDef {
  kind: RegistryPropertyKind
  /** link/multi-link only: constrain the picker to pages whose page_type equals this type name. */
  target?: string
  /** Metadata for the future validation report (report-never-block: gates nothing in v1). */
  required?: boolean
}

export interface RegistryTypeDef {
  displayName?: string
  pluralName?: string
  /** Root-relative folder for new entities of this type. Browsing sugar only — never enforced. */
  folder?: string
  properties: Record<string, RegistryPropertyDef>
}

export interface RegistryResponse {
  root: string
  /** The file's `version` (1 when the file is absent or unusable). >1 = readable, not mutable. */
  version: number
  types: Record<string, RegistryTypeDef>
  /** Vault-wide declarations for columns made outside a typed base — see the GRO-2120 contract §4. */
  properties: Record<string, RegistryPropertyDef>
  /** Set when types.json exists but is unusable; types/properties are then {}. */
  error?: string
}

/** Where a property definition lives: a type's schema, or the vault-wide map. */
export type RegistryScope = { type: string } | 'vault'

/**
 * The registry surface delivered as `window.yaseenDocs.registry` (GRO-2120 contract §2).
 * Targeted mutators, never a whole-file PUT — the `StateApi` anti-clobber principle. Every
 * mutation is a serialised read-modify-write that preserves unknown fields at every level.
 * Type names must match `^[a-z][a-z0-9-]*$`, property names `^[a-z][a-z0-9_]*$`; `page_type`
 * is the identity property, never a declared one (→ `BAD_REQUEST`). A corrupt or newer-versioned
 * types.json rejects every mutation with `INVALID_CONFIG` and is never overwritten or moved aside.
 */
export interface RegistryApi {
  /** Empty registry (no error) when .yaseendocs/types.json does not exist; never creates anything. */
  get(root: string): Promise<RegistryResponse>
  /** Upsert a type (merge: absent fields keep their stored values; properties replaces whole-map only when given). */
  setType(root: string, name: string, def: Partial<RegistryTypeDef>): Promise<void>
  removeType(root: string, name: string): Promise<void>
  /** Upsert one property def in a type's schema or the vault-wide map. Creates the dotfolder/file/type entry on demand. */
  setProperty(root: string, scope: RegistryScope, name: string, def: RegistryPropertyDef): Promise<void>
  removeProperty(root: string, scope: RegistryScope, name: string): Promise<void>
  /** Fired in every window of that root after any change, internal or external. Returns an unsubscribe. */
  onChange(listener: (registry: RegistryResponse) => void): () => void
}

// ---------- Bridge: `window.yaseenDocs` (locked in GRO-2153, Desktop A1) ----------

/**
 * Every bridge promise rejects with a plain object satisfying `BridgeError` (the preload
 * unwraps the IPC envelope; `client/src/api.ts` wraps it in `BridgeRequestError`).
 * `CONFLICT` carries the current on-disk `mtime`.
 */
export interface BridgeError {
  code: BridgeErrorCode | 'CONFLICT'
  message: string
  path?: string
  mtime?: number
}

export interface WindowIdentity {
  id: string
  root: string | null
  file: string | null
}

export interface OpenWindowOptions {
  root: string | null
  file: string | null
}

/** Targeted mutators (not a generic patch) so several windows never lose each other's writes. */
export interface StateApi {
  get(): Promise<AppState>
  setSettings(settings: SettingsState): Promise<void>
  setSidebarCollapsed(collapsed: boolean): Promise<void>
  /** Prepend to recents (de-duplicated, capped). */
  pushRecent(path: string): Promise<void>
  /** Drop a folder from recents (its directory vanished on disk, C2 — GRO-2164); unknown path is a no-op. */
  removeRecent(path: string): Promise<void>
  /** Merge into `folders[root]`; missing root entries are created with defaults. */
  setFolder(root: string, patch: Partial<Pick<FolderState, 'expanded' | 'lastFile'>>): Promise<void>
  /** Replace the fold keys for one file; an empty list removes the entry. */
  setFolds(root: string, file: string, keys: readonly string[]): Promise<void>
  /** Replace the collapsed group keys for one base view (`<basePath>::<viewName>`); an empty list removes the entry. */
  setBaseGroups(root: string, key: string, collapsed: readonly string[]): Promise<void>
  /** Fired in every window after any change; returns an unsubscribe. */
  onChange(listener: (state: AppState) => void): () => void
}

export interface WindowApi {
  /** Who am I: main answers from `AppState.windows` by the `?win=<id>` in the window's URL. */
  identity(): Promise<WindowIdentity>
  /** Record this window's current folder/file (the window manager persists it). */
  setIdentity(patch: Partial<Pick<WindowIdentity, 'root' | 'file'>>): Promise<void>
  open(opts: OpenWindowOptions): Promise<void>
  /** `⌘⇧N`: same folder, same file, new window (GRO-2167). */
  duplicate(): Promise<void>
  /**
   * The close/quit flush handshake (GRO-2160): main is about to close this window and holds it
   * until every registered listener settled (hard 5s cap in main). Returns an unsubscribe.
   */
  onFlush(listener: () => Promise<void> | void): () => void
}

/**
 * Menu gestures from the main process (B3, GRO-2161): the renderer owns root switching at
 * runtime, so File › Open Folder… / Open Recent land on the focused window's renderer.
 */
export interface MenuApi {
  /** File › Open Folder… (⌘⇧O) targeted this window: run the pick-folder flow. Returns an unsubscribe. */
  onOpenFolder(listener: () => void): () => void
  /** File › Open Recent chose `path` for this window: switch the root in place. Returns an unsubscribe. */
  onOpenRoot(listener: (path: string) => void): () => void
}

/**
 * Deep links (E1, GRO-2171): main parses a `yaseendocs://` URL (`shared/links.ts`) and routes
 * it to the best window; these are the pushes the routed-to renderer receives.
 */
export interface LinkApi {
  /** A link resolved to this window: open `path` (guaranteed inside this window's root). Returns an unsubscribe. */
  onOpenFile(listener: (path: string) => void): () => void
  /** A link could not be opened (bad URL, not markdown, missing file): show `message` unobtrusively. Returns an unsubscribe. */
  onNotice(listener: (message: string) => void): () => void
}

/**
 * The single typed surface the renderer uses for everything outside the DOM, installed by
 * the preload as `window.yaseenDocs` (`contextBridge`, `ipcMain.handle` on the main side).
 * Request/response shapes are the ones above. Bases (GRO-2097) adds its methods here
 * (e.g. `index(root)`) — additive only.
 */
export interface YaseenDocsApi {
  tree(root: string): Promise<TreeResponse>
  readFile(path: string): Promise<FileResponse>
  writeFile(req: FileWriteRequest): Promise<FileWriteResponse>
  createDir(path: string): Promise<CreateDirResponse>
  createFile(path: string): Promise<CreateFileResponse>
  /** Bases property index for `root` (GRO-2129): full scan on first call, watcher-incremental after. */
  index(root: string): Promise<IndexResponse>
  /**
   * Local image for the cards view (GRO-2139): `ref` is a wikilink target or path (`|alias` /
   * `#heading` stripped) — root-relative when it has a `/`, else Obsidian's shortest-path rule
   * (case-insensitive basename, first match in a deterministic walk). Images only (IMAGE_EXTENSIONS).
   */
  readAsset(root: string, ref: string): Promise<AssetResponse>
  /** Native open-directory dialog parented to the calling window (GRO-2163). */
  pickFolder(): Promise<PickFolderResponse>
  /** One chokidar watcher per root in main, shared by every window; late joiners get `ready` at once. */
  watch(root: string, listener: (ev: WatchEvent) => void): () => void
  state: StateApi
  window: WindowApi
  menu: MenuApi
  link: LinkApi
  /** Vault-local config in `<root>/.yaseendocs/` (Desktop J, GRO-2188). */
  vaultConfig: VaultConfigApi
  /** Type & property registry over `.yaseendocs/types.json` (Bible A, GRO-2201). */
  registry: RegistryApi
}
