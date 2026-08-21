/**
 * Shared client/server contracts for the local markdown editor.
 * Locked in GRO-1961 — see docs/CONTRACTS.md for the prose version.
 *
 * All paths are ABSOLUTE, POSIX-style (`/Users/...`). The server imposes no
 * jail: any absolute path on the machine may be read or written.
 */

// ---------- Errors ----------

export type ApiErrorCode =
  | 'BAD_REQUEST' // missing/invalid query or body (400)
  | 'NOT_ABSOLUTE' // path is not absolute (400)
  | 'NOT_FOUND' // path does not exist (404)
  | 'NOT_A_DIRECTORY' // expected a directory (400)
  | 'NOT_A_FILE' // expected a regular file (400)
  | 'UNSUPPORTED_EXTENSION' // file extension is neither markdown nor .base (400)
  | 'ALREADY_EXISTS' // create target already exists (409)
  | 'FORBIDDEN' // OS permission denied (403)
  | 'TOO_LARGE' // file exceeds MAX_FILE_BYTES (413)
  | 'IO_ERROR' // any other fs error (500)
  | 'PICKER_FAILED' // native folder dialog could not be run (500)
  | 'NOT_SUPPORTED' // endpoint not available on this platform (501)

export interface ApiError {
  error: {
    code: ApiErrorCode
    message: string
    /** The offending path, when relevant. */
    path?: string
  }
}

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const
/** Obsidian Bases files: YAML views over the vault's notes, first-class alongside markdown. */
export const BASE_EXTENSIONS = ['.base'] as const
export type FileKind = 'markdown' | 'base'
export const MAX_FILE_BYTES = 10 * 1024 * 1024

// ---------- GET /api/dirs?path=<abs|omitted> ----------

export interface DirEntry {
  name: string
  /** Absolute path of this directory. */
  path: string
}

export interface DirsResponse {
  /** Absolute path that was listed (defaults to the user's home dir when `path` omitted). */
  path: string
  /** Absolute path of the parent, or null at filesystem root. */
  parent: string | null
  /** Immediate child directories only (files excluded), sorted case-insensitively. Hidden (dot) dirs excluded. */
  dirs: DirEntry[]
}

// ---------- GET /api/tree?root=<abs> ----------

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
  /** Server time (epoch ms) when the tree was computed. */
  generatedAt: number
}

// ---------- GET /api/file?path=<abs> ----------

export interface FileResponse {
  path: string
  /** Raw UTF-8 file contents, byte-for-byte (frontmatter included; client splits it). */
  content: string
  mtime: number
  size: number
}

// ---------- PUT /api/file  body: FileWriteRequest ----------

export interface FileWriteRequest {
  path: string
  /** Full file contents to write (frontmatter already re-prepended by client). Written atomically (tmp + rename). */
  content: string
  /**
   * Optional optimistic-concurrency guard: the mtime the client last read.
   * If provided and the file's current mtime is newer, server responds 409 CONFLICT
   * (see FileWriteConflict) and does NOT write.
   */
  expectedMtime?: number
}

export interface FileWriteResponse {
  path: string
  mtime: number
  size: number
}

export interface FileWriteConflict {
  error: {
    code: 'CONFLICT'
    message: string
    path: string
    /** Current mtime on disk. */
    mtime: number
  }
}

// ---------- POST /api/create-dir  body: CreateDirRequest ----------

export interface CreateDirRequest {
  /** Absolute path of the directory to create; its parent must exist. */
  path: string
}

export interface CreateDirResponse {
  path: string
}

// ---------- POST /api/create-file  body: CreateFileRequest ----------

export interface CreateFileRequest {
  /**
   * Absolute path of the file to create; its parent must exist. `.md`/`.markdown` are created
   * empty; `.base` is seeded with the minimal valid base (`views:` + one table view named `Table`).
   */
  path: string
}

export interface CreateFileResponse {
  path: string
  mtime: number
  /** 0 for markdown; the seed's byte length for `.base`. */
  size: number
}

// ---------- POST /api/pick-folder ----------

/**
 * Opens the native macOS Finder "choose folder" dialog (osascript) and blocks until the user
 * picks a folder or cancels (5 min timeout). Non-macOS → 501 NOT_SUPPORTED; client falls back
 * to the in-app FolderPicker. Dialog failure → 500 PICKER_FAILED.
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

// ---------- GET /api/watch?root=<abs>  (Server-Sent Events) ----------

/**
 * SSE stream. Each message is `event: <WatchEvent['type']>` + `data: <JSON WatchEvent>`.
 * A `ready` event is sent once the watcher has completed its initial scan.
 * Server sends a `: ping` comment every 25s to keep the connection alive.
 */
export type WatchEvent =
  | { type: 'ready'; root: string }
  | { type: 'add'; path: string; mtime: number }
  | { type: 'change'; path: string; mtime: number }
  | { type: 'unlink'; path: string }
  | { type: 'addDir'; path: string }
  | { type: 'unlinkDir'; path: string }
  | { type: 'error'; message: string }

// ---------- localStorage (client only) ----------

export const LS_KEYS = {
  /** string: absolute path of the currently open root folder */
  root: 'mdapp.root',
  /** JSON RecentRoots */
  recentRoots: 'mdapp.recentRoots',
  /** JSON ExpandedState */
  expanded: 'mdapp.expanded',
  /** JSON LastFileState */
  lastFile: 'mdapp.lastFile',
  /** JSON FoldState */
  folds: 'mdapp.folds',
  /** 'true' when the sidebar is collapsed; absent = expanded (GRO-2023) */
  sidebarCollapsed: 'mdapp.sidebarCollapsed',
  /** JSON SettingsState (GRO-2024) */
  settings: 'mdapp.settings',
} as const

/** mdapp.recentRoots — most-recent first, max 10, de-duplicated. */
export type RecentRoots = Array<{ path: string; lastOpened: number }>

/** mdapp.expanded — keyed by root path; value is the list of expanded dir paths under that root. */
export type ExpandedState = Record<string, string[]>

/** mdapp.lastFile — keyed by root path; value is the absolute path of the last opened file. */
export type LastFileState = Record<string, string>

/**
 * mdapp.folds — keyed by root path, then by absolute file path; value is the list of collapsed
 * outline fold keys (see client `outlineFoldKeys.ts`), max MAX_FOLD_KEYS_PER_FILE. Files with no
 * folds are removed from the map. Never written to the markdown on disk.
 */
export type FoldState = Record<string, Record<string, string[]>>
export const MAX_FOLD_KEYS_PER_FILE = 500

/**
 * mdapp.settings — app-global editor preferences (GRO-2024). Applied as CSS custom
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
}

export const THREAD_WIDTHS: readonly number[] = [1, 2, 3]

/** Matches the app's pre-settings look (Crepe: line-height 1.5, block padding 4px); threading on, 2px, accent. */
export const DEFAULT_SETTINGS: SettingsState = {
  lineSpacing: 1.5,
  blockGap: 4,
  bulletThreading: true,
  threadWidth: 2,
  threadColor: null,
}

// ---------- App state (main-owned `yaseendocs.json`, D9 — GRO-2159) ----------

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

/** View state that only means something inside that folder (today's mdapp.expanded / lastFile / folds). */
export interface FolderState {
  expanded: string[]
  lastFile: string | null
  /** file → collapsed outline fold keys (max MAX_FOLD_KEYS_PER_FILE). Never written to the markdown. */
  folds: Record<string, string[]>
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

// ---------- Bridge: `window.yaseenDocs` (locked in GRO-2153, Desktop A1) ----------

/**
 * Every bridge promise rejects with a plain object satisfying `BridgeError` (the preload
 * unwraps the IPC envelope; `client/src/api.ts` wraps it in `ApiRequestError`). Same codes
 * and meanings as the HTTP era; `CONFLICT` carries the current on-disk `mtime`.
 */
export interface BridgeError {
  code: ApiErrorCode | 'CONFLICT'
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
  /** Merge into `folders[root]`; missing root entries are created with defaults. */
  setFolder(root: string, patch: Partial<Pick<FolderState, 'expanded' | 'lastFile'>>): Promise<void>
  /** Replace the fold keys for one file; an empty list removes the entry. */
  setFolds(root: string, file: string, keys: readonly string[]): Promise<void>
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
}

/**
 * The single typed surface the renderer uses for everything outside the DOM, installed by
 * the preload as `window.yaseenDocs` (`contextBridge`, `ipcMain.handle` on the main side).
 * Request/response shapes are the HTTP-era ones above, unchanged. Bases (GRO-2097) adds its
 * methods here (e.g. `index(root)`) — additive only.
 */
export interface YaseenDocsApi {
  tree(root: string): Promise<TreeResponse>
  readFile(path: string): Promise<FileResponse>
  writeFile(req: FileWriteRequest): Promise<FileWriteResponse>
  createDir(path: string): Promise<CreateDirResponse>
  createFile(path: string): Promise<CreateFileResponse>
  /** Native open-directory dialog parented to the calling window (GRO-2163). */
  pickFolder(): Promise<PickFolderResponse>
  /** One chokidar watcher per root in main, shared by every window; late joiners get `ready` at once. */
  watch(root: string, listener: (ev: WatchEvent) => void): () => void
  state: StateApi
  window: WindowApi
}
