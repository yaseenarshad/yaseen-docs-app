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
  | 'UNSUPPORTED_TYPE' // YAZ-3038 (Draw's 🔒 YAZ-1775 D4): a media provider answered with something that is not an image
  | 'PROVIDER_FAILED' // Draw's 🔒 YAZ-1775 D4 (YAZ-3038 media, YAZ-3040 sharing): a media provider, Cloudflare or the share Worker was REACHED and refused, or answered nonsense
  | 'OFFLINE' // Draw's 🔒 YAZ-1775 D4 (YAZ-3038 media, YAZ-3040 sharing): the provider, Cloudflare or the share Worker could not be reached at all — a passive state in the UI, never an error banner
  | 'NOT_SET_UP' // Draw's YAZ-1799 (YAZ-3040): sharing is not set up on this computer yet (Settings › Sharing)

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

/** An Excalidraw drawing opened as a document in a tab (YAZ-3028 D2, Draw's YAZ-1810). */
export const DRAWING_VIEW_EXTENSIONS = ['.excalidraw'] as const
/** A draw.io diagram opened as a document in a tab (YAZ-3028 D2, Draw's YAZ-1802). `.drawio.svg` / `.drawio.png` stay unsupported, as in Draw. */
export const DIAGRAM_EXTENSIONS = ['.drawio'] as const

/**
 * The file kinds the app can open in-app (YAZ-1289, widened by YAZ-3028 D2). `markdown`, `drawing`
 * and `diagram` are writable; only `markdown` is semantic. A file of no kind still lists (YAZ-1577).
 */
export type FileKind = 'markdown' | 'text' | 'pdf' | 'image' | 'drawing' | 'diagram'
/** The two board kinds (YAZ-3028 D2): each has its own load and save doors, never `fs:write`. */
export type BoardKind = Extract<FileKind, 'drawing' | 'diagram'>
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PDF_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024
/**
 * A board's read and write ceiling (Draw's YAZ-1810): a LEGACY scene embeds its images as base64 and
 * is routinely past 10 MiB. The cap refuses a file that has stopped being a document; a diagram's
 * pictures live inside its XML, so it shares the drawing's ceiling.
 */
export const MAX_DRAWING_BYTES = 200 * 1024 * 1024
export const MAX_DIAGRAM_BYTES = MAX_DRAWING_BYTES

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
  /** Frontmatter `id` when it is a note id (`shared/noteId.ts`, YAZ-2293): the note's permanent identity, as the app writes it (YAZ-2677 R2: `YAZ-12`, or an old 12-character ID). Absent when it has none. */
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
  /**
   * Does this vault give its notes IDs (YAZ-2523 🔒 V5)? True only when its `ids.json` says yes.
   * When false no record carries an `id`, and each one's `title` is its file name (🔒 V12).
   */
  ids: boolean
  /**
   * Only when `ids`: the vault's ID letters (YAZ-2677 R9), the current ones first and then each it
   * had before (`was`). Every record's `id` is an ID of THIS vault and, when it is a number ID,
   * carries the current letters (R5); `vaultNoteId` reads a typed or linked ID with this list.
   */
  letters?: string[]
  /**
   * Only while the vault's answer is not yes, so for one that said no too (YAZ-2677 🔒 D2): what a
   * yes would write (🔒 V2). `notes` would be given an id, `foreign` of them over another tool's
   * `id`; `folders` would be given a `.folder.md`, or an `id` in the one they have.
   */
  ask?: { notes: number; folders: number; foreign: number; /** The ID letters the vault's `ids.json` already holds (YAZ-2677 S9): the box asks for these. None: the user chooses them (S5). */ letters?: string }
  /** Only when `ids`: a run of "Give old IDs numbers" stopped with files left, and its plan is in the vault (YAZ-2677 🔒 D6, S90): a second run finishes it. */
  unfinished?: true
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

// ---------- readHeads(paths) (YAZ-2648 D6) ----------

/** How many bytes of a note `readHeads` reads off disk: room for the frontmatter block and the head under it. */
export const HEAD_READ_BYTES = 8192
/** How much of a note's body `readHeads` answers with, in UTF-16 units: the first lines of a page of the tab board. */
export const HEAD_CHARS = 600

/** The top of one note, for its page of the tab board (YAZ-2648 D6). */
export interface FileHead {
  path: string
  mtime: number
  /** The first `HEAD_CHARS` of the body, the frontmatter block off; '' when the block alone fills the bytes read. */
  text: string
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
 * `![[<name>.excalidraw]]`. Since YAZ-3028 D2 the same file is also the `drawing` FileKind: the
 * Files tree lists it and a tab opens it through `drawing:load` / `drawing:save`. The Markdown
 * index still omits it, and a note embed still rides this pipe (the modal, rule 28).
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

// ---------- drawing:* / diagram:* / fs:create-board (YAZ-3028 D2, ported from Draw's YAZ-1810 / YAZ-1802) ----------

/**
 * The two dates every board main writes carries (Draw's 🔒 YAZ-1834 D1): a drawing's first key
 * `{ "yaseendraw": { createdAt, updatedAt } }`, a diagram's two `yaseendraw-*` attributes on its
 * root `<mxfile>`. Set by main only. Rules and readers: `shared/drawingAssets.ts`, `shared/diagramFile.ts`.
 */
export interface BoardMeta {
  /** Epoch ms. Born on create or on the first save of a board without one; never rewritten once it is a finite number. */
  createdAt: number
  /** Epoch ms of the last in-app save. */
  updatedAt: number
}

/**
 * One image the canvas holds, as it crosses the bridge: the engine's own mime plus a base64
 * `data:` URL. Deliberately NOT the engine's `BinaryFileData`: the bridge must not depend on a
 * renderer package, and `created` / `lastRetrieved` are the engine's bookkeeping, not the file's.
 */
export interface DrawingFileEntry {
  mimeType: string
  /** `data:<mime>;base64,<payload>` — the only form either side accepts. */
  dataURL: string
}

export interface DrawingLoadRequest {
  /** Vault root; the document must resolve inside it. */
  root: string
  /** The document, vault-relative or absolute under `root`. Never a basename search. */
  path: string
  /**
   * For a PICTURE of the scene, never an editor (Draw's 🔒 YAZ-2073 D6): the longest side, in pixels,
   * of the image the scene is drawn into. Each picture then comes back no bigger than it can appear.
   */
  imageMaxPx?: number
}

export interface DrawingLoadResponse {
  /** Absolute path that was read — what every later save addresses. */
  path: string
  /** The file's bytes as UTF-8 text, exactly as on disk — except that a LEGACY scene's embedded `files` map comes back empty: those bytes travel once, in `files`. */
  json: string
  /** Disk mtime of the read: the `expectedMtime` the first save goes back with. */
  mtime: number
  size: number
  /** Every image the scene still references and whose bytes were found, keyed by `fileId`. An id with no bytes is absent: the engine draws its placeholder. */
  files: Record<string, DrawingFileEntry>
  /** The subset of `files` that came from the `assets/` store; the renderer never ships these back. */
  stored: string[]
}

/** One image a save must land in the store before the scene that names it is written. */
export interface DrawingNewFile extends DrawingFileEntry {
  /** Excalidraw's own content id (the SHA-1 of the bytes) — the file's name under `assets/`. */
  fileId: string
}

export interface DrawingSaveRequest {
  root: string
  path: string
  /** The serialized scene. Written verbatim but for the store's own `files: {}` rewrite and the date stamp. */
  json: string
  /** The mtime the renderer last read or wrote; a differing disk mtime rejects `CONFLICT` and writes NOTHING — assets included. */
  expectedMtime?: number
  /** Images the store does not have yet. Written first, so the scene on disk never names bytes that are missing. */
  newFiles: DrawingNewFile[]
}

export interface DrawingSaveResponse {
  path: string
  mtime: number
  size: number
  /** The ids now on disk — the renderer adds them to its persisted set so it never ships them twice. */
  persisted: string[]
}

export interface DiagramLoadRequest {
  /** Vault root; the document must resolve inside it. */
  root: string
  /** The `.drawio`, vault-relative or absolute under `root`. */
  path: string
}

export interface DiagramLoadResponse {
  /** Absolute path that was read. */
  path: string
  /** The file's XML exactly as it sits on disk (compressed pages included — draw.io inflates them). */
  xml: string
  mtime: number
  size: number
}

export interface DiagramSaveRequest {
  root: string
  path: string
  /** The document as draw.io serialised it: plain `<mxfile>` XML (Draw's 🔒 YAZ-1802 D3). */
  xml: string
  /** A differing disk mtime rejects `CONFLICT` and writes NOTHING. */
  expectedMtime?: number
}

export interface DiagramSaveResponse {
  path: string
  mtime: number
  size: number
}

/**
 * `fs:create-board` (YAZ-3028 D9): a NEW drawing or diagram, born with its empty content. Main picks
 * the content by the kind of `path` — the renderer sends none — stamps the dates, and never
 * overwrites (`ALREADY_EXISTS`). No note ID: IDs are for notes only.
 */
export interface CreateBoardRequest {
  /** Vault root; `path` must resolve inside it. */
  root: string
  /** The new `.excalidraw` or `.drawio`, absolute under `root`. Its parent must exist. */
  path: string
}

export interface CreateBoardResponse {
  path: string
  mtime: number
  size: number
}

/**
 * `fs:board-head` (YAZ-3028 D11): a board's Info, off its file head — one open, a 1 KB read, one
 * `fstat`. Docs' tree carries no dates and does not refresh on a save, so the Info popover asks.
 */
export interface BoardHeadResponse {
  path: string
  mtime: number
  size: number
  /** The board's own dates, or null when it has none yet (the next save writes them). */
  meta: BoardMeta | null
}

/**
 * File › Export Drawing… (Draw's 🔒 YAZ-1775 D3, YAZ-1821; ported by YAZ-3028): the native SAVE sheet
 * and the write behind it, ONE door — a standalone `.excalidraw`, every image embedded, written
 * wherever the user picks. A renderer never holds an arbitrary path it may write to: the only path
 * written is the one the user just typed into the sheet. The vault file is not touched.
 */
export interface SaveDrawingRequest {
  /** The name the sheet opens on, extension included (`<board name>.excalidraw`). */
  defaultName: string
  /** The bytes to write, atomically (tmp + rename), once the user has picked. */
  content: string
}

/** Where the file landed, or `{ cancelled: true }` when the sheet was dismissed and nothing was written. */
export type SaveDrawingResponse = { path: string } | { cancelled: true }

/**
 * `dialog.openDrawing()` (YAZ-3038, Draw's YAZ-1833): the native OPEN-FILE dialog, filtered to
 * `.excalidraw`, for the Components tab's "Import". It answers the BYTES and not just a path: the file
 * an import reaches for is outside the vault, and the renderer has no door that reads an arbitrary
 * absolute path. The read is bounded by `MAX_DRAWING_BYTES`, as `drawing:load` is.
 */
export type OpenDrawingResponse =
  | {
      /** Absolute path of the chosen file. */
      path: string
      /** Its base name WITHOUT the `.excalidraw` extension — what an import names the component. */
      name: string
      /** Its UTF-8 bytes. */
      content: string
    }
  | { cancelled: true }

/**
 * File › Export Image… for a draw.io diagram (YAZ-3028, Draw's 🔒 YAZ-1802 D9): `SaveDrawingRequest`'s
 * one-door rule with a PNG / SVG sheet. The picked name's extension decides which of the two pictures
 * is written, so both arrive with the request, already drawn.
 */
export interface SaveImageRequest {
  /** The name the sheet opens on, extension included (`<diagram name>.png`). */
  defaultName: string
  /** The picture as a `data:image/png;base64,` URL. */
  png: string
  /** The same picture as a `data:image/svg+xml;base64,` URL. */
  svg: string
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

/**
 * What Settings shows about the IDs of a vault that uses them (YAZ-2677 🔒 D5, D6), counted by the
 * main process from its index. A folder's settings file counts like a note.
 */
export interface IdsState {
  /** The vault's ID letters now; the default of its folder's name while its `ids.json` holds none (R11). */
  letters: string
  /** Notes that hold a number ID: what "Change letters" changes (S80). */
  notes: number
  /** Notes that still have letters the vault had before, in their ID, in an ID they name or in their file name (S83). */
  stale: number
  /** Notes that hold an old 12-character ID (S88). */
  old: number
  /** A run of "Give old IDs numbers" stopped with files left (`IndexResponse.unfinished`, S90). */
  unfinished: boolean
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

/** Trailing slash off (never off `/` itself), so `/v` and `/v/` name the same root. */
export const stripSlash = (p: string): string => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)

/** A window shows this many vaults at most (YAZ-2602 R7): each one holds a watcher and an index. */
export const MAX_WINDOW_ROOTS = 8

/**
 * The vault-list invariant (YAZ-2602 D1), shared by the loader, the IPC boundary and the client cache:
 * `root` is the FIRST entry, the rest follow in their order with the trailing slash off, a vault
 * appears once, the list is cut at MAX_WINDOW_ROOTS, and `root: null` ⇔ `[]`.
 */
export function normalizeRoots(roots: readonly string[], root: string | null): string[] {
  if (root === null) return []
  const seen = new Set([stripSlash(root)])
  const out = [root]
  for (const r of roots) {
    const vault = stripSlash(r)
    if (seen.has(vault)) continue
    seen.add(vault)
    out.push(vault)
  }
  return out.slice(0, MAX_WINDOW_ROOTS)
}

/** The vault of `roots` that holds `path` (or is it) — the most specific one, by segment; null when none does (YAZ-2602). */
export function rootOfPath(roots: readonly string[], path: string): string | null {
  let best: string | null = null
  for (const root of roots) {
    const r = stripSlash(root)
    if (path !== r && !path.startsWith(r === '/' ? '/' : `${r}/`)) continue
    if (best === null || r.length > stripSlash(best).length) best = root
  }
  return best
}

/** The same SET of vaults (YAZ-2602 D8, S65): the order and a trailing slash do not count, and a vault counts once. */
export function sameVaults(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a.map(stripSlash))
  const right = new Set(b.map(stripSlash))
  return left.size === right.size && [...left].every((vault) => right.has(vault))
}

/** Last path segment (trailing slashes ignored); the input itself for `/`. The client's `lib/paths` hands it on; it is here so `listVaults` and `keyedVaults` name a folder the same way (YAZ-2556). */
export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || p
}

/**
 * The open vaults (YAZ-2555 D1): every vault of every window (YAZ-2602 D6), once per vault, Welcome
 * windows (no vault) left out. `listVaults` reads it for the vault switcher's list; main's door (`openRecentBeside`) has its own filter
 * over the live windows, and both compare roots through `stripSlash`.
 */
export function openVaultRoots(windows: readonly { roots: readonly string[] }[]): string[] {
  const roots: string[] = []
  for (const w of windows) {
    for (const vault of w.roots) {
      const root = stripSlash(vault)
      if (!roots.includes(root)) roots.push(root)
    }
  }
  return roots
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

/** A vault's number (YAZ-2555 D2): a whole number 1–9, else null. */
export function cleanVaultKey(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 9 ? raw : null
}

/** A vault that has a number (YAZ-2555 D2), as the Window menu and the "Set shortcut" flyout list it: `name` is its display name, else its folder name. */
export interface KeyedVault {
  key: number
  path: string
  name: string
}

/**
 * The vaults that have a number, in number order (YAZ-2555 D2). ONE function since YAZ-2556: the
 * Window menu's rows (`menuKeyedVaults`), the "Set shortcut" flyout (`storage.keyedVaults`) and
 * `listVaults` all call it, so the three cannot name or order a numbered vault differently.
 */
export function keyedVaults(folders: Readonly<Record<string, FolderState>>): KeyedVault[] {
  return Object.entries(folders)
    .flatMap(([path, folder]) => (folder.key === null ? [] : [{ key: folder.key, path, name: folder.name ?? basename(path) }]))
    .sort((a, b) => a.key - b.key)
}

/** Entries in a vault's `.yaseendocs/favorites.json` (YAZ-1766 D2, in the vault since 6A/D11) are capped at this many on read and write. */
export const MAX_FAVORITES = 500
/** A vault's focus list (YAZ-2619; in the vault since YAZ-2702) holds at most this many paths, on read and write. */
export const MAX_FOCUS = 500
/**
 * The Favorites order across vaults (YAZ-2631 D1) holds at most this many paths: MAX_FAVORITES for each of MAX_WINDOW_ROOTS vaults.
 * The focus order across vaults (`AppState.focusOrder`, YAZ-2702 Decision 3) has the same limit: MAX_FOCUS is MAX_FAVORITES.
 */
export const MAX_FAVORITES_ORDER = 4000

/**
 * The Favorites order across vaults once a window hands in `paths` for the vaults `roots` (YAZ-2631
 * R5): after a drag, its favorites in their new order, for the vaults whose list it has read (R25);
 * after a remove, the stored order without the removed paths (R23). The paths take the places the
 * entries of `roots` held, a path with no place goes last, and an entry of a vault that is not in
 * `roots` keeps its place. Main merges with it and the renderer's cache does too, so both hold one
 * answer. `stored` itself when nothing changes. The focus order across vaults (`AppState.focusOrder`,
 * YAZ-2702 Decision 3) is merged by this same function: one rule for the two lists.
 */
export function mergeFavoritesOrder(stored: string[], roots: readonly string[], paths: readonly string[]): string[] {
  const mine = new Set(paths)
  const fresh = [...mine]
  let taken = 0
  // One path for each place a window's entry held; a place with no path left for it closes.
  const placed = stored.flatMap((path) => (mine.has(path) ? (taken < fresh.length ? [fresh[taken++]] : []) : rootOfPath(roots, path) === null ? [path] : []))
  const next = [...placed, ...fresh.slice(taken)].slice(0, MAX_FAVORITES_ORDER)
  return next.length === stored.length && next.every((path, at) => path === stored[at]) ? stored : next
}

/**
 * `WindowEntry.sidebarLens` — which lens the sidebar's chrome-v2 ROW 1 tabs show (YAZ-847):
 * `files` (the file explorer), `focus` (the focus lists of the window's vaults, YAZ-2619, in the
 * vault since YAZ-2702 — the tab between the two) or `favorites` (the pinned files and folders, YAZ-1766 D1).
 * Window identity like `sidebarCollapsed` since YAZ-1628 (global, like `sidebarWidth`, from
 * YAZ-847 until then): the tabs are not per-folder view state, so there is no per-root keying
 * and no `FolderState` entry. Default `DEFAULT_SIDEBAR_LENS` (`files` since YAZ-1846) — a
 * pre-847 state file simply gains it, and a pre-1628 file's retired global value seeds every
 * window that has none of its own. A state file that still names the retired `topics` lens reads
 * as the default one, and its two retired keys are ignored on load (`store.ts`).
 */
export type SidebarLens = 'files' | 'focus' | 'favorites'
/** The tabs' order, left→right — independent of the default lens (🔒 D3, YAZ-1846). */
export const SIDEBAR_LENSES: readonly SidebarLens[] = ['files', 'focus', 'favorites']
/** The lens a brand-new window, and a switch to a different vault, opens on (🔒 D1/D2, YAZ-1846). */
export const DEFAULT_SIDEBAR_LENS: SidebarLens = 'files'
export const isSidebarLens = (v: unknown): v is SidebarLens => SIDEBAR_LENSES.includes(v as SidebarLens)
/** The tabs of the sidebar's row 1 (YAZ-2638 D2): the lenses, and Search — a tab that is never stored. */
export type SidebarTab = SidebarLens | 'search'
/** The order the tabs are drawn in: Search stands right after Files. */
export const SIDEBAR_TABS: readonly SidebarTab[] = ['files', 'search', 'focus', 'favorites']

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
// ---------- Canvas preferences (Draw's 🔒 YAZ-1775 D9, ported by YAZ-3028) ----------

/**
 * The user-level canvas preferences held in `SettingsState.canvas` (ported from Draw by YAZ-3028; the Settings › Canvas page, YAZ-3037): the engine's
 * `browser: true, export: false` appState (`packages/excalidraw/appState.ts`) plus frame
 * visibility. The TYPE and the DEFAULTS live in this leaf file; the mapping to and from the
 * engine's appState keys is `shared/canvasPrefs.ts`, which imports from here so that nothing
 * downstream of the mapping has to know about the engine.
 *
 * WHY here and not in the engine's own localStorage (the web app's answer): the engine package
 * does not persist appState, so grid / tool lock / zen would reset on every mount, be invisible
 * to the settings cog, and differ per window. One store, broadcast to every window, is the rule.
 */
export const SELECT_ON_MODES = ['wrap', 'overlap'] as const
export type SelectOn = (typeof SELECT_ON_MODES)[number]
/** The engine's roughness presets (`ROUGHNESS`): architect 0, artist 1, cartoonist 2. */
export const ROUGHNESS_LEVELS = [0, 1, 2] as const
export type Roughness = (typeof ROUGHNESS_LEVELS)[number]
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const
export type TextAlign = (typeof TEXT_ALIGNS)[number]

/**
 * The laser's own settings (🔒 YAZ-1989 D1), in the fork's spelling so the mapping is a straight
 * copy; the first of each list is the stock laser and the default. `canvasPrefsEngine.test.ts`
 * pins the lists and defaults to the vendored engine's exports.
 */
export const LASER_TRAIL_MODES = ['fade', 'hold', 'sticky'] as const
export type LaserTrailMode = (typeof LASER_TRAIL_MODES)[number]
export const LASER_COLORS = ['#ff0000', '#ffd400', '#00c853', '#2979ff', '#d500f9'] as const
export type LaserColor = (typeof LASER_COLORS)[number]
export const LASER_SIZES = ['S', 'M', 'L'] as const
export type LaserSize = (typeof LASER_SIZES)[number]

/**
 * The fork's `FONT_FAMILY` ids the Settings › Canvas "Default font" row offers
 * (`packages/common/src/constants.ts`; ported from Draw by YAZ-3037), Assistant first because it is the
 * default. Id 4 is deliberately absent: the fork leaves it unused for historical reasons.
 */
export const FONT_FAMILY_OPTIONS: ReadonlyArray<{ id: number; label: string }> = [
  { id: 10, label: 'Assistant' },
  { id: 5, label: 'Excalifont' },
  { id: 1, label: 'Virgil' },
  { id: 2, label: 'Helvetica' },
  { id: 3, label: 'Cascadia' },
  { id: 6, label: 'Nunito' },
  { id: 7, label: 'Lilita One' },
  { id: 8, label: 'Comic Shanns' },
  { id: 9, label: 'Liberation Sans' },
  { id: 11, label: 'Inter' },
  { id: 12, label: 'Roboto' },
  { id: 13, label: 'Liberation Serif' },
  { id: 14, label: 'IBM Plex Mono' },
]

export interface CanvasPrefs {
  gridModeEnabled: boolean
  objectsSnapModeEnabled: boolean
  /** The engine's `isMidpointSnappingEnabled`. */
  snapToMidpoints: boolean
  /** The engine's `isBindingEnabled` (arrows bind to the shapes they touch). */
  arrowBinding: boolean
  /** The engine's `boxSelectionMode`: `wrap` = `contain`, `overlap` = `overlap`. */
  selectOn: SelectOn
  /** `activeTool.locked` — NOT a plain key: a live update has to merge with the CURRENT tool. */
  toolLock: boolean
  zenModeEnabled: boolean
  writingMode: boolean
  /** The engine's `currentItemWritingStrokeWidth` (`WRITING_STROKE_WIDTH.default`). */
  writingStrokeWidth: number
  /** The engine's `currentItemVectorStrokeWidth` (`STROKE_WIDTH.medium`). */
  vectorStrokeWidth: number
  /**
   * `frameRendering.outline` + `.name` together — the grey box and its label. NEVER `clip` or
   * `enabled`: turning `enabled` off would also stop frames clipping their children. Applied
   * through the engine's `updateFrameRendering`, never through appState.
   */
  framesVisible: boolean
  /** New text's font (`currentItemFontFamily`, a `FONT_FAMILY_OPTIONS` id): Assistant (10). */
  defaultFontFamily: number
  /** New shapes' sloppiness (`currentItemRoughness`): architect (0). */
  defaultRoughness: Roughness
  /** New text's alignment (`currentItemTextAlign`): the engine's `DEFAULT_NEW_TEXT_ALIGN`. */
  defaultTextAlign: TextAlign
  /** The laser's trail (`laserTrailMode`): `fade` (🔒 YAZ-1989 D1). */
  laserTrailMode: LaserTrailMode
  /** The laser's colour (`laserColor`, a `LASER_COLORS` swatch): red (🔒 YAZ-1989 D1). */
  laserColor: LaserColor
  /** The laser's size (`laserSize`): `S` (🔒 YAZ-1989 D1). */
  laserSize: LaserSize
}

/** The engine's own defaults (`appState.ts` `getDefaultAppState()` + `constants.ts`). */
export const DEFAULT_CANVAS_PREFS: CanvasPrefs = {
  gridModeEnabled: false,
  objectsSnapModeEnabled: false,
  snapToMidpoints: true,
  arrowBinding: true,
  selectOn: 'wrap',
  toolLock: false,
  zenModeEnabled: false,
  writingMode: false,
  writingStrokeWidth: 0.5,
  vectorStrokeWidth: 2,
  framesVisible: true,
  defaultFontFamily: 10,
  defaultRoughness: 0,
  defaultTextAlign: 'center',
  laserTrailMode: 'fade',
  laserColor: '#ff0000',
  laserSize: 'S',
}

/**
 * The in-canvas docked panel's tabs (YAZ-3038; Draw's ⚡ YAZ-1775 D8 amended), in the order its strip shows
 * them. The tab NAMES are the engine's sidebar tab names, kept as the web app spelled them so the
 * engine's own sidebar state reads the same on both sides.
 */
export const CANVAS_PANEL_TABS = ['image-studio', 'components', 'presentation'] as const
export type CanvasPanelTab = (typeof CANVAS_PANEL_TABS)[number]
export const isCanvasPanelTab = (v: unknown): v is CanvasPanelTab => (CANVAS_PANEL_TABS as readonly string[]).includes(v as string)

/**
 * What the canvas panel remembers between mounts (YAZ-3038; Draw's 🔒 YAZ-1775 D10): the tab the hamburger
 * opens on, and whether the panel is docked. App-global in `SettingsState`, and every window follows a
 * change live. Whether the panel is OPEN is not remembered: it starts closed on every mount.
 */
export interface CanvasPanelState {
  tab: CanvasPanelTab
  docked: boolean
}

export const DEFAULT_CANVAS_PANEL: CanvasPanelState = { tab: 'components', docked: false }

// ---------- The canvas panel's library (YAZ-3038; Draw's 🔒 YAZ-1775 D4 / D5), and the providers and secrets behind it ----------

/**
 * Where the media a board can reach comes from (the web app's `ImageStudioProvider`, ported
 * verbatim): Pixabay photos and illustrations, Iconify icons and logos, and the app's own shapes.
 * `shape` needs no network and no key at all.
 */
type MediaProvider = 'pixabay' | 'iconify' | 'shape'
const MEDIA_PROVIDERS: readonly MediaProvider[] = ['pixabay', 'iconify', 'shape']
export const isMediaProvider = (v: unknown): v is MediaProvider => MEDIA_PROVIDERS.includes(v as MediaProvider)

/** What the item IS, independent of who served it (the web app's `ImageStudioItemKind`). */
export type MediaItemKind = 'photo' | 'illustration' | 'icon' | 'logo' | 'shape'
const MEDIA_ITEM_KINDS: readonly MediaItemKind[] = ['photo', 'illustration', 'icon', 'logo', 'shape']
export const isMediaItemKind = (v: unknown): v is MediaItemKind => MEDIA_ITEM_KINDS.includes(v as MediaItemKind)

/**
 * A POINTER to something a provider can serve — never the bytes. Field for field the web app's
 * `mediaItemValidator` (`convex/mediaTypes.ts`) so a library written by either app reads in the
 * other: `itemKey` is the identity (de-dupe and removal both key on it), the rest is attribution
 * and layout metadata the studio shows.
 *
 * `previewUrl` is stored but NEVER TRUSTED: a provider's CDN URL expires, and a stale one in a
 * file that syncs between machines would render a broken tile. YAZ-1818 re-derives every preview it
 * shows from `provider` + `providerId` and treats this field as a hint at best.
 */
export interface MediaItem {
  itemKey: string
  provider: MediaProvider
  providerId: string
  kind: MediaItemKind
  title: string
  previewUrl?: string
  creator?: string
  creatorUrl?: string
  collectionName?: string
  sourceUrl?: string
  licenseName?: string
  licenseUrl?: string
  attribution?: string
  width?: number
  height?: number
  trademarkNotice?: boolean
}

/**
 * A `MediaItem` as the library FILE holds it — the web app's `storedItemValidator`: the pointer
 * plus the moment it was last favorited or used. `updatedAt` is stamped by the main process on
 * every write and is what both lists are ordered by (newest first); a renderer never supplies it.
 */
export type StoredMediaItem = MediaItem & { updatedAt: number }

/**
 * `<library>/media.json` (🔒 YAZ-1775 D5): the cross-vault media library, ONE file for the whole account.
 * Both lists are newest-first and de-duplicated by `itemKey`; `favorites` is the user's pinned
 * set, `recent` is an MRU of what they actually placed on a board.
 */
export interface MediaLibraryFile {
  version: 1
  favorites: StoredMediaItem[]
  recent: StoredMediaItem[]
}

/** The library file's name inside the library folder. */
export const MEDIA_LIBRARY_FILE = 'media.json'
/**
 * `<library>/components/` (🔒 YAZ-1775 D5): where YAZ-1819 writes a saved component's `.excalidraw` + `.png`.
 * Named here so nothing else claims it; YAZ-1817 creates NOTHING — the folder appears on YAZ-1819's first write.
 */
export const LIBRARY_COMPONENTS_DIR = 'components'
/** The components index beside that folder: `<library>/components.json` (🔒 YAZ-1775 D5, YAZ-1819). */
export const COMPONENTS_INDEX_FILE = 'components.json'
/** Favorites are capped at the web app's `listFavorites` ceiling; the oldest fall off the end. */
export const MAX_MEDIA_FAVORITES = 500
/** The MRU's length, the web app's `RECENT_LIMIT` exactly. */
export const RECENT_LIMIT = 60

/** `media:favorites` — one channel, three verbs; every verb answers the resulting list. */
export type MediaFavoritesRequest = { op: 'list' } | { op: 'add'; item: MediaItem } | { op: 'remove'; itemKey: string }
/** `media:recent` — the same shape: read the MRU, or push an item to its head. */
export type MediaRecentRequest = { op: 'list' } | { op: 'record'; item: MediaItem }

// ---------- Image Studio: the provider doors (🔒 YAZ-1775 D4, YAZ-1818) ----------

/**
 * Which providers a search asks. The web app's `ImageStudioSearchSource` exactly: `all` is the
 * federated mix (Iconify 14 + Pixabay 4 of `SEARCH_LIMIT` 18), the other two are one provider each.
 */
export type MediaSearchSource = 'all' | 'iconify' | 'pixabay'
const MEDIA_SEARCH_SOURCES: readonly MediaSearchSource[] = ['all', 'iconify', 'pixabay']
export const isMediaSearchSource = (v: unknown): v is MediaSearchSource => MEDIA_SEARCH_SOURCES.includes(v as MediaSearchSource)

/**
 * A search RESULT — the same pointer `media.json` stores, so favoriting one is a copy rather than
 * a conversion. It carries NO `previewUrl`: in the web app that field held the Worker route that
 * would serve the picture, and this app has no routes — a preview is asked for by `provider` +
 * `providerId` over `media:preview`, which is also why a stored `previewUrl` is never trusted.
 */
export type StudioItem = MediaItem

/** The two providers that serve BYTES; `shape` is drawn by the renderer and never fetched. */
export type MediaBytesProvider = 'pixabay' | 'iconify'
const MEDIA_BYTES_PROVIDERS: readonly MediaBytesProvider[] = ['pixabay', 'iconify']
export const isMediaBytesProvider = (v: unknown): v is MediaBytesProvider => MEDIA_BYTES_PROVIDERS.includes(v as MediaBytesProvider)

/** `media:search` — the query, the providers, and the opaque cursor of the page before this one. */
export interface MediaSearchRequest {
  q: string
  source: MediaSearchSource
  /** The `nextCursor` of the previous page; absent or null starts over. Opaque: main minted it, main reads it. */
  cursor?: string | null
}

/**
 * `media:search`'s answer. `nextCursor` is null when the providers are exhausted — that is what
 * stops the infinite scroll. `pixabayAvailable` is the ONE thing the renderer learns about the
 * key (🔒 YAZ-1775 D4: never the value): false hides the Pixabay section instead of showing an error.
 */
export interface MediaSearchResponse {
  items: StudioItem[]
  nextCursor: string | null
  pixabayAvailable: boolean
  /** A provider that was reached and failed while ANOTHER answered — the web app's warning banner. */
  warnings: string[]
}

/** `media:preview` / `media:import` — a provider and its own id for the item. */
export interface MediaBytesRequest {
  provider: MediaBytesProvider
  id: string
}
export type MediaPreviewRequest = MediaBytesRequest
export type MediaImportRequest = MediaBytesRequest

/** The tile picture. A dataURL because the renderer is sandboxed and there is no custom protocol. */
export interface MediaPreviewResponse {
  mimeType: string
  dataURL: string
}

/**
 * The full-size bytes, plus the item as the PROVIDER describes it now — which is how a Recent row
 * gets a fresh size and attribution even when the caller's copy came out of an old `media.json`.
 * Only the fields main can actually know are set; the caller's own item supplies the rest.
 */
export interface MediaImportResponse extends MediaPreviewResponse {
  item: StudioItem
}

// ---------- Saved components (`<library>/components/` — 🔒 YAZ-1775 D5, YAZ-1819) ----------

/**
 * ONE saved component as the index names it (🔒 YAZ-1775 D5). The SLUG is the identity: it is the file's
 * own basename (`<library>/components/<slug>.excalidraw` + `<slug>.png`), so the folder can be
 * read back into an index with nothing else on hand. The NAME is only the label, which is why a
 * rename never moves a file — a component inserted into a board is not addressed by either.
 */
export interface ComponentItem {
  slug: string
  name: string
  elementCount: number
  createdAt: number
  updatedAt: number
}

/** `<library>/components.json`: the index, rebuilt from the folder whenever it is missing or unreadable. */
export interface ComponentsIndexFile {
  version: 1
  items: ComponentItem[]
}

/**
 * `components:save` — the fragment and its picture, both already made by the renderer (only it has
 * an engine). `fragmentJson` is a whole `.excalidraw` document with the component's image bytes
 * EMBEDDED (🔒 YAZ-1775 D5: a component is small and self-contained, so it inserts into any vault);
 * `previewPng` is a `data:image/png;base64,…` dataURL, which is the only way bytes cross the bridge.
 */
export interface ComponentSaveRequest {
  name: string
  fragmentJson: string
  previewPng: string
}

/** `components:read` / `components:delete` / `components:preview` — a component by its slug. */
export interface ComponentSlugRequest {
  slug: string
}

/** `components:rename` — the label only; the slug, and therefore both files, stay put. */
export interface ComponentRenameRequest {
  slug: string
  name: string
}

/** `components:read`'s answer: the fragment's bytes, exactly as they are on disk. */
export interface ComponentReadResponse {
  fragmentJson: string
}

/** The longest name a component may carry — the web app's `MAX_SAVED_COMPONENT_NAME_LENGTH`. */
export const MAX_COMPONENT_NAME_LENGTH = 120

// ---------- Secrets (`userData/secrets.json` — 🔒 YAZ-1775 D4) ----------

/** `secrets:set` — a value to store, or null to clear the name entirely. */
export interface SecretSetRequest {
  name: string
  value: string | null
}

/** `secrets:has` — the ONLY question a renderer may ask about a secret. */
export interface SecretHasRequest {
  name: string
}

/** The name the Pixabay API key is stored under (🔒 YAZ-1775 D4); YAZ-1818 reads it in main, never here. */
export const PIXABAY_SECRET = 'pixabayApiKey'

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
  /** Show the rename sheet, with its count of links to update, before a note or folder is renamed (YAZ-2420 3C1). Off renames at once; the links still follow. */
  confirmRename: boolean
  /** Rest the pointer on a drawing or diagram row to see the whole board (Draw's YAZ-1800 D2; YAZ-3044 A20). Notes never preview. */
  hoverPreview: boolean
  /** Comment stream order (YAZ-1515): how you READ, global, never part of a note. */
  commentsOrder: CommentsOrder
  /** Which windows come back when the app starts with nothing asked of it (YAZ-2589 D2). */
  startupWindows: StartupWindows
  /** Section indent (YAZ-2709): the width of one step in px, 24 | 30 | 36. On or off is per page (the page cog), never here. View-only. */
  sectionStep: number
  /** Section indent (YAZ-2709): the grey section lines show always, or only while the pointer is over the note. */
  sectionLines: SectionLines
  /** The table of contents at a note's right edge (YAZ-2700): how you READ, global, never part of a note. */
  tableOfContents: TableOfContents
  /** The width of the table of contents' names column (YAZ-2752): whole px, `TOC_MIN_W` to `TOC_MAX_W`. The reader drags the column's edge; one width for every note and window. */
  tableOfContentsWidth: number
  /** The table of contents (YAZ-2762): its level lines — the grey ones and the path to the current row — show only while the mouse or the keyboard is in the list (`hover`; the path also while the reader moves the note with the wheel), always, or never. */
  tocLines: TocLines
  /**
   * The canvas preferences every drawing, every window and every relaunch share (Draw's 🔒 YAZ-1775 D9,
   * YAZ-3028): seeded into a canvas at mount and kept in step with the engine both ways. See `CanvasPrefs`.
   */
  canvas: CanvasPrefs
  /**
   * How draw.io diagrams look in dark mode (YAZ-3028, Draw's 🔒 YAZ-1802 D16): `adapt` lets draw.io
   * re-colour them so an ordinary diagram stays readable, `keep` shows every diagram in its own
   * colours. The DEFAULT only — a file whose `<mxGraphModel>` says `adaptiveColors="none"` keeps its
   * colours either way. The diagram tab and its pictures follow it, live. Its row is Settings › Appearance (YAZ-3037).
   */
  diagramDarkColors: DiagramDarkColors
  /**
   * The canvas panel's library folder (YAZ-3038; Draw's 🔒 YAZ-1775 D5): ONE folder every vault shares, for
   * saved components and media favorites. null = the default, `<userData>/library`, which only main
   * can resolve (`drawing.libraryFolder()`); never `''`, which would resolve to the process cwd.
   */
  libraryFolder: string | null
  /** The canvas panel's last tab and dock preference (YAZ-3038). See `CanvasPanelState`. */
  canvasPanel: CanvasPanelState
  /** Heading styles (YAZ-3049 D1): how each level H1-H6 looks in every note. Only the levels and fields the reader changed; `{}` is the app's own look. View-only; never written into the file. */
  headingStyles: HeadingStyles
}

export type DiagramDarkColors = 'adapt' | 'keep'
export const DIAGRAM_DARK_COLORS: readonly DiagramDarkColors[] = ['adapt', 'keep']

export const THREAD_WIDTHS: readonly number[] = [1, 2, 3]

/** Section indent (YAZ-2709): the widths of one step, in px, in the order Settings shows them. */
export const SECTION_STEPS: readonly number[] = [24, 30, 36]

/** Section indent (YAZ-2709): when the grey section lines show. */
export type SectionLines = 'always' | 'hover'
export const SECTION_LINES: readonly SectionLines[] = ['always', 'hover']

/** The table of contents (YAZ-2762): when its level lines show. */
export type TocLines = 'hover' | 'always' | 'off'
export const TOC_LINES: readonly TocLines[] = ['hover', 'always', 'off']

/** Heading styles (YAZ-3049 D5): the levels a style can change, in the order Settings shows them. */
export const HEADING_KEYS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const
export type HeadingKey = (typeof HEADING_KEYS)[number]

/** The highlight colours of a heading: the colours of the `==highlight==` mark (app.css `--mark-bg`, `--mark-bg-<name>`). */
export const HEADING_HIGHLIGHTS = ['yellow', 'green', 'blue', 'pink'] as const
export type HeadingHighlight = (typeof HEADING_HIGHLIGHTS)[number]

/** The smallest and the largest heading size, whole px. */
export const HEADING_SIZE_MIN = 12
export const HEADING_SIZE_MAX = 48

/** What one heading level changed (D5). A missing field keeps the app's look: the default size, bold on, no underline, no highlight. */
export interface HeadingStyle {
  /** Whole px, `HEADING_SIZE_MIN` to `HEADING_SIZE_MAX`. */
  size?: number
  /** `false` draws the heading at normal weight (400). */
  bold?: boolean
  underline?: boolean
  highlight?: HeadingHighlight
}

/** Only the levels the reader changed (D1). "Reset" removes a level's key; it never stores the defaults. */
export type HeadingStyles = Partial<Record<HeadingKey, HeadingStyle>>

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

/** What a plain launch brings back (YAZ-2589 D2): every window · the windows of the vault used last · none (the list of vaults). */
export type StartupWindows = 'all' | 'last' | 'none'
export const STARTUP_WINDOWS: readonly StartupWindows[] = ['all', 'last', 'none']

/**
 * A note's table of contents (YAZ-2700): `auto` shows the names of its rows — its headings, or its
 * bullets (`TocSource`) — when the window has room beside the text and small lines when it has
 * not, `pinned` keeps the names open, `off` shows nothing.
 */
export type TableOfContents = 'auto' | 'pinned' | 'off'
export const TABLE_OF_CONTENTS: readonly TableOfContents[] = ['auto', 'pinned', 'off']

/** The names column of the table of contents (YAZ-2752): the narrowest and the widest a drag makes it, and its width until the reader drags. */
export const TOC_MIN_W = 160
export const TOC_MAX_W = 480
export const TOC_DEFAULT_W = 200

/**
 * What ONE note's table of contents is built from when the reader chose (YAZ-2700 D14): `headings`
 * is every H1-H5 of the note (YAZ-3051), the ones inside bullets too; `bullets` is its bullets, however many
 * headings it has. The third choice, Auto — the note's own structure decides — is the ABSENCE of
 * a choice: it is never stored, and reads as `null` everywhere.
 */
export type TocSource = 'headings' | 'bullets'
export const TOC_SOURCES: readonly TocSource[] = ['headings', 'bullets']
export const isTocSource = (v: unknown): v is TocSource => TOC_SOURCES.includes(v as TocSource)

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

/** Matches the app's pre-settings look (Crepe: line-height 1.5, block padding 4px); threading on, 2px, accent; new notes beside the source page (YAZ-1643); section steps of 30px with the grey lines always there (YAZ-2709). */
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
  confirmRename: true,
  hoverPreview: true,
  commentsOrder: 'oldest',
  startupWindows: 'last',
  sectionStep: 30,
  sectionLines: 'always',
  tableOfContents: 'auto',
  tableOfContentsWidth: TOC_DEFAULT_W,
  tocLines: 'hover',
  canvas: DEFAULT_CANVAS_PREFS,
  diagramDarkColors: 'adapt',
  libraryFolder: null,
  canvasPanel: DEFAULT_CANVAS_PANEL,
  headingStyles: {},
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One open window, saved for the next launch (GRO-2160), which brings back the ones it is asked for or
 * the ones `settings.startupWindows` names (YAZ-2589). `root` null = Welcome screen.
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
  /**
   * Every vault this window shows (YAZ-2602 D1), in the order they were added, or the order a drag
   * of a vault row gave them (YAZ-2631 D5). `root` is the FIRST.
   * Invariants, like `tabs` / `file` (`normalizeRoots`): `roots[0] === root`, and `roots: []` ⇔
   * `root: null`. Additive within version 1: a file without it repairs from `root`, and an old build
   * drops the key and opens `root` alone.
   */
  roots: string[]
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
  // No focus list (YAZ-2702 Decision 1): a vault's focus list is in the vault (`FocusConfig`), not on
  // the window. A file of an older build still holds `focusList` here; the loader does not read it
  // (Decision 4: no migration), so the next write drops the key.
  bounds: WindowBounds
}

/** How much a page is used (YAZ-2663 D2): `score` is what its uses were worth at `last`, the time (ms) it last came on show. */
export interface OpenStat {
  score: number
  last: number
}
/** A vault's open history keeps this many pages at most (YAZ-2663 R4). */
export const MAX_OPENS = 100
/** A score is worth half after this long with no use (YAZ-2663 D2): 14 days. */
export const OPEN_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000

/** Pure: what a score is worth at `now` (YAZ-2663 D2) — half for each OPEN_HALF_LIFE_MS since the last use. A clock that went back takes nothing off. */
export function openScore(stat: OpenStat, now: number): number {
  return stat.score * 0.5 ** (Math.max(0, now - stat.last) / OPEN_HALF_LIFE_MS)
}

/**
 * Pure: `opens` with one more use of `file` at `now` (YAZ-2663 D2) — on what its score is worth now.
 * Past MAX_OPENS the pages whose scores are worth the least now go; the page just used stays, so
 * "Recent" never misses it.
 */
export function addOpen(opens: Record<string, OpenStat>, file: string, now: number): Record<string, OpenStat> {
  const prev = opens[file]
  const next = { ...opens, [file]: { score: (prev === undefined ? 0 : openScore(prev, now)) + 1, last: now } }
  const over = Object.keys(next).length - MAX_OPENS
  if (over <= 0) return next
  const least = Object.keys(next).filter((path) => path !== file).sort((a, b) => openScore(next[a], now) - openScore(next[b], now))
  for (const path of least.slice(0, over)) delete next[path]
  return next
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
  /** The open history (YAZ-2663 D1): page → how much it is used, and when it was last on show (max MAX_OPENS). The main process alone adds a use (`upsertWindow`). Persisted, per machine. */
  opens: Record<string, OpenStat>
  /** file → what its table of contents is built from (YAZ-2700 D14), for the notes where the reader chose. A note on Auto has NO entry. Keyed by page, as `folds` is. Never written to the markdown. Additive: a file without it loads as `{}`. */
  tocSources: Record<string, TocSource>
  /** file → the note's "Section indent" switch (YAZ-2709 D2), for the notes where the reader used it. A note with NO entry is off. `true` and `false` are both kept: a note the reader turned off stays apart from a note never touched, so a default for all notes can come later with no repair of this data. Keyed by page, as `tocSources` is. Never written to the markdown. Additive: a file without it loads as `{}`. */
  sectionIndents: Record<string, boolean>
  /** file → the note's "Table of contents" switch (YAZ-2950), for the notes where the reader used it. A note with NO entry is on. `true` and `false` are both kept, as in `sectionIndents`. Keyed by page. Never written to the markdown. Additive: a file without it loads as `{}`. */
  tocSwitches: Record<string, boolean>
  /** The vault's display name (YAZ-1974 D3) when this bucket's root is a vault; null = its folder name. Persisted, per machine. */
  name: string | null
  /** The vault's number, 1–9 (YAZ-2555 D2): ⌘<key> goes to it; null = none. One vault per number. Persisted, per machine. */
  key: number | null
}

/** What `state.setFolder` may merge into a bucket — every other field has its own targeted mutator. */
export type FolderPatch = Partial<Pick<FolderState, 'expanded' | 'lastFile' | 'name' | 'key'>>

/** Pure: `folders` with `key` taken from the vault that has it (YAZ-2555 D2: one vault per number) — shared by the client cache and the main store. */
export function freeVaultKey(folders: Record<string, FolderState>, key: number): Record<string, FolderState> {
  return Object.fromEntries(Object.entries(folders).map(([root, folder]) => [root, folder.key === key ? { ...folder, key: null } : folder]))
}

/** The app keeps this many saved sets of vaults at most (YAZ-2602 R12): a save under a new name past it is refused. */
export const MAX_VAULT_SETS = 20

/**
 * A saved set of vaults (YAZ-2602 D8). The user reads "workspace"; the code says `VaultSet`, because
 * `workspace` already names the tabs code. Saved by hand from a window that shows two or more vaults,
 * and a COPY: a later change to that window's vaults does not change it (S69).
 */
export interface VaultSet {
  id: string
  /** Its name, cleaned like a vault's display name (`cleanVaultName`). One set per name: a save under the same name replaces (S63). */
  name: string
  /** Its vaults in the saved order, trailing slash off, each once: two at least, MAX_WINDOW_ROOTS at most. */
  roots: string[]
  /** When it was last saved or opened (ms); 0 = not known. */
  lastUsed: number
}

/** What `window.openSet` answers (YAZ-2602 S66): `missing` is the set's vaults whose folder is gone, as absolute paths; `opened: false` = none is left, and no window opened. */
export interface OpenSetResult {
  opened: boolean
  missing: string[]
}

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
  /**
   * Saved sets of vaults (YAZ-2602 D8), last used first, max MAX_VAULT_SETS. Per machine. Additive
   * within version 1, like `WindowEntry.roots`: a file without it loads as `[]`, and an old build drops the key.
   */
  vaultSets: VaultSet[]
  /** The Favorites tab's order ACROSS vaults (YAZ-2631 D1): absolute paths, MAX_FAVORITES_ORDER at most. Per machine. A file without it loads as `[]`. */
  favoritesOrder: string[]
  /**
   * The Focus tab's order ACROSS vaults (YAZ-2702 Decision 3), by the rule of `favoritesOrder`: it
   * says which VAULT has each place of the flat list, and each vault's own focus file (`FocusConfig`)
   * gives the order inside that vault. Absolute paths, MAX_FAVORITES_ORDER at most. Per machine: the
   * mix of two vaults does not travel, the order inside each vault does. A file without it loads as `[]`.
   */
  focusOrder: string[]
}

/** A fresh default state (a factory, so no caller can mutate a shared constant). */
export function defaultAppState(): AppState {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, sidebarWidth: SIDEBAR_DEFAULT_W, recents: [], windows: [], folders: {}, vaultSets: [], favoritesOrder: [], focusOrder: [] }
}

export function defaultFolderState(): FolderState {
  return { expanded: [], lastFile: null, folds: {}, baseGroups: {}, opens: {}, tocSources: {}, sectionIndents: {}, tocSwitches: {}, name: null, key: null }
}

/** One vault as the app lists it (YAZ-2556 D2): a row of the ⌘O panel, and of `yaseendocs vaults`. */
export interface VaultEntry {
  path: string
  /** Its display name (YAZ-1974 D3), else its folder name. */
  name: string
  /** Its number, 1–9, or null (YAZ-2555 D2). */
  key: number | null
  /** A window is on it. */
  open: boolean
  /** When it was last used (ms): its time in the recents, or null for a vault that is not among them. */
  lastUsed: number | null
}

/**
 * Every vault the app knows (YAZ-2556 D2), the rows and the order of YAZ-2555 A1: the recents, last
 * used first, then the open vaults and the numbered ones (in number order) that are not among them.
 * ONE list for the ⌘O panel and for `yaseendocs vaults`, so the two cannot disagree.
 */
export function listVaults(state: { recents: Readonly<RecentRoots>; windows: readonly { roots: readonly string[] }[]; folders: Readonly<Record<string, FolderState>> }): VaultEntry[] {
  const open = openVaultRoots(state.windows)
  const recents = new Map(state.recents.map((r) => [r.path, r.lastOpened]))
  return [...new Set([...recents.keys(), ...open, ...keyedVaults(state.folders).map((v) => v.path)])].map((path) => {
    const folder = state.folders[path]
    return { path, name: folder?.name ?? basename(path), key: folder?.key ?? null, open: open.includes(path), lastUsed: recents.get(path) ?? null }
  })
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
 * as it was — see `git/sync.ts`; since YAZ-3039 boards merge instead, `git/resolve.ts`, so a
 * conflict is a note or another file sync does not merge), `too-large` wants "shrink it or move it
 * out" (YAZ-1801 D3: files held back under `tooLarge`, everything else synced), and `error` is the
 * honest catch-all that carries a message.
 */
export type GithubSyncAttention = 'no-git' | 'no-identity' | 'auth' | 'conflict' | 'error' | 'too-large'

/**
 * YAZ-1801 D3 (Draw, ported by YAZ-3039): the size at which a sync pass holds a file back instead
 * of committing it. GitHub REFUSES any file over 100 MiB, and one such file inside a commit rejects
 * the whole push — so every other edit in the vault would stop syncing behind it. 95 MiB leaves a
 * margin for a file that grows between the check and the push. `too-large` is the attention that says so.
 */
export const GITHUB_FILE_LIMIT_BYTES = 95 * 1024 * 1024
/**
 * GitHub warns on a push past 50 MiB (YAZ-1801): from here a file is listed under Settings ›
 * Storage's "Needs attention" — amber below `GITHUB_FILE_LIMIT_BYTES`, red at or above it (the
 * same line the sync guard holds files back at, so the page's colour and sync never disagree).
 */
export const GITHUB_FILE_WARN_BYTES = 50 * 1024 * 1024
/** GitHub: ideally under 1 GB, strongly under 5 GB, and 10 GB is its stated maximum — the bar's three steps. */
export const GITHUB_REPO_SOFT_BYTES = 1024 * 1024 * 1024
export const GITHUB_REPO_HARD_BYTES = 5 * 1024 * 1024 * 1024
export const GITHUB_REPO_MAX_BYTES = 10 * 1024 * 1024 * 1024

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
  /**
   * YAZ-1801 D3: vault-relative POSIX paths the last pass held back because each is at or
   * over `GITHUB_FILE_LIMIT_BYTES`. They stay on this machine only; everything else synced. Present
   * (and non-empty) only while there is at least one — the sidebar's cloud-off icon, the chip's
   * "N files not synced" and the `too-large` banner all read this one list.
   */
  tooLarge?: readonly string[]
  /**
   * YAZ-1897 D4: what THIS pass merged — present only on the status of the pass that did it (the
   * manager never keeps it as the root's last status, so a late `status()` cannot replay the notice).
   */
  merged?: readonly GithubSyncMerge[]
}

/**
 * One file a pass merged instead of stopping (YAZ-1897 D1/D3, YAZ-3039). A drawing merged shape by
 * shape has no `copy`; a diagram kept both versions — the remote's at `path`, ours at `copy` — and
 * the notice has to say where ours went. A note is never here: a note conflict still stops (D4).
 */
export interface GithubSyncMerge {
  /** Vault-relative POSIX path. */
  path: string
  /** Who made the remote's side of it ("Sara", "Sara and Sam"). */
  author: string
  /** Shapes both machines edited; the newest edit of each was kept. */
  clashes: number
  /** Vault-relative POSIX path of our copy, when both versions were kept. */
  copy?: string
}

/** One entry in a drawing's or diagram's Version history (YAZ-1897 D4, YAZ-3039). */
export interface BoardVersion {
  /** Opaque to the renderer: hand it back to `version` / `restore`. */
  ref: string
  author: string
  /** Epoch milliseconds of the commit. */
  at: number
  /** The version a sync merge produced (its commit carries a `Merged-with:` trailer). */
  merged: boolean
  /** "Your version before the merge": never pushed, kept on this machine only until the next merge. */
  localOnly: boolean
}

export type BoardVersionScene = { kind: 'drawing'; json: string; files: Record<string, DrawingFileEntry> } | { kind: 'diagram'; xml: string }

// ---------- Storage (Settings › Storage — YAZ-1801, ported by YAZ-3039) ----------

/** One file in "Needs attention" (YAZ-1801): any file in the vault at or over `GITHUB_FILE_WARN_BYTES`. */
export interface VaultStorageFile {
  /** Vault-relative POSIX path. */
  path: string
  bytes: number
}

/**
 * What a vault weighs, from the disk and the LOCAL git only (YAZ-1801 D2) — never the network.
 * Every number is bytes. `git` is null when the vault is not a git repo (or there is no git).
 */
export interface VaultStorageStats {
  root: string
  /** Every `.excalidraw` and `.drawio` under the vault (dot-folders skipped), `assets/` included. */
  boards: { bytes: number; count: number }
  /** Every other file in the top-level `assets/` folder: note images and the drawings' picture store. */
  pictures: { bytes: number; count: number }
  /** Everything else that is not a dot-entry: notes, a video, a PDF someone dropped in. */
  other: { bytes: number; count: number }
  git: {
    /** `git count-objects -v`: loose + packed, i.e. everything `.git` holds for this repo. */
    historyBytes: number
    /** The compressed size of the objects HEAD's tree needs — the current snapshot. */
    headBytes: number
    /** `max(0, history − head)`: what a history reset would free (YAZ-1801 D6 shows it, never does it). */
    oldVersionsBytes: number
  } | null
  /** Every file — board, picture in `assets/`, anything else — at or over `GITHUB_FILE_WARN_BYTES`, biggest first. */
  large: VaultStorageFile[]
  /** Pictures still inside drawings outside `assets/` (the ones "Move pictures out" moves): their `dataURL` bytes and how many drawings carry any. */
  embedded: { bytes: number; boards: number }
}

/** What "Move pictures out of drawings" did (YAZ-1801 D5). `bytesMoved` is how much lighter the drawings got. */
export interface ShrinkResult {
  shrunk: number
  skipped: number
  bytesMoved: number
}

// ---------- Share links (Draw's YAZ-1799, ported by YAZ-3040) ----------

/**
 * SHARE LINK (YAZ-1799): one board, uploaded to the user's OWN Cloudflare (one R2
 * bucket + one small Worker), reachable by anyone with its long random link. ALWAYS LIVE
 * (🔒 YAZ-1799 D3): every save of a shared board re-uploads it to the same link (`liveShare.ts`).
 *
 * WHO OWNS WHAT:
 *  - MAIN owns Cloudflare: the API token and the Worker's upload password live in `secrets.json`
 *    (the secrets door — the renderer can never read either), and every HTTP call is main's.
 *  - The RENDERER assembles the bytes (the same standalone `.excalidraw` Export Drawing writes,
 *    🔒 YAZ-1799 D3) because only it has the engine; it hands them to main to upload.
 *  - The vault remembers which boards are shared in `<vault>/.yaseendocs/shares.json`:
 *    `{ version: 1, shares: { "<vault-relative path>": { id, allowDownload, sharedAt, updatedAt } } }`.
 *  - ONE LINK per board, `/b/<id>`, plus a permission the owner flips on that same link (the
 *    Google Docs model): "can view and download" (default) or "can view only". The Worker
 *    enforces it — `/raw/<id>` is 403 when downloads are off.
 */

/**
 * The Workers free-plan request body limit — the Worker enforces it and main pre-checks it,
 * so a board over it is refused with an explanation instead of a failed upload. Decimal megabytes,
 * as Cloudflare states the limit.
 */
export const MAX_SHARE_BYTES = 100 * 1000 * 1000

/** The two secrets sharing keeps in `secrets.json`. Neither ever reaches a renderer. */
export const CLOUDFLARE_TOKEN_SECRET = 'cloudflareApiToken'
export const SHARE_UPLOAD_PASSWORD_SECRET = 'shareUploadPassword'

/** One Cloudflare account a pasted key can see: the setup's account picker lists these. */
export interface ShareAccount {
  id: string
  name: string
}

/** What Settings › Sharing shows at the top. Holds no secret. */
export interface ShareStatus {
  state: 'off' | 'ready'
  /** The public origin links are built on: the custom domain when attached, else workers.dev. */
  url: string | null
  /** The workers.dev address, even when a custom domain is attached. */
  workersDevUrl: string | null
  customDomain: string | null
  accountName: string | null
  workerName: string | null
  bucketName: string | null
  readyAt: number | null
  /** True when this build talks to the local fake Cloudflare (the demo). */
  demo: boolean
}

/** The setup flow's steps, in order — the progress list renders exactly these. */
export const SHARE_SETUP_STEPS = ['verify', 'account', 'bucket', 'viewer', 'worker', 'subdomain', 'test'] as const
export type ShareSetupStep = (typeof SHARE_SETUP_STEPS)[number]

export const SHARE_SETUP_LABELS: Record<ShareSetupStep, string> = {
  verify: 'Checking the key',
  account: 'Finding your Cloudflare account',
  bucket: 'Creating the storage bucket (R2)',
  viewer: 'Uploading the viewer page',
  worker: 'Uploading the share Worker and its upload password',
  subdomain: 'Turning on the workers.dev address',
  test: 'Test upload',
}

export interface ShareSetupProgress {
  step: ShareSetupStep
  state: 'running' | 'done' | 'failed'
  /** Plain-English detail: what was found, or what went wrong and what to do about it. */
  message?: string
}

/**
 * Where a shared board's ALWAYS-LIVE link stands (Yasin's amendment): every save re-uploads, so
 * the interesting facts are "is an upload running" and "did the last one fail, and why". Kept by
 * main in memory — a relaunch starts from `ok`, and the next save tells the truth again.
 */
export interface ShareSync {
  state: 'ok' | 'uploading' | 'failed'
  /** The last failure, in plain English. */
  message?: string
  /** When the last failure happened. */
  failedAt?: number
}

/** One board's share record as the renderer sees it. `path` is absolute. */
export interface ShareEntry {
  path: string
  id: string
  /** `/b/<id>` on the share origin. */
  url: string
  /** "can view and download" (true, the default for a new share) or "can view only" (false). */
  allowDownload: boolean
  sharedAt: number
  /** When the link last got a successful upload. */
  updatedAt: number
  sync: ShareSync
  /** The Worker last answered 404 for this link (a Settings check or a permission change): its copy is gone until the next save puts it back. */
  stale: boolean
}

/** A Settings list row: the record plus whether the board is still at its path. Whether the link is still live is `stale` (a checked list sets it). */
export interface ShareListEntry extends ShareEntry {
  fileExists: boolean
}

export interface ShareBoardRequest {
  root: string
  path: string
}

export interface SharePublishRequest extends ShareBoardRequest {
  /** The standalone `.excalidraw` text (images embedded), or a diagram's `.drawio` XML (🔒 YAZ-1802 D11). */
  content: string
  /**
   * A re-upload's link: main finds the record by it even if a rename moved the board since the
   * save, and refuses (NOT_FOUND) if it was stopped. Absent: share `path` (or re-upload it if shared).
   */
  id?: string
}

export interface SharePermissionRequest extends ShareBoardRequest {
  allowDownload: boolean
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

// ---------- Focus (`<root>/.yaseendocs/focus.<mac id>.json` — YAZ-2702, Decisions 1 and 2) ----------

/**
 * One Mac's focus file on disk: VAULT-RELATIVE POSIX paths in the user's order (`MAX_FOCUS` at
 * most), and `at`, the ISO time of the write. Each Mac writes only its own file, so a sync cannot
 * conflict; the file with the latest `at` is the vault's list.
 */
export interface FocusConfig {
  version: 1
  at: string
  focus: string[]
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
  /** Every vault this window shows, `root` first (YAZ-2602 D1; the same list as `WindowEntry.roots`). */
  roots: string[]
  file: string | null
  /** Open tabs left→right (GRO-2232); `file` is the active one (same invariants as `WindowEntry.tabs`). */
  tabs: string[]
  rightPanel: RightPanelIdentity
  /** Whether this window's sidebar is hidden (YAZ-1280). */
  sidebarCollapsed: boolean
  /** Which sidebar lens this window shows (YAZ-847, per window since YAZ-1628). */
  sidebarLens: SidebarLens
  /**
   * The page view the active tab starts with (YAZ-2951 D5): set by ⌘⇧N or "Move to new window",
   * given out by the FIRST `window:identity` of the new window only (S17). Never stored.
   */
  startView?: StartView
  /**
   * Display names a tab brought with "Move to new window" (YAZ-2949 D7), by path. Answered ONCE, to the
   * new window's first identity read; never in `WindowEntry`, never stored.
   */
  tabNames?: Record<string, string>
}

/**
 * How a page looks now (YAZ-2951 D1): what "Duplicate tab", ⌘⇧N and "Move to new window" give the
 * copy. Read once, on the action (`client/src/lib/pageView.ts`). Never stored (CONTRACTS rule 12).
 */
export interface PageView {
  /** The editor scroller's `scrollTop`, px. */
  scrollTop: number
  /** The drilled-in bullet's zoom key (`zoom.ts` `zoomKeyAt`), or null when not drilled in. */
  zoomKey: string | null
  /** The live fold keys: bullet keys and `h:` heading keys, as `setFolds` takes them. */
  folds: string[]
  /** The text size (⌘+ / ⌘−), percent; 100 = normal. */
  magnification: number
}

/** A page view for one file: what a new window starts its active tab with (YAZ-2951 D5). Never stored. */
export interface StartView {
  path: string
  view: PageView
}

/**
 * What "Move to new window" carries along with the page, one options object (YAZ-2951 D2, YAZ-2949 D7):
 * its page view and its display name. Each side reads its own field.
 */
export interface PopOutCarry {
  view?: PageView
  /** The tab's display name (YAZ-2949 D7), if it has one. */
  name?: string
}

export interface OpenWindowOptions {
  root: string | null
  file: string | null
  /** More vaults for the window, after `root` (YAZ-2602); absent = `root` alone. */
  roots?: string[]
}

/** Clipboard text captured when the user chooses an explicit paste mode. */
export interface ClipboardPasteRequest {
  mode: 'plain' | 'markdown'
  text: string
}

/** One ⌘+ / ⌘− / ⌘0 press: up, down, or back to the default (YAZ-1710). */
export type ZoomStep = -1 | 0 | 1

/**
 * The updater's state (YAZ-2976), owned by main and pushed to every window. `downloading` and `ready`
 * name the new version; `manual` = a newer version exists but this copy cannot replace itself (Windows,
 * an unpackaged run, a read-only or translocated folder, an ad-hoc build — S13); `updated` = this launch is
 * the first one of `version`, after the swap (S24).
 */
export type UpdateState = { kind: 'idle' } | { kind: 'downloading' | 'ready' | 'manual' | 'updated'; version: string }

/** One GitHub release for the "What's new" window (YAZ-2976 D5): `body` is the release's Markdown as GitHub holds it. */
export interface ReleaseNote {
  version: string
  title: string
  /** ISO 8601, GitHub's `published_at`. */
  date: string
  body: string
}

/**
 * The answer of `update.notes()` (YAZ-2988 D13): every published release, newest first, up to 100, and the
 * running app's version. The renderer has no other way to know `current`, and the sheet needs it for the tag
 * "Your current version" and the release it opens on (D10, D11). One answer, so the two always agree.
 */
export interface ReleaseNotes {
  current: string
  releases: ReleaseNote[]
}
