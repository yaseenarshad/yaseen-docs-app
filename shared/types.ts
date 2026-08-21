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
  | 'NOT_MARKDOWN' // file extension not in MARKDOWN_EXTENSIONS (400)
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
    }

export interface TreeResponse {
  root: string
  /** Recursive tree of the root. Only `.md`/`.markdown` files are included; every directory shows, markdown or not (GRO-2022). Hidden (dot) entries and `node_modules` skipped. */
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
  /** Absolute path of the markdown file to create (empty); its parent must exist. */
  path: string
}

export interface CreateFileResponse {
  path: string
  mtime: number
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
