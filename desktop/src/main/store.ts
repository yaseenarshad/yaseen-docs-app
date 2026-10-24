import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import {
  COMMENTS_ORDERS,
  CONTENT_WIDTHS,
  DEFAULT_SETTINGS,
  DEFAULT_SIDEBAR_LENS,
  HEADING_KEYS,
  MAX_COLLAPSED_GROUP_KEYS,
  MAX_FAVORITES_ORDER,
  MAX_FOLD_KEYS_PER_FILE,
  MAX_EDITS,
  MAX_OPENS,
  MAX_RECENT_ROOTS,
  MAX_SESSIONS,
  MAX_SESSION_TABS,
  MAX_VAULT_SETS,
  NEW_NOTE_LOCATIONS,
  RIGHT_PANEL_DEFAULT_W,
  RIGHT_PANEL_MAX_W,
  RIGHT_PANEL_MIN_W,
  SECTION_LINES,
  SECTION_STEPS,
  SIDEBAR_DEFAULT_W,
  SIDEBAR_MAX_W,
  SIDEBAR_MIN_W,
  STARTUP_WINDOWS,
  TABLE_OF_CONTENTS,
  THEMES,
  THREAD_WIDTHS,
  TOC_LINES,
  TOC_MAX_W,
  TOC_MIN_W,
  addEdit,
  addOpen,
  addRecentRoot,
  cleanVaultKey,
  cleanVaultName,
  defaultAppState,
  defaultFolderState,
  defaultRightPanelIdentity,
  freeVaultKey,
  isSidebarLens,
  isTocSource,
  isValidNewNoteFolder,
  mergeFavoritesOrder,
  normalizeRoots,
  rootOfPath,
  stripSlash,
  type AppState,
  type CommentsOrder,
  type ContentWidth,
  type FolderPatch,
  type FolderState,
  type HeadingStyles,
  type NewNoteLocation,
  type OpenStat,
  type RecentRoots,
  type RightPanelIdentity,
  type SectionLines,
  type SettingsState,
  type Session,
  type SidebarLens,
  type StartupWindows,
  type StoredTab,
  type TableOfContents,
  type Theme,
  type TocLines,
  type TocSource,
  type VaultSet,
  type WindowBounds,
  type WindowEntry,
  DIAGRAM_DARK_COLORS,
  type DiagramDarkColors,
  DEFAULT_CANVAS_PANEL,
  isCanvasPanelTab,
  type CanvasPanelState,
} from '@shared/types'
import { isCanvasPrefs, sanitizeCanvasPrefs } from '@shared/canvasPrefs'
import { isFiniteNumber, isRecord, isStringArray } from '@shared/guards'
import { isHeadingStyle } from '@shared/textFormatting'
import { copyFoldKey, copyFoldParts } from '@shared/foldKey'
import { atomicWrite } from './fs/fsUtils'

/**
 * The app state store (D9, GRO-2159): one user-global JSON file owned by the main process.
 * Electron-free — the caller passes the file path — so tests run it against a temp dir.
 * Mutations update memory, notify `onChange` listeners synchronously and schedule one debounced
 * atomic write; `flush()` writes at once (quit). Snapshots are immutable: every mutation builds a
 * new state object, so a listener can keep the one it was handed.
 */
export interface Store {
  get(): AppState
  /**
   * The heading styles that 1.0.15 saved in `settings.headingStyles` (YAZ-3066 D11), once: the first
   * call returns them (`{}` when the file had none, or a map that is not valid), every later call `{}`.
   * The state never holds them, so the next write drops the key from the file.
   */
  takeLegacyHeadingStyles(): HeadingStyles
  setSettings(settings: SettingsState): void
  setSidebarWidth(width: number): void
  /** What a window hands in for the vaults `roots` (YAZ-2631 R5): after a drag on its Favorites tab, its favorites in the new order; after a remove, the stored order without the removed paths (R23). Merged into the one order across vaults (`mergeFavoritesOrder`). The same order is no commit. */
  setFavoritesOrder(roots: readonly string[], paths: readonly string[]): void
  /** The same for the Focus tab (YAZ-2702 Decision 3): what a window hands in for the vaults `roots` after a drag, a remove or a clear on its Focus tab, merged into `focusOrder` by the same function. The same order is no commit. */
  setFocusOrder(roots: readonly string[], paths: readonly string[]): void
  pushRecent(path: string, now?: number): void
  removeRecent(path: string): void
  setFolder(root: string, patch: FolderPatch): void
  setFolds(root: string, file: string, keys: readonly string[]): void
  /** What one note's table of contents is built from (YAZ-2700 D14). `null` is Auto: the entry goes, and Auto is never stored. */
  setTocSource(root: string, file: string, source: TocSource | null): void
  /** One note's "Section indent" switch (YAZ-2709 D2). `true` and `false` are both stored; nothing here removes an entry. */
  setSectionIndent(root: string, file: string, on: boolean): void
  /** One note's "Table of contents" switch (YAZ-2950). The same terms as `setSectionIndent`. */
  setTocSwitch(root: string, file: string, on: boolean): void
  setBaseGroups(root: string, key: string, collapsed: readonly string[]): void
  /**
   * `roots` may be left out: the entry then keeps `root` alone. Either way the vault-list invariant is applied (`normalizeRoots`).
   * `opened` is the page that just came on show in the window (YAZ-2663 D1): the SAME commit adds one
   * use of it to the open history of the vault of the entry that holds it (R2). A page that none of
   * its vaults holds adds nothing.
   */
  upsertWindow(entry: Omit<WindowEntry, 'rightPanel' | 'roots'> & Partial<Pick<WindowEntry, 'rightPanel' | 'roots'>>, opened?: string | null, now?: number): void
  /**
   * A save the app made (YAZ-3235 D1): the vault of `roots` that holds `file` (the most specific) logs
   * it in its save log. A save under EDIT_GAP_MS after the last logged one, or of a path no vault holds, commits nothing.
   */
  addEdit(roots: readonly string[], file: string, now?: number): void
  /** Several ids go in one commit (YAZ-2589 D3: the windows a launch does not bring back). */
  removeWindow(...ids: string[]): void
  /**
   * Repair every stored reference to a just-renamed file OR directory (Links E1 GRO-2194,
   * E1b GRO-2241): window `root`/`file`/`tabs` (through `normalizeTabs`), recents, each
   * folder-state key and its `expanded`/`lastFile`/fold keys/
   * baseGroups keys (`<basePath>::<view>`)/open history (YAZ-2663 S8)/table of contents sources (YAZ-2700 D14)/section indent switches (YAZ-2709 D2)/table of contents switches (YAZ-2950), the vaults of each saved set (YAZ-2602 S71), and the
   * Favorites order and the focus order across vaults (YAZ-2631 R6; YAZ-2702 Decision 3). The focus
   * LIST is not here: it is in the vault, and `focus.ts` repairs it (YAZ-2702 R10).
   * A dir remaps by prefix — everything at or under it follows,
   * including a window ROOTED at the renamed folder. One commit; a no-op when nothing
   * references it.
   */
  renamePath(oldPath: string, newPath: string): void
  /**
   * Drop every stored reference to a just-deleted file OR directory (GRO-2272) — the delete
   * twin of `renamePath`. A directory removes BY PREFIX: everything at or under it goes.
   *
   * Per field: a window's `file` becomes null (and `normalizeTabs` then empties its tabs),
   * deleted tabs are dropped, `recents` loses the entry, and folder-state keys plus their
   * `expanded` / `lastFile` / fold keys / `baseGroups` keys
   * (`<basePath>::<view>`) / open history entries (YAZ-2663 S8) / table of contents sources / section indent switches / table of contents switches go too. A saved set loses the vault, and a set with fewer than two
   * vaults left is removed (YAZ-2602 S71). The Favorites order and the focus order across vaults lose the entry (YAZ-2631 R6; YAZ-2702 Decision 3).
   * A window's `root` is deliberately LEFT ALONE: the renderer's existing `onRootMissing`
   * probe owns that repair (it also drops the dead MRU entry), and nulling it here would
   * race it. One commit; a no-op when nothing references the path.
   */
  removePath(path: string): void
  /**
   * Save `roots` as a set of vaults under `name` (YAZ-2602 D8) and answer the saved set. A set with
   * the same cleaned name is REPLACED: it keeps its `id`, takes the new vaults and moves to the front
   * (S63, S69). Refused with null, and no commit: fewer than two vaults after cleaning, an empty
   * name, or a NEW name when MAX_VAULT_SETS sets exist (S68, R12).
   */
  saveVaultSet(name: string, roots: readonly string[], now?: number): VaultSet | null
  /** Rename a saved set (S67). False, and no commit: an unknown `id`, an empty name, or a name a DIFFERENT set has. */
  renameVaultSet(id: string, name: string): boolean
  /** Forget a saved set (S67); its folders are never touched. An unknown `id` is a no-op. */
  removeVaultSet(id: string): void
  /** The set was just used (S65): `lastUsed` is `now`, and it moves to the front. An unknown `id` is a no-op. */
  touchVaultSet(id: string, now?: number): void
  /**
   * Save `tabs` as a session (YAZ-3147 D2) and answer it. The tabs are cut at MAX_SESSION_TABS, and only
   * the vaults of `roots` that hold a tab are kept. A new session goes to the front. With `replaceId`
   * ("Update with open tabs", S28) the session keeps its id and its name, takes the new tabs and moves to
   * the front. Refused with null, and no commit: no tab, an unknown `replaceId`, or for a NEW session an
   * empty name or MAX_SESSIONS sessions (S7).
   */
  saveSession(name: string, tabs: readonly StoredTab[], roots: readonly string[], replaceId?: string, now?: number): Session | null
  /** Rename a session (S12). False, and no commit: an unknown `id` or an empty name. Two sessions can have one name (S10). */
  renameSession(id: string, name: string): boolean
  /** "Remove from session" (S30): the session's tabs are now `tabs`, and its vaults follow them. Its place in the list stays. A session with no tab stays (S31). False for an unknown `id`. */
  setSessionTabs(id: string, tabs: readonly StoredTab[]): boolean
  /** "Delete session" (S32); no file and no window is touched. An unknown `id` is a no-op. */
  removeSession(id: string): void
  /** The session was just restored (S26): `lastUsed` is `now`, and it moves to the front. An unknown `id` is a no-op. */
  touchSession(id: string, now?: number): void
  onChange(listener: (state: AppState) => void): () => void
  flush(): Promise<void>
}

export const WRITE_DEBOUNCE_MS = 150

// ---------- validation (field by field; anything off falls back to its default) ----------

const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const isHexColour = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
const clampSidebarWidth = (w: number): number => Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, w))
const clampRightPanelWidth = (w: number): number => Math.min(RIGHT_PANEL_MAX_W, Math.max(RIGHT_PANEL_MIN_W, w))

export const isRecentRoots = (v: unknown): v is RecentRoots =>
  Array.isArray(v) && v.every((x) => isRecord(x) && typeof x.path === 'string' && isFiniteNumber(x.lastOpened))

/** The canvas panel's memory (YAZ-3038, Draw's 🔒 YAZ-1775 D10): both halves guarded; on load an unknown tab reads as the default. */
export const isCanvasPanel = (v: unknown): v is CanvasPanelState => isRecord(v) && isCanvasPanelTab(v.tab) && typeof v.docked === 'boolean'
const sanitizeCanvasPanel = (raw: unknown): CanvasPanelState => {
  const src = isRecord(raw) ? raw : {}
  return { tab: isCanvasPanelTab(src.tab) ? src.tab : DEFAULT_CANVAS_PANEL.tab, docked: typeof src.docked === 'boolean' ? src.docked : DEFAULT_CANVAS_PANEL.docked }
}

/**
 * The 1.0.15 map of changed heading levels (YAZ-3049 D1), `settings.headingStyles`: keys `h1`-`h6`
 * only. One bad level or field fails the whole map. Since 1.0.16 the styles live in each vault
 * (YAZ-3066 D10); the loader keeps a valid map ONCE for `takeLegacyHeadingStyles` (D11).
 */
export const isHeadingStyles = (v: unknown): v is HeadingStyles =>
  isRecord(v) && Object.entries(v).every(([key, style]) => (HEADING_KEYS as readonly string[]).includes(key) && isHeadingStyle(style))

/** Per-field guards shared by the loader, `sanitizeSettings` and the IPC boundary (`isSettings`). */
const SETTINGS_FIELD_OK: { [K in keyof SettingsState]: (v: unknown) => v is SettingsState[K] } = {
  lineSpacing: isFiniteNumber,
  blockGap: isFiniteNumber,
  bulletThreading: (v): v is boolean => typeof v === 'boolean',
  threadWidth: (v): v is number => isFiniteNumber(v) && THREAD_WIDTHS.includes(v),
  threadColor: (v): v is string | null => v === null || isHexColour(v),
  theme: (v): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v),
  contentWidth: (v): v is ContentWidth => typeof v === 'string' && (CONTENT_WIDTHS as readonly string[]).includes(v),
  newNoteLocation: (v): v is NewNoteLocation => typeof v === 'string' && (NEW_NOTE_LOCATIONS as readonly string[]).includes(v),
  newNoteFolder: (v): v is string => typeof v === 'string' && isValidNewNoteFolder(v),
  confirmDelete: (v): v is boolean => typeof v === 'boolean',
  confirmRename: (v): v is boolean => typeof v === 'boolean',
  hoverPreview: (v): v is boolean => typeof v === 'boolean',
  commentsOrder: (v): v is CommentsOrder => typeof v === 'string' && (COMMENTS_ORDERS as readonly string[]).includes(v),
  startupWindows: (v): v is StartupWindows => typeof v === 'string' && (STARTUP_WINDOWS as readonly string[]).includes(v),
  sectionStep: (v): v is number => isFiniteNumber(v) && SECTION_STEPS.includes(v),
  sectionLines: (v): v is SectionLines => typeof v === 'string' && (SECTION_LINES as readonly string[]).includes(v),
  tableOfContents: (v): v is TableOfContents => typeof v === 'string' && (TABLE_OF_CONTENTS as readonly string[]).includes(v),
  tableOfContentsWidth: (v): v is number => isFiniteNumber(v) && v >= TOC_MIN_W && v <= TOC_MAX_W,
  tocLines: (v): v is TocLines => typeof v === 'string' && (TOC_LINES as readonly string[]).includes(v),
  // The canvas prefs (YAZ-3028, Draw's 🔒 YAZ-1775 D9): strict here, the IPC boundary's check; `sanitizeSettings` repairs them field by field.
  canvas: isCanvasPrefs,
  diagramDarkColors: (v): v is DiagramDarkColors => typeof v === 'string' && (DIAGRAM_DARK_COLORS as readonly string[]).includes(v),
  // YAZ-3038 (Draw's 🔒 YAZ-1775 D5): an absolute path the user picked, or null for `<userData>/library`. Never
  // `''` — an empty string would resolve to the process cwd, which is not a place for a user's library.
  libraryFolder: (v): v is string | null => v === null || (typeof v === 'string' && isAbsolute(v)),
  canvasPanel: isCanvasPanel,
}
const SETTINGS_KEYS = Object.keys(SETTINGS_FIELD_OK) as Array<keyof SettingsState>

/** Stored settings merged field-by-field over defaults, so partial/stale shapes stay usable. */
export function sanitizeSettings(raw: unknown): SettingsState {
  const src = isRecord(raw) ? raw : {}
  const out = { ...DEFAULT_SETTINGS }
  for (const k of SETTINGS_KEYS) {
    const v = src[k]
    if (SETTINGS_FIELD_OK[k](v)) (out as Record<string, unknown>)[k] = v
  }
  // A store written before a canvas pref existed keeps every pref it does have, instead of resetting the lot.
  out.canvas = sanitizeCanvasPrefs(src.canvas)
  out.canvasPanel = sanitizeCanvasPanel(src.canvasPanel)
  return out
}

/** Strict: every field present and valid (the IPC boundary rejects anything else). */
export const isSettings = (v: unknown): v is SettingsState => isRecord(v) && SETTINGS_KEYS.every((k) => SETTINGS_FIELD_OK[k](v[k]))

export const isWindowBounds = (v: unknown): v is WindowBounds =>
  isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) && isFiniteNumber(v.width) && isFiniteNumber(v.height)

/** Core v1 shape; additive window-identity fields are repaired separately. */
type StoredWindowEntry = Pick<WindowEntry, 'id' | 'root' | 'file' | 'bounds'> & { roots?: unknown; tabs?: unknown; tabStrip?: unknown; rightPanel?: unknown; sidebarCollapsed?: unknown; sidebarLens?: unknown }
const isStoredWindowEntry = (v: unknown): v is StoredWindowEntry =>
  isRecord(v) && typeof v.id === 'string' && isStringOrNull(v.root) && isStringOrNull(v.file) && isWindowBounds(v.bounds)

/**
 * The tabs invariant (GRO-2232), shared by the loader and the IPC boundary (`ipc/window.ts`):
 * de-duplicates preserving first occurrence, prepends a non-null `file` that is missing —
 * `file` IS the active tab, so a legacy entry without `tabs` becomes `[file]` — and clears
 * the list when `file` is null (`tabs: []` ⇔ `file: null`).
 */
export function normalizeTabs(tabs: readonly string[], file: string | null): string[] {
  if (file === null) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tabs) {
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  if (!seen.has(file)) out.unshift(file)
  return out
}

/** One stored tab (YAZ-3057), or null: an absolute path, a display name cleaned like a vault's, and the active mark. */
export function readStoredTab(raw: unknown): StoredTab | null {
  if (!isRecord(raw) || typeof raw.path !== 'string' || !isAbsolute(raw.path)) return null
  const name = cleanVaultName(raw.name)
  return { path: raw.path, ...(name === null ? {} : { name }), ...(raw.active === true ? { active: true as const } : {}) }
}

/**
 * The strip invariant (YAZ-3057), shared by the loader, every window write, rename and delete: the
 * strip's paths, each once and in order, are `tabs`. A tab that is no longer open drops; a strip that
 * still disagrees drops whole, and the window opens `tabs` as before. A strip with no copy and no name
 * is not kept, so a window without either stores what it always did. The active mark stays on ONE
 * copy of `file` at most.
 */
export function normalizeTabStrip(strip: readonly StoredTab[] | undefined, tabs: readonly string[], file: string | null): StoredTab[] | undefined {
  if (strip === undefined) return undefined
  const open = new Set(tabs)
  const kept = strip.filter((t) => open.has(t.path))
  const order = [...new Set(kept.map((t) => t.path))]
  if (order.length !== tabs.length || order.some((path, i) => path !== tabs[i])) return undefined
  if (kept.length === tabs.length && kept.every((t) => t.name === undefined)) return undefined
  let marked = false
  return kept.map(({ path, name, active }) => {
    const on = active === true && path === file && !marked
    if (on) marked = true
    return { path, ...(name === undefined ? {} : { name }), ...(on ? { active: true as const } : {}) }
  })
}

/** `w` with its strip made true to `tabs` and `file` (`normalizeTabStrip`); no strip, no key. */
function withTabStrip(w: WindowEntry, strip: readonly StoredTab[] | undefined): WindowEntry {
  const { tabStrip: _old, ...rest } = w
  const tabStrip = normalizeTabStrip(strip, w.tabs, w.file)
  return tabStrip === undefined ? rest : { ...rest, tabStrip }
}

/** Repair the additive v1 right-panel shape and enforce one editable owner per window. */
export function normalizeRightPanel(raw: unknown, tabs: readonly string[]): RightPanelIdentity {
  if (!isRecord(raw)) return defaultRightPanelIdentity()
  const tabSet = new Set(tabs)
  const seen = new Set<string>()
  const items = (Array.isArray(raw.items) ? raw.items : []).filter((value): value is string => {
    if (typeof value !== 'string' || !isAbsolute(value) || tabSet.has(value) || seen.has(value)) return false
    seen.add(value)
    return true
  })
  return {
    open: raw.open === true,
    width: isFiniteNumber(raw.width) ? clampRightPanelWidth(raw.width) : RIGHT_PANEL_DEFAULT_W,
    items,
    expanded: typeof raw.expanded === 'string' && items.includes(raw.expanded) ? raw.expanded : null,
  }
}

function sanitizeWindows(raw: unknown, legacySidebarCollapsed: boolean, legacySidebarLens: SidebarLens): WindowEntry[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: WindowEntry[] = []
  for (const w of raw) {
    if (!isStoredWindowEntry(w) || seen.has(w.id)) continue
    seen.add(w.id)
    // Junk `tabs` elements (non-strings, relative paths) drop; a missing/invalid list repairs from `file`.
    const rawTabs: unknown = (w as { tabs?: unknown }).tabs
    const tabs = normalizeTabs(Array.isArray(rawTabs) ? rawTabs.filter((t): t is string => typeof t === 'string' && isAbsolute(t)) : [], w.file)
    // The strip (YAZ-3057) reads with the same rule: a junk element drops, and a strip that disagrees with `tabs` drops whole.
    const rawStrip: unknown = w.tabStrip
    const tabStrip = normalizeTabStrip(Array.isArray(rawStrip) ? rawStrip.map(readStoredTab).filter((t): t is StoredTab => t !== null) : undefined, tabs, w.file)
    const rightPanel = normalizeRightPanel((w as { rightPanel?: unknown }).rightPanel, tabs)
    const sidebarCollapsed = typeof w.sidebarCollapsed === 'boolean' ? w.sidebarCollapsed : legacySidebarCollapsed
    const sidebarLens = isSidebarLens(w.sidebarLens) ? w.sidebarLens : legacySidebarLens
    // The window's old `focusList` (YAZ-2619) is NOT read (YAZ-2702 Decision 4: no migration): focus is the
    // vault's now, in the vault. The entry is built from the fields below alone, so the next write drops the key.
    // The vault list (YAZ-2602 S74) reads with the `tabs` rule: a junk ELEMENT drops and the rest stay, and a missing list repairs from `root`.
    const roots = normalizeRoots(Array.isArray(w.roots) ? w.roots.filter((r): r is string => typeof r === 'string' && isAbsolute(r)) : [], w.root)
    out.push({ id: w.id, root: w.root, roots, file: w.file, tabs, ...(tabStrip === undefined ? {} : { tabStrip }), rightPanel, sidebarCollapsed, sidebarLens, bounds: { x: w.bounds.x, y: w.bounds.y, width: w.bounds.width, height: w.bounds.height } })
  }
  return out
}

/** Shared by `folds` and `baseGroups`: key → non-empty string list, junk dropped, each list capped. */
function sanitizeKeyLists(raw: unknown, cap: number): Record<string, string[]> {
  if (!isRecord(raw)) return {}
  const out: Record<string, string[]> = {}
  for (const [key, keys] of Object.entries(raw)) {
    if (isStringArray(keys) && keys.length > 0) out[key] = keys.slice(0, cap)
  }
  return out
}

/** The open history (YAZ-2663 D1, S9): page → its use. A wrong entry drops alone — a path that is not absolute, or a use without a score above 0 and a time — and the record is cut at MAX_OPENS. */
function sanitizeOpens(raw: unknown): Record<string, OpenStat> {
  if (!isRecord(raw)) return {}
  const out: Array<[string, OpenStat]> = []
  for (const [file, stat] of Object.entries(raw)) {
    if (isAbsolute(file) && isRecord(stat) && isFiniteNumber(stat.score) && stat.score > 0 && isFiniteNumber(stat.last)) out.push([file, { score: stat.score, last: stat.last }])
  }
  return Object.fromEntries(out.slice(0, MAX_OPENS))
}

/** The save log (YAZ-3235 D1, S11): file → time. A wrong entry drops alone — a path that is not absolute, or a time that is not a finite number — and the log is cut at MAX_EDITS. */
function sanitizeEdits(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {}
  const out: Array<[string, number]> = []
  for (const [file, time] of Object.entries(raw)) {
    if (isAbsolute(file) && isFiniteNumber(time)) out.push([file, time])
  }
  return Object.fromEntries(out.slice(0, MAX_EDITS))
}

/** The table of contents sources (YAZ-2700 D14): page → `headings` or `bullets`. A wrong entry drops alone — a path that is not absolute, or any other value, `auto` among them: Auto is the absence of an entry. */
function sanitizeTocSources(raw: unknown): Record<string, TocSource> {
  if (!isRecord(raw)) return {}
  const out: Record<string, TocSource> = {}
  for (const [file, source] of Object.entries(raw)) {
    if (isAbsolute(file) && isTocSource(source)) out[file] = source
  }
  return out
}

/** A page switch of the cog — "Section indent" (YAZ-2709 D2) and "Table of contents" (YAZ-2950): page → `true` or `false`. A wrong entry drops alone — a path that is not absolute, or a value that is not a boolean (`1`, `"true"`, `null`) — and the note then reads as a note with no entry. */
function sanitizeSwitches(raw: unknown): Record<string, boolean> {
  if (!isRecord(raw)) return {}
  const out: Record<string, boolean> = {}
  for (const [file, on] of Object.entries(raw)) {
    if (isAbsolute(file) && typeof on === 'boolean') out[file] = on
  }
  return out
}

function sanitizeFolder(raw: unknown): FolderState | null {
  if (!isRecord(raw)) return null
  return {
    // Tree expansion is SESSION state (YAZ-1642): never restored, never written (`toDisk`).
    // A relaunch starts every tree collapsed; a pre-1642 file's leftover lists are ignored.
    expanded: [],
    lastFile: typeof raw.lastFile === 'string' ? raw.lastFile : null,
    folds: sanitizeKeyLists(raw.folds, MAX_FOLD_KEYS_PER_FILE),
    baseGroups: sanitizeKeyLists(raw.baseGroups, MAX_COLLAPSED_GROUP_KEYS),
    opens: sanitizeOpens(raw.opens),
    edits: sanitizeEdits(raw.edits),
    tocSources: sanitizeTocSources(raw.tocSources),
    sectionIndents: sanitizeSwitches(raw.sectionIndents),
    tocSwitches: sanitizeSwitches(raw.tocSwitches),
    name: cleanVaultName(raw.name),
    key: cleanVaultKey(raw.key),
  }
}

function sanitizeFolders(raw: unknown): Record<string, FolderState> {
  if (!isRecord(raw)) return {}
  const out: Record<string, FolderState> = {}
  const taken = new Set<number>()
  for (const [root, folder] of Object.entries(raw)) {
    const clean = sanitizeFolder(folder)
    if (clean === null) continue
    // One vault per number (YAZ-2555 S21): in a damaged file the first vault keeps it.
    if (clean.key !== null) {
      if (taken.has(clean.key)) clean.key = null
      else taken.add(clean.key)
    }
    out[root] = clean
  }
  return out
}

/** A saved set's vaults as the store keeps them (YAZ-2602 D8): absolute paths, trailing slash off, each once, MAX_WINDOW_ROOTS at most. */
function cleanSetRoots(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const roots = raw.filter((r): r is string => typeof r === 'string' && isAbsolute(r)).map(stripSlash)
  return normalizeRoots(roots, roots[0] ?? null)
}

/** The saved sets (YAZ-2602 D8) read with the windows' rule: a bad entry drops alone. A set needs a string id of its own, a name and two vaults. */
function sanitizeVaultSets(raw: unknown): VaultSet[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: VaultSet[] = []
  for (const s of raw) {
    if (!isRecord(s) || typeof s.id !== 'string' || seen.has(s.id)) continue
    const name = cleanVaultName(s.name)
    const roots = cleanSetRoots(s.roots)
    if (name === null || roots.length < 2) continue
    seen.add(s.id)
    out.push({ id: s.id, name, roots, lastUsed: isFiniteNumber(s.lastUsed) ? s.lastUsed : 0 })
  }
  return out.slice(0, MAX_VAULT_SETS)
}

/** A session's tabs as the store keeps them (YAZ-3147 D2): each a stored tab (`readStoredTab`), MAX_SESSION_TABS at most, the active mark on ONE tab at most. */
function cleanSessionTabs(raw: unknown): StoredTab[] {
  if (!Array.isArray(raw)) return []
  let marked = false
  const out: StoredTab[] = []
  for (const t of raw) {
    const tab = readStoredTab(t)
    if (tab === null) continue
    if (tab.active === true && marked) delete tab.active
    if (tab.active === true) marked = true
    out.push(tab)
    if (out.length === MAX_SESSION_TABS) break
  }
  return out
}

/** A session's vaults (YAZ-3147 D2): `roots` cleaned like a saved set's, and only the ones that hold a tab (`rootOfPath`: the most specific vault). */
function sessionRoots(tabs: readonly StoredTab[], raw: unknown): string[] {
  const roots = cleanSetRoots(raw)
  const held = new Set(tabs.map((t) => rootOfPath(roots, t.path)))
  return roots.filter((r) => held.has(r))
}

/** The sessions (YAZ-3147 D2) read with the windows' rule: a bad entry drops alone. A session needs a string id of its own and a name; a session with no tab is good (S31). */
function sanitizeSessions(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Session[] = []
  for (const s of raw) {
    if (!isRecord(s) || typeof s.id !== 'string' || seen.has(s.id)) continue
    const name = cleanVaultName(s.name)
    if (name === null) continue
    seen.add(s.id)
    const tabs = cleanSessionTabs(s.tabs)
    out.push({ id: s.id, name, tabs, roots: sessionRoots(tabs, s.roots), lastUsed: isFiniteNumber(s.lastUsed) ? s.lastUsed : 0 })
  }
  return out.slice(0, MAX_SESSIONS)
}

/** An order across vaults — `favoritesOrder` (YAZ-2631 D1) and `focusOrder` (YAZ-2702 Decision 3): absolute paths, cut at the limit; a missing or junk list is empty. */
const sanitizeOrder = (raw: unknown): string[] => (isStringArray(raw) ? raw.filter(isAbsolute).slice(0, MAX_FAVORITES_ORDER) : [])

/** The file's shape: each folder bucket minus its session field (YAZ-1642) — what a relaunch restores, nothing more. */
function toDisk(state: AppState): unknown {
  const folders = Object.fromEntries(Object.entries(state.folders).map(([root, { expanded: _e, ...kept }]) => [root, kept]))
  return { ...state, folders }
}

function sanitizeState(raw: unknown): AppState | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  // YAZ-1280 migration: a v1 file's retired global value seeds only windows that do not yet
  // have their own value. The returned state omits the old key, so the next write completes it.
  const legacySidebarCollapsed = raw.sidebarCollapsed === true
  // YAZ-1628 migration, the same shape: a v1 file's retired global lens (YAZ-847) seeds only
  // windows without a valid lens of their own; a pre-847 file has none at all, and missing or
  // junk both read as the default. The returned state omits the old key too.
  const legacySidebarLens: SidebarLens = isSidebarLens(raw.sidebarLens) ? raw.sidebarLens : DEFAULT_SIDEBAR_LENS
  return {
    version: 1,
    settings: sanitizeSettings(raw.settings),
    sidebarWidth: isFiniteNumber(raw.sidebarWidth) ? clampSidebarWidth(raw.sidebarWidth) : SIDEBAR_DEFAULT_W,
    recents: isRecentRoots(raw.recents) ? raw.recents.slice(0, MAX_RECENT_ROOTS) : [],
    windows: sanitizeWindows(raw.windows, legacySidebarCollapsed, legacySidebarLens),
    folders: sanitizeFolders(raw.folders),
    vaultSets: sanitizeVaultSets(raw.vaultSets),
    favoritesOrder: sanitizeOrder(raw.favoritesOrder),
    focusOrder: sanitizeOrder(raw.focusOrder),
    sessions: sanitizeSessions(raw.sessions),
  }
}

// ---------- loading ----------

/**
 * A state file's text as a state, or null when it is not one: bad JSON, or not a version-1 object.
 * `yaseendocs vaults` reads the file through it too (YAZ-2556 D2), so the command sees the state
 * the app would load, field for field — and, unlike `load`, it never moves a file aside.
 */
export function parseState(text: string): AppState | null {
  return parseStateDetailed(text)?.state ?? null
}

/** A loaded state, and the 1.0.15 heading styles its file still held (YAZ-3066 D11); `{}` for none, or for a map that is not valid. */
interface Loaded {
  state: AppState
  legacyHeadingStyles: HeadingStyles
}

/**
 * `parseState` with the one retired value the main process still needs: `settings.headingStyles`
 * of 1.0.15. The state omits it (the settings keep only known keys), so the next write drops it
 * from the file; until then `takeLegacyHeadingStyles` hands it out once.
 */
function parseStateDetailed(text: string): Loaded | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  const state = sanitizeState(raw)
  if (state === null) return null
  const legacy = isRecord(raw) && isRecord(raw.settings) ? raw.settings.headingStyles : undefined
  return { state, legacyHeadingStyles: isHeadingStyles(legacy) ? legacy : {} }
}

/** Reads the file synchronously; a corrupt one is moved aside as `<file>.corrupt-<epoch>` and defaults are used. */
function load(filePath: string): Loaded {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: defaultAppState(), legacyHeadingStyles: {} }
    throw err
  }
  const loaded = parseStateDetailed(raw)
  if (loaded !== null) return loaded
  const backup = `${filePath}.corrupt-${Date.now()}`
  try {
    renameSync(filePath, backup)
    console.error(`[store] ${filePath} is not a valid app state; moved to ${backup} and using defaults`)
  } catch (err) {
    console.error(`[store] ${filePath} is not a valid app state and could not be moved aside: ${String(err)}`)
  }
  return { state: defaultAppState(), legacyHeadingStyles: {} }
}

// ---------- the store ----------

export function createStore(filePath: string): Store {
  const loaded = load(filePath)
  let state = loaded.state
  /** The 1.0.15 heading styles (YAZ-3066 D11), handed out once. */
  let legacyHeadingStyles: HeadingStyles | null = loaded.legacyHeadingStyles
  const listeners = new Set<(state: AppState) => void>()
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Writes are chained so two atomic writes can never land out of order. */
  let chain: Promise<void> = Promise.resolve()
  /**
   * The text of the last successful write (YAZ-2198). Session-only state (`expanded`)
   * never reaches disk, so every folder expand / collapse used to rewrite
   * byte-identical JSON; identical text is skipped. The first write after a launch always writes.
   */
  let lastWritten: string | null = null

  const write = (): Promise<void> => {
    dirty = false
    const snapshot = state
    chain = chain
      .then(async () => {
        const text = `${JSON.stringify(toDisk(snapshot), null, 2)}\n`
        if (text === lastWritten) return
        mkdirSync(dirname(filePath), { recursive: true })
        await atomicWrite(filePath, text)
        lastWritten = text
      })
      .catch((err: unknown) => console.error(`[store] failed to write ${filePath}: ${String(err)}`))
    return chain
  }

  const commit = (next: AppState): void => {
    state = next
    dirty = true
    listeners.forEach((l) => l(next))
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void write()
    }, WRITE_DEBOUNCE_MS)
  }

  const folderOf = (root: string): FolderState => state.folders[root] ?? defaultFolderState()

  return {
    get: () => state,

    takeLegacyHeadingStyles() {
      const legacy = legacyHeadingStyles ?? {}
      legacyHeadingStyles = null
      return legacy
    },

    setSettings(settings) {
      commit({ ...state, settings: sanitizeSettings(settings) })
    },

    setSidebarWidth(width) {
      commit({ ...state, sidebarWidth: clampSidebarWidth(width) })
    },

    setFavoritesOrder(roots, paths) {
      const favoritesOrder = mergeFavoritesOrder(state.favoritesOrder, roots, paths)
      if (favoritesOrder !== state.favoritesOrder) commit({ ...state, favoritesOrder })
    },

    setFocusOrder(roots, paths) {
      const focusOrder = mergeFavoritesOrder(state.focusOrder, roots, paths)
      if (focusOrder !== state.focusOrder) commit({ ...state, focusOrder })
    },

    pushRecent(path, now = Date.now()) {
      commit({ ...state, recents: addRecentRoot(state.recents, path, now) })
    },

    removeRecent(path) {
      if (!state.recents.some((r) => r.path === path)) return
      commit({ ...state, recents: state.recents.filter((r) => r.path !== path) })
    },

    setFolder(root, patch) {
      const cur = folderOf(root)
      const key = patch.key === undefined ? undefined : cleanVaultKey(patch.key)
      const next: FolderState = {
        ...cur,
        ...(patch.expanded !== undefined ? { expanded: [...patch.expanded] } : {}),
        ...(patch.lastFile !== undefined ? { lastFile: patch.lastFile } : {}),
        ...(patch.name !== undefined ? { name: cleanVaultName(patch.name) } : {}),
        ...(key !== undefined ? { key } : {}),
      }
      // One vault per number (YAZ-2555 D2): the same commit takes it from the vault that had it.
      commit({ ...state, folders: { ...(key == null ? state.folders : freeVaultKey(state.folders, key)), [root]: next } })
    },

    setFolds(root, file, keys) {
      const cur = folderOf(root)
      const folds = { ...cur.folds }
      if (keys.length === 0) delete folds[file]
      else folds[file] = keys.slice(0, MAX_FOLD_KEYS_PER_FILE)
      commit({ ...state, folders: { ...state.folders, [root]: { ...cur, folds } } })
    },

    setTocSource(root, file, source) {
      const cur = folderOf(root)
      // Auto on a note that is on Auto already: nothing to write, nothing to tell the windows.
      if (source === null ? !(file in cur.tocSources) : cur.tocSources[file] === source) return
      const tocSources = { ...cur.tocSources }
      if (source === null) delete tocSources[file]
      else tocSources[file] = source
      commit({ ...state, folders: { ...state.folders, [root]: { ...cur, tocSources } } })
    },

    setSectionIndent(root, file, on) {
      const cur = folderOf(root)
      // The same value again: nothing to write, nothing to tell the windows. Off is a value of its own, so it is stored (D2).
      if (cur.sectionIndents[file] === on) return
      commit({ ...state, folders: { ...state.folders, [root]: { ...cur, sectionIndents: { ...cur.sectionIndents, [file]: on } } } })
    },

    setTocSwitch(root, file, on) {
      const cur = folderOf(root)
      if (cur.tocSwitches[file] === on) return
      commit({ ...state, folders: { ...state.folders, [root]: { ...cur, tocSwitches: { ...cur.tocSwitches, [file]: on } } } })
    },

    setBaseGroups(root, key, collapsed) {
      const cur = folderOf(root)
      const baseGroups = { ...cur.baseGroups }
      if (collapsed.length === 0) delete baseGroups[key]
      else baseGroups[key] = collapsed.slice(0, MAX_COLLAPSED_GROUP_KEYS)
      commit({ ...state, folders: { ...state.folders, [root]: { ...cur, baseGroups } } })
    },

    upsertWindow(entry, opened = null, now = Date.now()) {
      const tabs = normalizeTabs(entry.tabs, entry.file)
      const normalized = withTabStrip({ ...entry, roots: normalizeRoots(entry.roots ?? [], entry.root), tabs, rightPanel: normalizeRightPanel(entry.rightPanel, tabs) }, entry.tabStrip)
      const windows = state.windows.some((w) => w.id === entry.id) ? state.windows.map((w) => (w.id === entry.id ? normalized : w)) : [...state.windows, normalized]
      // The use goes in the commit of the window (YAZ-2663 R2): one write, one broadcast. Its vault is the one of the window that holds the page.
      const vault = opened === null ? null : rootOfPath(normalized.roots, opened)
      const folders = opened === null || vault === null ? state.folders : { ...state.folders, [vault]: { ...folderOf(vault), opens: addOpen(folderOf(vault).opens, opened, now) } }
      commit({ ...state, windows, folders })
    },

    addEdit(roots, file, now = Date.now()) {
      const vault = rootOfPath(roots, file)
      if (vault === null) return
      const edits = addEdit(folderOf(vault).edits, file, now)
      if (edits !== null) commit({ ...state, folders: { ...state.folders, [vault]: { ...folderOf(vault), edits } } })
    },

    removeWindow(...ids) {
      if (!state.windows.some((w) => ids.includes(w.id))) return
      commit({ ...state, windows: state.windows.filter((w) => !ids.includes(w.id)) })
    },

    renamePath(oldPath, newPath) {
      // E1b (GRO-2241): `oldPath` may be a DIRECTORY — every stored path AT or UNDER it
      // follows: window roots (a subfolder opened as a vault!), files and tabs, recents,
      // each folder-state KEY plus its expanded dirs, lastFile, fold keys and baseGroups
      // keys. For a FILE rename the prefix branch is inert (nothing is ever stored under a
      // file path), so ONE mapping serves both kinds — and it is still one commit, one
      // notify, a no-op when nothing references the path.
      let changed = false
      const prefix = `${oldPath}/`
      const remap = (p: string): string => {
        if (p !== oldPath && !p.startsWith(prefix)) return p
        changed = true
        return newPath + p.slice(oldPath.length)
      }
      // A baseGroups key is `<basePath>::<view>` — the exact-file half needs its own test.
      const baseGroupPrefix = `${oldPath}::`
      const remapBaseGroupKey = (key: string): string => {
        if (!key.startsWith(baseGroupPrefix)) return remap(key)
        changed = true
        return newPath + key.slice(oldPath.length)
      }
      // A copy's fold key (YAZ-3131) is `<top>\0<path>`: each half follows the rename on its own.
      const remapFold = (key: string): string => {
        const parts = copyFoldParts(key)
        return parts === null ? remap(key) : copyFoldKey(remap(parts[0]), remap(parts[1]))
      }
      const remapKeys = <T>(lists: Record<string, T>, remapKey: (key: string) => string): Record<string, T> =>
        Object.fromEntries(Object.entries(lists).map(([key, value]) => [remapKey(key), value]))
      const windows = state.windows.map((w) => {
        const root = w.root === null ? null : remap(w.root)
        const file = w.file === null ? null : remap(w.file)
        const tabs = normalizeTabs(w.tabs.map(remap), file)
        // Every copy and its display name follow the file (YAZ-3057 S8, S9).
        return withTabStrip({
          ...w,
          root,
          // Every vault of the window follows its folder, as `root` does (YAZ-2602 S48).
          roots: w.roots.map(remap),
          file,
          tabs,
          rightPanel: normalizeRightPanel({
            ...w.rightPanel,
            items: w.rightPanel.items.map(remap),
            expanded: w.rightPanel.expanded === null ? null : remap(w.rightPanel.expanded),
          }, tabs),
        }, w.tabStrip?.map((t) => ({ ...t, path: remap(t.path) })))
      })
      const recents = state.recents.map((r) => ({ ...r, path: remap(r.path) }))
      const folders = Object.fromEntries(
        Object.entries(state.folders).map(([root, folder]) => [
          remap(root),
          {
            ...folder,
            expanded: folder.expanded.map(remapFold),
            lastFile: folder.lastFile === null ? null : remap(folder.lastFile),
            folds: remapKeys(folder.folds, remap),
            baseGroups: remapKeys(folder.baseGroups, remapBaseGroupKey),
            // The open history (YAZ-2663 S8) is keyed by page, as `folds` is: a renamed page keeps its uses.
            opens: remapKeys(folder.opens, remap),
            // The save log (YAZ-3235 S5), keyed by file as well: a renamed file keeps its last save.
            edits: remapKeys(folder.edits, remap),
            // And the table of contents source (YAZ-2700 D14), keyed the same way: the choice follows its note.
            tocSources: remapKeys(folder.tocSources, remap),
            // And the "Section indent" switch (YAZ-2709 D2), on the same terms.
            sectionIndents: remapKeys(folder.sectionIndents, remap),
            // And the "Table of contents" switch (YAZ-2950).
            tocSwitches: remapKeys(folder.tocSwitches, remap),
          },
        ]),
      )
      // A saved set follows its vault's folder (YAZ-2602 S71), and stays a set: each vault once, two at least.
      const vaultSets = state.vaultSets.map((s) => ({ ...s, roots: cleanSetRoots(s.roots.map(remap)) })).filter((s) => s.roots.length >= 2)
      // A renamed favorite keeps its place in the order across vaults (YAZ-2631 R6), and a renamed focus item in its own (YAZ-2702 Decision 3).
      const favoritesOrder = state.favoritesOrder.map(remap)
      const focusOrder = state.focusOrder.map(remap)
      // Each session's tabs, copies and names follow the file, and its vaults their folders (YAZ-3147 D2, S34).
      const sessions = state.sessions.map((s) => {
        const tabs = s.tabs.map((t) => ({ ...t, path: remap(t.path) }))
        return { ...s, tabs, roots: sessionRoots(tabs, s.roots.map(remap)) }
      })
      if (!changed) return
      commit({ ...state, windows, recents, folders, vaultSets, favoritesOrder, focusOrder, sessions })
    },

    removePath(deleted) {
      // The delete twin of `renamePath` above; read that first — the traversal is identical,
      // only the mapping differs (drop instead of remap). A FILE's prefix branch is inert
      // (nothing is ever stored under a file path), so one pass serves both kinds.
      let changed = false
      const prefix = `${deleted}/`
      /** Is this stored path the deleted entry, or inside it? */
      const gone = (p: string): boolean => p === deleted || p.startsWith(prefix)
      /** A copy's fold key (YAZ-3131) goes when either half goes. */
      const foldGone = (key: string): boolean => (copyFoldParts(key) ?? [key]).some(gone)
      const drop = (paths: readonly string[], isGone = gone): string[] => {
        const kept = paths.filter((p) => !isGone(p))
        if (kept.length !== paths.length) changed = true
        return kept
      }
      /** A baseGroups key is `<basePath>::<view>` — the exact-file half needs its own test. */
      const baseGroupGone = (key: string): boolean => key.startsWith(`${deleted}::`) || gone(key)
      const dropKeys = <T>(map: Record<string, T>, isGone: (key: string) => boolean): Record<string, T> => {
        const kept = Object.entries(map).filter(([key]) => !isGone(key))
        if (kept.length !== Object.keys(map).length) changed = true
        return Object.fromEntries(kept)
      }
      const windows = state.windows.map((w) => {
        // `root` and `roots` are NOT touched here — see the interface doc: the renderer's missing-folder probe owns them (YAZ-2602 S49).
        const tabs = drop(w.tabs)
        let file = w.file
        if (file !== null && gone(file)) {
          changed = true
          // The active file itself went. Pick an HEIR with the same ladder useWorkspace uses —
          // right neighbour, else left — rather than nulling `file`: normalizeTabs returns []
          // for a null file, which would throw away the window's SURVIVING tabs. The renderer
          // picks the same heir a moment later and mirrors it down, but the store is also the
          // boot snapshot, so it has to be correct on its own if the app quits in between.
          const i = w.tabs.indexOf(file)
          file = w.tabs.slice(i + 1).find((t) => !gone(t)) ?? [...w.tabs.slice(0, i)].reverse().find((t) => !gone(t)) ?? null
        }
        const normalizedTabs = normalizeTabs(tabs, file)
        const rightItems = drop(w.rightPanel.items)
        let expanded = w.rightPanel.expanded
        if (expanded !== null && gone(expanded)) {
          changed = true
          const i = w.rightPanel.items.indexOf(expanded)
          expanded = w.rightPanel.items.slice(i + 1).find((item) => !gone(item))
            ?? [...w.rightPanel.items.slice(0, i)].reverse().find((item) => !gone(item))
            ?? null
        }
        // The deleted file's copies leave the strip; its active mark goes with them (YAZ-3057 S10, S11).
        return withTabStrip({
          ...w,
          file,
          tabs: normalizedTabs,
          rightPanel: normalizeRightPanel({ ...w.rightPanel, items: rightItems, expanded }, normalizedTabs),
        }, w.tabStrip)
      })
      const recents = state.recents.filter((r) => !gone(r.path))
      if (recents.length !== state.recents.length) changed = true
      const folders = Object.fromEntries(
        Object.entries(state.folders)
          .filter(([root]) => {
            if (!gone(root)) return true
            changed = true
            return false
          })
          .map(([root, folder]) => [
            root,
            {
              ...folder,
              expanded: drop(folder.expanded, foldGone),
              lastFile: folder.lastFile !== null && gone(folder.lastFile) ? ((changed = true), null) : folder.lastFile,
              folds: dropKeys(folder.folds, gone),
              baseGroups: dropKeys(folder.baseGroups, baseGroupGone),
              opens: dropKeys(folder.opens, gone),
              edits: dropKeys(folder.edits, gone),
              tocSources: dropKeys(folder.tocSources, gone),
              sectionIndents: dropKeys(folder.sectionIndents, gone),
              tocSwitches: dropKeys(folder.tocSwitches, gone),
            },
          ]),
      )
      // A deleted folder leaves each saved set (YAZ-2602 S71); a set with fewer than two vaults left is no set.
      const vaultSets = state.vaultSets.map((s) => ({ ...s, roots: drop(s.roots) })).filter((s) => s.roots.length >= 2)
      // A deleted favorite leaves the order across vaults (YAZ-2631 R6), and a deleted focus item its own (YAZ-2702 Decision 3).
      const favoritesOrder = drop(state.favoritesOrder)
      const focusOrder = drop(state.focusOrder)
      // A deleted file leaves each session, and a vault with no tab left goes with it; a session with no tab stays (YAZ-3147 D2, S31, S34).
      const sessions = state.sessions.map((s) => {
        const tabs = s.tabs.filter((t) => !gone(t.path))
        if (tabs.length === s.tabs.length) return s
        changed = true
        return { ...s, tabs, roots: sessionRoots(tabs, s.roots) }
      })
      if (!changed) return
      commit({ ...state, windows, recents, folders, vaultSets, favoritesOrder, focusOrder, sessions })
    },

    saveVaultSet(rawName, rawRoots, now = Date.now()) {
      const name = cleanVaultName(rawName)
      const roots = cleanSetRoots(rawRoots)
      if (name === null || roots.length < 2) return null
      const existing = state.vaultSets.find((s) => s.name === name)
      // R12 counts sets, so a save under a name that exists is never the one refused.
      if (existing === undefined && state.vaultSets.length >= MAX_VAULT_SETS) return null
      const saved: VaultSet = { id: existing?.id ?? randomUUID(), name, roots, lastUsed: now }
      commit({ ...state, vaultSets: [saved, ...state.vaultSets.filter((s) => s !== existing)] })
      return saved
    },

    renameVaultSet(id, rawName) {
      const name = cleanVaultName(rawName)
      const set = state.vaultSets.find((s) => s.id === id)
      if (name === null || set === undefined || state.vaultSets.some((s) => s !== set && s.name === name)) return false
      if (set.name !== name) commit({ ...state, vaultSets: state.vaultSets.map((s) => (s === set ? { ...s, name } : s)) })
      return true
    },

    removeVaultSet(id) {
      if (!state.vaultSets.some((s) => s.id === id)) return
      commit({ ...state, vaultSets: state.vaultSets.filter((s) => s.id !== id) })
    },

    touchVaultSet(id, now = Date.now()) {
      const set = state.vaultSets.find((s) => s.id === id)
      if (set === undefined || (state.vaultSets[0] === set && set.lastUsed === now)) return
      commit({ ...state, vaultSets: [{ ...set, lastUsed: now }, ...state.vaultSets.filter((s) => s !== set)] })
    },

    saveSession(rawName, rawTabs, rawRoots, replaceId, now = Date.now()) {
      const tabs = cleanSessionTabs(rawTabs)
      if (tabs.length === 0) return null
      const existing = replaceId === undefined ? undefined : state.sessions.find((s) => s.id === replaceId)
      if (replaceId !== undefined && existing === undefined) return null
      // An update keeps the session's own name (S28); only a new session needs one, and counts against the cap (S7).
      const name = existing?.name ?? cleanVaultName(rawName)
      if (name === null || (existing === undefined && state.sessions.length >= MAX_SESSIONS)) return null
      const saved: Session = { id: existing?.id ?? randomUUID(), name, tabs, roots: sessionRoots(tabs, rawRoots), lastUsed: now }
      commit({ ...state, sessions: [saved, ...state.sessions.filter((s) => s !== existing)] })
      return saved
    },

    renameSession(id, rawName) {
      const name = cleanVaultName(rawName)
      const session = state.sessions.find((s) => s.id === id)
      if (name === null || session === undefined) return false
      if (session.name !== name) commit({ ...state, sessions: state.sessions.map((s) => (s === session ? { ...s, name } : s)) })
      return true
    },

    setSessionTabs(id, rawTabs) {
      const session = state.sessions.find((s) => s.id === id)
      if (session === undefined) return false
      const tabs = cleanSessionTabs(rawTabs)
      commit({ ...state, sessions: state.sessions.map((s) => (s === session ? { ...s, tabs, roots: sessionRoots(tabs, s.roots) } : s)) })
      return true
    },

    removeSession(id) {
      if (!state.sessions.some((s) => s.id === id)) return
      commit({ ...state, sessions: state.sessions.filter((s) => s.id !== id) })
    },

    touchSession(id, now = Date.now()) {
      const session = state.sessions.find((s) => s.id === id)
      if (session === undefined || (state.sessions[0] === session && session.lastUsed === now)) return
      commit({ ...state, sessions: [{ ...session, lastUsed: now }, ...state.sessions.filter((s) => s !== session)] })
    },

    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    flush() {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (dirty) return write()
      return chain
    },
  }
}
