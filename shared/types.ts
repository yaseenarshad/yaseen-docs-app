/**
 * Shared renderer/main contracts for Yaseen Docs (locked in GRO-1961, bridge in GRO-2153) —
 * see docs/CONTRACTS.md for the prose version.
 *
 * All paths are ABSOLUTE, POSIX-style (`/Users/...`). The main process imposes no
 * jail: any absolute path on the machine may be read or written.
 */

import type { ReviewEntry } from './reviews'

// ---------- Errors ----------

export type BridgeErrorCode =
  | 'BAD_REQUEST' // missing/invalid argument
  | 'NOT_ABSOLUTE' // path is not absolute
  | 'NOT_FOUND' // path does not exist
  | 'NOT_A_DIRECTORY' // expected a directory
  | 'NOT_A_FILE' // expected a regular file
  | 'UNSUPPORTED_EXTENSION' // file extension is not supported by the requested capability
  | 'ALREADY_EXISTS' // create target already exists
  | 'FORBIDDEN' // OS permission denied
  | 'TOO_LARGE' // file exceeds MAX_FILE_BYTES
  | 'IO_ERROR' // any other fs error
  | 'PICKER_FAILED' // native folder dialog could not be run
  | 'INVALID_CONFIG' // a vault config file (e.g. .yaseendocs/properties.json) is unusable; the mutation is refused, the file never touched

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const
export const TEXT_VIEW_EXTENSIONS = [
  '.txt',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonc',
  '.jsonl',
  '.ndjson',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml',
  '.env',
  '.properties',
  '.lock',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.swift',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.sql',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
  '.graphql',
  '.gql',
  '.mdx',
  '.rst',
  '.tex',
] as const
export const PDF_EXTENSIONS = ['.pdf'] as const
export const IMAGE_VIEW_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
} as const
export const IMAGE_VIEW_EXTENSIONS = Object.freeze(Object.keys(IMAGE_VIEW_MIME)) as readonly (keyof typeof IMAGE_VIEW_MIME)[]

/** The file kinds the app can open in-app; only `markdown` is writable and semantic. A file of no kind still lists (YAZ-1577). */
export type FileKind = 'markdown' | 'text' | 'pdf' | 'image'
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PDF_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024

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
      /** Preview classification (`shared/fileKind.ts`); `null` = listed, but no in-app viewer (YAZ-1577 D1). */
      kind: FileKind | null
    }

/**
 * Liveness for the coalesced tree reads (YAZ-2191): main's one-walk-per-root and the renderer's
 * one tree feed both queue a caller behind the read in flight. A read that hangs (a network volume
 * gone away) must not hold every later caller forever, so one in flight longer than this is
 * bypassed: the caller reads on its own, exactly as every read did before coalescing, and a
 * volume that recovers answers again. Far above any real walk (42 ms at 10k notes).
 */
export const STALE_FLIGHT_MS = 10_000

export interface TreeResponse {
  root: string
  /** Recursive tree of the root. Supported markdown/text/PDF/image files are included; every directory shows, supported files or not (GRO-2022). Hidden (dot) entries and `node_modules` skipped. */
  tree: TreeNode[]
  /** Main-process time (epoch ms) when the tree was computed. */
  generatedAt: number
}

// ---------- Bases property index (GRO-2127; bridge method index(root) — Desktop D10) ----------

/** One markdown note as the Bases query engine sees it. */
export interface IndexRecord {
  /** Absolute path. */
  path: string
  /** Frontmatter `id` when it is a note id (`shared/noteId.ts`, YAZ-2293): the note's permanent identity. Absent when it has none. */
  id?: string
  /** File name with extension. */
  name: string
  /** File name without extension. */
  basename: string
  /** What the app shows (YAZ-2420 🔒 D14): the frontmatter `title`, else `basename` — for a folder's settings file, the folder's own name. */
  title: string
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
  /**
   * Frontmatter `aliases`: extra NAMES this note answers to (Links E2, GRO-2214). List items, or
   * a scalar string as ONE alias (never comma-split, unlike `tags`); trimmed, empties and
   * non-strings dropped, de-duplicated. Resolved after path/root-relative/basename, so a real
   * name always wins. Alias values are never outgoing `links`.
   */
  aliases: string[]
  /** Frontmatter `tags`/`tag` + inline `#tags`; no leading '#'; nested 'a/b' kept; de-duplicated, order of first appearance. */
  tags: string[]
  /** `[[target]]` targets (`|alias` and `#heading` stripped) from body + frontmatter string values; embeds excluded. */
  links: string[]
  /** `![[target]]` targets. */
  embeds: string[]
  /** The note's review log (`shared/reviews.ts`, YAZ-2322), `at` ascending; absent when never reviewed. When it is next due is computed, never stored. */
  reviews?: ReviewEntry[]
  /** `textFingerprint` of the body: a review records the one it saw, so the body counts as changed when they differ. Absent when the file was not read. */
  text?: string
}

export interface IndexResponse {
  root: string
  /** Every markdown note under `root` (dot-entries and `node_modules` skipped), sorted by path. */
  records: IndexRecord[]
  /** Every folder's settings file (`FOLDER_SETTINGS_FILE`, YAZ-2290 D8), sorted by path; never in `records`. */
  folders: IndexRecord[]
  /** Main-process time (epoch ms) when this snapshot was taken. */
  generatedAt: number
}

// ---------- coldDiff(root) (Links E1c, GRO-2242) ----------

/** How the persistent index cache loaded at cold start (`desktop/src/main/vaultIndex/cache.ts`). */
export type IndexCacheStatus = 'hit' | 'miss' | 'corrupt' | 'version-mismatch'

/** One file's identity stats in a `ColdStartDiffResponse` — the (size, mtime) rename join key. */
export interface DiffFileStat {
  /** Absolute path. */
  path: string
  /** Byte size. */
  size: number
  /** mtime in epoch ms. */
  mtime: number
}

/**
 * What changed between the persistent index cache and the disk at cold start — the E1c
 * external-rename detection feed (GRO-2242). `removed` carries the CACHED stats and `added`
 * the ON-DISK ones, so an external rename/move (which preserves size + mtime) joins them 1:1.
 * Honest miss semantics: on any `cacheStatus` other than `'hit'` there was no before-snapshot,
 * so all three lists are EMPTY (never "everything added") and `cacheStatus` says why —
 * consumers MUST gate on `cacheStatus === 'hit'` before trusting them.
 */
export interface ColdStartDiffResponse {
  root: string
  /** Epoch ms when the reconcile ran. */
  scannedAt: number
  cacheStatus: IndexCacheStatus
  /** On disk but not in the cache; ON-DISK stats. Sorted by path. */
  added: DiffFileStat[]
  /** In the cache but no longer on disk; CACHED stats. Sorted by path. */
  removed: DiffFileStat[]
  /** Present in both but mtime or size moved (re-scanned). Sorted. */
  changed: string[]
}

// ---------- readFile(path) ----------

export interface FileResponse {
  path: string
  /** UTF-8 file contents; Markdown includes frontmatter and supported view-only text is strictly decoded. */
  content: string
  mtime: number
  size: number
}

/** Dedicated binary response for the native PDF viewer; never base64-encoded or sent through `readFile`. */
export interface PdfResponse {
  path: string
  data: Uint8Array
  mtime: number
  size: number
}

/** Dedicated exact-path binary response for the static raster-image viewer. */
export interface ImageResponse {
  path: string
  data: Uint8Array
  mime: (typeof IMAGE_VIEW_MIME)[keyof typeof IMAGE_VIEW_MIME]
  mtime: number
  size: number
}

// ---------- readAsset(root, ref) / writeAsset(req) (Bases 4E, GRO-2139 — Desktop D10: bridge methods, never routes) ----------

/**
 * The image extensions the asset pipe serves (no dot): `readAsset`, the `app://vault` image
 * protocol (YAZ-1658) and a byte `writeAsset` (YAZ-1661); anything else rejects
 * `UNSUPPORTED_EXTENSION` (or, over the protocol, 404s).
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'] as const

/**
 * Drawing sidecars the asset pipe reads AND writes (Excalidraw embed, YAZ-852 / YAZ-876): scene
 * JSON standing on its own in the vault (`assets/drawings/` by default), a note holding only
 * `![[<name>.excalidraw]]`. Deliberately unsupported by the shared file classifier, so the
 * Files tree, supported-file watcher and Markdown index all omit it; it rides this pipe alone.
 */
export const DRAWING_EXTENSIONS = ['excalidraw'] as const

export interface AssetResponse {
  /** Absolute path the ref resolved to. */
  path: string
  /** Mime type derived from the extension (`application/json` for a drawing). */
  mime: string
  /** The file's bytes, base64-encoded (the renderer builds a `data:` URL, or decodes scene JSON). */
  data: string
  /** Byte size; capped at MAX_FILE_BYTES (above → `TOO_LARGE`). */
  size: number
  /**
   * Disk mtime at the moment of the read — `writeAsset`'s `expectedMtime` guard, from the door
   * that read the bytes (YAZ-879: the drawing modal loads here and saves back through that guard,
   * and a read with no mtime would have left the save with nothing honest to guard on).
   */
  mtime: number
}

/**
 * `writeAsset` — the write half of the asset pipe (YAZ-876). Drawings landed first and images
 * were deliberately NOT widened then; YAZ-1656 (images as first-class citizens, D5) reverses
 * that: THE BODY'S TYPE PICKS THE FILE KIND — bytes → an `IMAGE_EXTENSIONS` path, a string →
 * a `DRAWING_EXTENSIONS` path, any other pairing `UNSUPPORTED_EXTENSION`.
 */
export interface AssetWriteRequest {
  /** Vault root; the resolved target must sit under it (else `BAD_REQUEST`). */
  root: string
  /** The asset's vault-relative path (absolute under `root` also accepted). Never a basename search — writes are never fuzzy. */
  path: string
  /** Scene JSON as UTF-8 (a drawing), or the raw bytes of an image (YAZ-1656); above MAX_FILE_BYTES → `TOO_LARGE`. */
  content: string | Uint8Array
  /** Optimistic-concurrency guard, `writeFile`'s exactly: a differing disk mtime rejects `CONFLICT` and nothing is written. */
  expectedMtime?: number
  /** Create mode (`createFile`'s `wx`): an existing target rejects `ALREADY_EXISTS` and is never overwritten. */
  create?: boolean
}

export interface AssetWriteResponse {
  path: string
  mtime: number
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

// ---------- createDir(req) ----------

/** `createDir` takes `{ path, title }`: the title its `.folder.md` is born holding (YAZ-2420 🔒 D6). */
export interface CreateDirRequest {
  path: string
  /** The folder's title; omitted → a `.folder.md` holding only its `id`. */
  title?: string
}

export interface CreateDirResponse {
  path: string
}

// ---------- createFile(req) ----------

/**
 * `createFile` takes the bare path or `{ path, content }` (Bible B, GRO-2202): when `content`
 * is given it lands in the same atomic `wx` write — content-at-create, so scaffolded pages and
 * starter bases keep the never-overwrite guarantee without a create-then-write race.
 */
export interface CreateFileRequest {
  path: string
  /** Initial file contents; omitted → a file holding only its `id`. */
  content?: string
  /** The note id to be born with (YAZ-2293), for a caller that needs it before the file exists; omitted → a fresh one. */
  id?: string
}

export interface CreateFileResponse {
  path: string
  mtime: number
  /** The created file's byte length. */
  size: number
  /** The note id written into the file's frontmatter; absent when the seed's frontmatter would not parse. */
  id?: string
}

// ---------- file.rename(req) (Links E1 + E1b, GRO-2194 / GRO-2241) ----------

/**
 * In-app rename/move. Files rename in place or move between folders (extension KIND
 * unchanged: md↔md, base↔base); directories rename/move too (`kind: 'dir'` in the
 * response — no extension rules, dot-dirs and the calling window's own vault root are
 * refused `BAD_REQUEST`). The target's parent must already exist (`NOT_FOUND` — never a
 * mkdir). Never overwrites: an existing target rejects `ALREADY_EXISTS`. The same handler
 * repairs every stored path reference — for a dir, everything at or UNDER it: window
 * roots/files/tabs, recents, folder-state keys and their expanded/lastFile/fold/base-group
 * entries — and pushes `file:renamed` to every window.
 */
export interface RenameFileRequest {
  oldPath: string
  newPath: string
}

export interface RenameFileResponse {
  oldPath: string
  newPath: string
  /** What moved: a single file, or a directory (E1b — renderers then remap by prefix). */
  kind: 'file' | 'dir'
}

// ---------- file.retitle(req) (YAZ-2420) ----------

/**
 * A title edit (🔒 D16), for a note or a folder: `title` is written to its frontmatter (a folder's
 * `.folder.md`), then it is renamed to the name built from that title. Answers as a rename does,
 * with `newPath` equal to `oldPath` when the built name is the one it has; a path that changed is
 * repaired and pushed exactly as `file.rename`'s is.
 */
export interface RetitleRequest {
  path: string
  title: string
}

/** Pushed to EVERY window after a successful in-app rename; renderers remap their own tabs (a `dir` event remaps every tab under the old prefix). */
export interface FileRenamedEvent {
  oldPath: string
  newPath: string
  kind: 'file' | 'dir'
}

// ---------- file clipboard (YAZ-1674) ----------

/**
 * Cut / Copy from the sidebar (YAZ-1674, D1): the ONE app-wide clipboard lives in main, so a
 * paste in any window — on the same vault or another — takes what any window cut or copied.
 * `paths` is the ORDERED selection (one row, or the whole multi-select), absolute; `op` decides
 * what a later paste does (D2: a cut MOVES through the rename pipeline and pastes once; a copy
 * COPIES and pastes again and again). Session-only, never persisted. Rejects `BAD_REQUEST` for
 * a missing/unknown `op` or an empty `paths`, `NOT_ABSOLUTE` for a relative entry.
 */
export interface FileClipRequest {
  paths: string[]
  op: 'copy' | 'cut'
}

/**
 * `clip:changed` — pushed to EVERY window after every clipboard change: how many, which verb, and
 * the paths as main holds them (absolute, de-duplicated, ordered), so a window can say what
 * pasting a Cut would move (D21); null when empty (the menu's disabled "Paste").
 */
export type FileClipState = { count: number; op: 'copy' | 'cut'; paths: string[] } | null

/** Paste the clipboard INTO this folder (D5: a dir row → itself, a file row → its parent, blank space → the vault root). Must exist — never created. */
export interface PasteRequest {
  targetDir: string
}

/**
 * Per-entry outcome of a paste (D3): every clipboard entry lands in exactly one of the two
 * lists, in clipboard order — except a cut entry already in `targetDir`, which is skipped
 * silently (nothing to do). A copy that clashes takes Finder's next free name (`Note copy.md`,
 * `Note copy 2.md`; folders keep the whole name); a cut that clashes fails `ALREADY_EXISTS`.
 * A cut across volumes fails `IO_ERROR` ("cannot move across disks; copy it instead"); a
 * stale entry `NOT_FOUND`; a hidden source or a folder into itself `BAD_REQUEST`.
 */
export interface PasteResponse {
  pasted: { from: string; to: string; kind: 'file' | 'dir' }[]
  failed: { from: string; code: BridgeErrorCode; message: string }[]
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

/** A vault display name (YAZ-1974 D3) is cut to this many characters (code points, so an emoji is never split). */
export const MAX_VAULT_NAME = 80

/** A display name as stored (YAZ-1974 D3): trimmed and capped; empty or not a string → null (= the folder name). */
export function cleanVaultName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = [...raw.trim()].slice(0, MAX_VAULT_NAME).join('')
  return name === '' ? null : name
}

/** Entries in a vault's `.yaseendocs/favorites.json` (YAZ-1766 D2, in the vault since 6A/D11) are capped at this many on read and write. */
export const MAX_FAVORITES = 500

/**
 * `WindowEntry.sidebarLens` — which lens the sidebar's chrome-v2 ROW 1 tabs show (YAZ-847):
 * `files` (the file explorer) or `favorites` (the pinned files and folders, YAZ-1766 D1 — the
 * tab right of Files).
 * Window identity like `sidebarCollapsed` since YAZ-1628 (global, like `sidebarWidth`, from
 * YAZ-847 until then): the tabs are not per-folder view state, so there is no per-root keying
 * and no `FolderState` entry. Default `DEFAULT_SIDEBAR_LENS` (`files` since YAZ-1846) — a
 * pre-847 state file simply gains it, and a pre-1628 file's retired global value seeds every
 * window that has none of its own. A state file that still names the retired `topics` lens reads
 * as the default one, and its two retired keys are ignored on load (`store.ts`).
 */
export type SidebarLens = 'files' | 'favorites'
/** The tabs' order, left→right — independent of the default lens (🔒 D3, YAZ-1846). */
export const SIDEBAR_LENSES: readonly SidebarLens[] = ['files', 'favorites']
/** The lens a brand-new window, and a switch to a different vault, opens on (🔒 D1/D2, YAZ-1846). */
export const DEFAULT_SIDEBAR_LENS: SidebarLens = 'files'
export const isSidebarLens = (v: unknown): v is SidebarLens => SIDEBAR_LENSES.includes(v as SidebarLens)

/** `AppState.sidebarWidth` — the drag-to-resize bounds (YAZ-738), clamped on every write and on load. */
export const SIDEBAR_MIN_W = 180
export const SIDEBAR_MAX_W = 520
export const SIDEBAR_DEFAULT_W = 260

/** Per-window right-panel geometry. Width persists even while the panel is hidden. */
export const RIGHT_PANEL_MIN_W = 320
export const RIGHT_PANEL_MAX_W = 720
export const RIGHT_PANEL_DEFAULT_W = 440
/** Main workspace width reserved before the right panel switches to temporary overlay mode. */
export const MAIN_WORKSPACE_MIN_W = 360

export interface RightPanelIdentity {
  open: boolean
  width: number
  /** Absolute page paths in visible header order; disjoint from the window's main `tabs`. */
  items: string[]
  /** The one expanded right item, or null when all headers are collapsed. */
  expanded: string | null
}

export function defaultRightPanelIdentity(): RightPanelIdentity {
  return { open: false, width: RIGHT_PANEL_DEFAULT_W, items: [], expanded: null }
}

/** Global content-width presets, ordered exactly as shown in Settings (YAZ-1176). */
export const CONTENT_WIDTHS = ['narrow', 'medium', 'full'] as const
export type ContentWidth = (typeof CONTENT_WIDTHS)[number]

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
  /** Global reading surface width (YAZ-1176): 1040px, 1440px, or fluid within the workspace. */
  contentWidth: ContentWidth
  /** Files & Links (Links C2-, GRO-2240): where a BARE unresolved `[[link]]` creates its page. */
  newNoteLocation: NewNoteLocation
  /** Root-relative folder for `newNoteLocation: 'folder'` ('' = the vault root); ignored otherwise. Interpreted per-vault against each window's root. */
  newNoteFolder: string
  /**
   * Show the confirm sheet before deleting (GRO-2272 — VS Code's `explorer.confirmDelete`).
   * Defaults TRUE and should stay that way: the sheet is the ONLY guard on delete, because
   * `shell.trashItem` has no programmatic undo, so there is no in-app restore to fall back
   * on. Cleared from the sheet's own "Don't ask me again" and re-enabled from the settings
   * cog — a one-way switch would leave hand-editing `yaseendocs.json` as the only way back.
   */
  confirmDelete: boolean
  /** Comment stream order (YAZ-1515): how you READ, global, never part of a note. */
  commentsOrder: CommentsOrder
}

export const THREAD_WIDTHS: readonly number[] = [1, 2, 3]

/** Obsidian's Appearance vocabulary and order — also exactly Electron's `nativeTheme.themeSource`. */
export type Theme = 'system' | 'light' | 'dark'
export const THEMES: readonly Theme[] = ['system', 'light', 'dark']

/**
 * Obsidian's "Default location for new notes" options and order (Links C2-, GRO-2240):
 * vault folder · same folder as current file · the folder named in `newNoteFolder`.
 */
export type NewNoteLocation = 'root' | 'current' | 'folder'
export const NEW_NOTE_LOCATIONS: readonly NewNoteLocation[] = ['root', 'current', 'folder']

/** Comment stream order (YAZ-1515): oldest-first (the model's order) or newest-first by the ROOT's `at`. */
export type CommentsOrder = 'oldest' | 'newest'
export const COMMENTS_ORDERS: readonly CommentsOrder[] = ['oldest', 'newest']

/**
 * Valid `newNoteFolder`: '' (the vault root) or root-relative — no leading/trailing `/`, no
 * empty segments, and no segment create-on-click would refuse: leading-`.` names (hidden —
 * subsumes `.` and `..`) and NUL. The segment rules mirror `validateEntryName` in
 * `client/src/sidebar/createEntry.ts`, which `createFromLink` runs over every segment at
 * click time; `shared/` cannot import from `client/`, so the rule is replicated — keep the
 * two in step (GRO-2197: `.archive` used to save cleanly here, then fail EVERY create).
 */
export function isValidNewNoteFolder(v: string): boolean {
  return v === '' || v.split('/').every((s) => s.trim() !== '' && !s.trim().startsWith('.') && !s.includes('\0'))
}

/** Matches the app's pre-settings look (Crepe: line-height 1.5, block padding 4px); threading on, 2px, accent; new notes beside the source page (YAZ-1643). */
export const DEFAULT_SETTINGS: SettingsState = {
  lineSpacing: 1.5,
  blockGap: 4,
  bulletThreading: true,
  threadWidth: 2,
  threadColor: null,
  theme: 'system',
  contentWidth: 'narrow',
  newNoteLocation: 'current',
  newNoteFolder: '',
  confirmDelete: true,
  commentsOrder: 'oldest',
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One open window; restored on relaunch (GRO-2160). `root` null = Welcome screen.
 *
 * Tabs (GRO-2232): `tabs` is every open file as absolute paths, de-duplicated, ordered
 * left→right; `file` doubles as the ACTIVE tab — there is no separate activeTab field.
 * Invariants: `file ∈ tabs` whenever `file` is non-null, and `tabs: []` ⇔ `file: null`
 * (the no-tabs state). Deliberately additive within `AppState.version` 1 — bumping the
 * version would make `sanitizeState` treat every existing store file as corrupt. An old
 * build's field-by-field sanitizer silently drops the unknown `tabs` key and falls back
 * to `file` (graceful downgrade); this build repairs a missing `tabs` from `file`.
 */
export interface WindowEntry {
  id: string
  root: string | null
  file: string | null
  tabs: string[]
  rightPanel: RightPanelIdentity
  /** Whether this window's sidebar is hidden (YAZ-1280); independent from every other window. */
  sidebarCollapsed: boolean
  /**
   * Which sidebar lens THIS window shows (YAZ-847; per window since YAZ-1628, `sidebarCollapsed`'s
   * rule): independent from every other window — a duplicate inherits it and then diverges — and
   * kept across a root change, being a view preference rather than vault content. A pre-1628
   * file's retired global value seeds every window that has none of its own.
   */
  sidebarLens: SidebarLens
  /**
   * Focus Mode (YAZ-1605; per window since YAZ-1628): the directories THIS window's Files tree
   * is narrowed to — one or several (a shift-selection) — or empty for the whole vault. Window
   * identity like `sidebarCollapsed`, so a second window on the same vault focuses on its own:
   * a duplicate inherits the list by value and then diverges, a root change clears it. A flat
   * list of absolute paths, so `store.renamePath` / `store.removePath` repair it as they repair
   * `tabs` — a renamed focus follows its folder, a deleted one drops out.
   */
  focusDirs: string[]
  /** Its Favorites twin (YAZ-1766 D5): the favorited DIRS this window's Favorites tab is narrowed to, or empty. */
  focusFavorites: string[]
  bounds: WindowBounds
}

/**
 * View state that only means something inside that folder (the retired localStorage mdapp.expanded / lastFile / folds).
 * `expanded` is a SESSION list (YAZ-1642): shared by every window on the
 * vault through the main-owned store, never written to disk and never restored — a launch starts
 * the tree collapsed. The other fields persist.
 */
export interface FolderState {
  expanded: string[]
  lastFile: string | null
  /** file → collapsed outline fold keys (max MAX_FOLD_KEYS_PER_FILE). Never written to the markdown. */
  folds: Record<string, string[]>
  /** `<pagePath>::<viewName>` → collapsed group keys (max MAX_COLLAPSED_GROUP_KEYS). Session chrome, never written to the page's own card (GRO-2137). */
  baseGroups: Record<string, string[]>
  /** The vault's display name (YAZ-1974 D3) when this bucket's root is a vault; null = its folder name. Persisted, per machine. */
  name: string | null
}

/** What `state.setFolder` may merge into a bucket — every other field has its own targeted mutator. */
export type FolderPatch = Partial<Pick<FolderState, 'expanded' | 'lastFile' | 'name'>>

/**
 * The whole persisted app state — one user-global JSON file, owned by the main process
 * (`~/Library/Application Support/Yaseen Docs/yaseendocs.json`). Settings are global so
 * they apply to every folder and travel to another machine by copying this one file.
 */
export interface AppState {
  version: 1
  settings: SettingsState
  /** Sidebar width in px, within [SIDEBAR_MIN_W, SIDEBAR_MAX_W]. */
  sidebarWidth: number
  /** Most-recent first, max 10, de-duplicated. */
  recents: RecentRoots
  windows: WindowEntry[]
  folders: Record<string, FolderState>
}

/** A fresh default state (a factory, so no caller can mutate a shared constant). */
export function defaultAppState(): AppState {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, sidebarWidth: SIDEBAR_DEFAULT_W, recents: [], windows: [], folders: {} }
}

export function defaultFolderState(): FolderState {
  return { expanded: [], lastFile: null, folds: {}, baseGroups: {}, name: null }
}

// ---------- Vault-local config (`<root>/.yaseendocs/`, Desktop J — GRO-2188) ----------

/**
 * The `.obsidian/`-style dotfolder that travels with a vault, and THE one definition of its name
 * (YAZ-861): main joins paths under it.
 */
export const VAULT_CONFIG_DIR = '.yaseendocs'

/**
 * A folder's own settings, `<folder>/.folder.md`: frontmatter only (YAZ-2290 D1). The one dot-entry
 * the index and the watcher see (D8); the Files tree never lists it.
 */
export const FOLDER_SETTINGS_FILE = '.folder.md'

/** The settings file of the folder at `dir`. */
export const folderSettingsPath = (dir: string): string => `${dir}/${FOLDER_SETTINGS_FILE}`

/** Whether `folder` is `ancestor` or under it. Both absolute, or both as the index names folders: root-relative, '' the root, which holds every folder. */
export const inFolder = (folder: string, ancestor: string): boolean => ancestor === '' || folder === ancestor || folder.startsWith(`${ancestor}/`)

/** Whether `path` is a folder's settings file, either separator. */
export const isFolderSettingsPath = (path: string): boolean => path.split(/[\\/]/).at(-1) === FOLDER_SETTINGS_FILE

/**
 * Pushed to every window after a config file under `<root>/.yaseendocs/` changes — an own
 * `vaultConfig.write` or an external edit (sync tools). Renderers filter by their own root,
 * the same posture as `state:changed`, and re-read the named file.
 */
export interface VaultConfigChange {
  root: string
  /** Config file name inside `.yaseendocs/`, e.g. `properties.json`. */
  name: string
}

// ---------- GitHub sync (`<root>/.yaseendocs/github.json` — YAZ-1081) ----------

/**
 * The per-vault sync switch (YAZ-1081 D4), stored as `<root>/.yaseendocs/github.json` so it
 * travels with the folder like every other vault-local setting. OFF by default and off for any
 * shape that isn't exactly `{ enabled: true }` — a vault someone copies onto a second machine
 * therefore syncs there too, and a corrupt or hand-edited file fails closed rather than starting
 * background git work nobody asked for.
 */
export interface GithubSyncConfig {
  enabled: boolean
}

/**
 * Why a root is stuck, when it is. Each value is a DIFFERENT thing to say to the user, which is
 * the whole reason the set is closed: `no-git` wants "install git" (the Command Line Tools on a Mac, Git for Windows on a PC),
 * `no-identity` wants "set a name and email", `auth` wants "sign in again", `conflict` wants
 * "two machines edited the same lines" (the lossless rule: the working tree was put back exactly
 * as it was — see `git/sync.ts`), and `error` is the honest catch-all that carries a message.
 */
export type GithubSyncAttention = 'no-git' | 'no-identity' | 'auth' | 'conflict' | 'error'

/**
 * What a vault's sync is doing right now — one object per root, pushed on every transition.
 *
 * `off` is not a failure: it is a vault with sync disabled, or one that is not a repo, or a repo
 * with no `origin`. `pending` means "there is work to do and it will happen" — edits waiting out
 * the quiet period (D2 cadence) or a pass that found the network down and armed a retry — so it
 * is the one non-terminal state the UI should show as calm rather than alarming.
 */
export interface GithubSyncStatus {
  root: string
  state: 'off' | 'synced' | 'pending' | 'syncing' | 'attention'
  attention?: GithubSyncAttention
  message?: string
  /** Read-only repo facts for the settings panel; absent when they could not be read at all. */
  repo?: { remoteUrl: string | null; branch: string | null }
  /**
   * Whether the per-vault SWITCH is on — i.e. the manager is running this root. Distinct from
   * `state: 'off'`, which also covers not-a-repo and no-remote: a vault the user just enabled
   * that has no remote yet is `enabled: true` + `state: 'off'`, and the settings switch reads
   * THIS field so it never contradicts the click that set it. Stamped by the manager; absent
   * on statuses that never passed through it (a bare `syncPass` call in tests).
   */
  enabled?: boolean
}

// ---------- Vault-wide property declarations (`<root>/.yaseendocs/properties.json` — YAZ-835) ----------

/**
 * The editor set that exists (5B's `EditorKind`) plus the link/multi-link split. An unknown
 * `kind` string on disk is preserved there and read back as `text` (forward compat).
 */
export const PROPERTY_KINDS = ['text', 'number', 'date', 'checkbox', 'list', 'link', 'multi-link', 'select', 'multi-select'] as const
export type PropertyKind = (typeof PROPERTY_KINDS)[number]

/**
 * Property-name grammar (GRO-2200 R4): snake_case. Enforced at the properties write boundary
 * (`desktop/src/main/properties/`) — one definition so no mirror can drift from it.
 */
export const PROPERTY_NAME = /^[a-z][a-z0-9_]*$/

/**
 * Folder-name grammar (GRO-2226, GRO-2204 audit fold-in): root-relative, '/'-separated
 * plain segments — no leading '/', no drive-like prefix, no '\' or NUL, and no '..' or other
 * leading-dot segments (dotfolders are invisible to the tree; '..' could aim a create outside
 * the vault). A STORED folder outside this grammar still reads — report-don't-block: use sites
 * treat it as absent, a vault is never refused over it.
 */
export const FOLDER_NAME = /^(?![A-Za-z]:)[^\\\0/.][^\\\0/]*(?:\/[^\\\0/.][^\\\0/]*)*$/

/** One declared property: what kind of editor it gets, and what a link points at. */
export interface PropertyDecl {
  kind: PropertyKind
  /** Ordered exact labels for Select and Multi-select; note values remain ordinary YAML strings/lists. */
  options?: string[]
  /** Display order; omitted means manual. The options array retains its manual order. */
  optionSort?: 'manual' | 'ascending' | 'descending'
  /** link/multi-link only: the picker constraint — a wikilink to a FOLDER ("the notes in [[X]]", resolved by belongsToBasenames; YAZ-2290 D10). */
  target?: string
  /** Metadata for the future validation report (report-never-block: gates nothing in v1). */
  required?: boolean
}

export interface PropertiesResponse {
  root: string
  /** The file's `version` (1 when the file is absent or unusable). >1 = readable, not mutable. */
  version: number
  /** Vault-wide declarations, keyed by bare frontmatter key. */
  properties: Record<string, PropertyDecl>
  /** Set when properties.json exists but is unusable; `properties` is then {}. */
  error?: string
}

// ---------- Favorites (`<root>/.yaseendocs/favorites.json` — YAZ-1766 6A, D11) ----------

/** The file on disk: VAULT-RELATIVE POSIX paths in the user's order (`MAX_FAVORITES` at most). */
export interface FavoritesConfig {
  version: 1
  favorites: string[]
}

// ---------- Bridge payloads: `window.yaseenDocs` itself is `CONTRACT` in shared/ipc.ts (GRO-2153, YAZ-2200) ----------

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

/** Reveal in Finder (GRO-2274): the absolute path to show in the OS file manager. */
export interface RevealRequest {
  path: string
}

/** Reveal in Finder (GRO-2274): echoes the revealed path. */
export interface RevealResponse {
  path: string
}

/** Standard Markdown link intent; main validates and resolves it before any OS side effect. */
export interface OpenLinkRequest {
  href: string
  /** Absolute current-note path, required only when `href` is relative. */
  sourcePath?: string
}

/** In-app delete (GRO-2272): the absolute path of the entry to move to the system Trash. */
export interface DeleteRequest {
  path: string
}

/** In-app delete (GRO-2272): what moved to the system Trash. */
export interface DeleteResponse {
  path: string
  kind: 'file' | 'dir'
}

/** `file:deleted` — pushed to EVERY window after a successful delete (GRO-2272). */
export interface FileDeletedEvent {
  path: string
  kind: 'file' | 'dir'
}

export interface WindowIdentity {
  id: string
  root: string | null
  file: string | null
  /** Open tabs left→right (GRO-2232); `file` is the active one (same invariants as `WindowEntry.tabs`). */
  tabs: string[]
  rightPanel: RightPanelIdentity
  /** Whether this window's sidebar is hidden (YAZ-1280). */
  sidebarCollapsed: boolean
  /** Which sidebar lens this window shows (YAZ-847, per window since YAZ-1628). */
  sidebarLens: SidebarLens
  /** Focus Mode's lists (YAZ-1605, per window since YAZ-1628; Favorites' own since YAZ-1766): the same two as `WindowEntry`'s. */
  focusDirs: string[]
  focusFavorites: string[]
}

export interface OpenWindowOptions {
  root: string | null
  file: string | null
}

/** Clipboard text captured when the user chooses an explicit paste mode. */
export interface ClipboardPasteRequest {
  mode: 'plain' | 'markdown'
  text: string
}

/** One ⌘+ / ⌘− / ⌘0 press: up, down, or back to the default (YAZ-1710). */
export type ZoomStep = -1 | 0 | 1

