/**
 * The saved names that said "note" before YAZ-5036, and their one-time move to "page". A build from YAZ-5036 on READS
 * the old name and the new name, and WRITES only the new one, so nothing resets and no custom key is lost:
 *
 *   - the settings keys in `<userData>/yaseendocs.json` and in the settings folder (`settings-<macId>.json`), and the
 *     values that said `note` (`dailyPageOpens`, `newBoardFolder`, the Markdown icon colour, Folder pages › Subfolders);
 *   - the hotkey IDs (`note.bold` → `page.bold`, `dailyNote` → `dailyPage`) in `hotkeys` and `hotkeysAside`;
 *   - the keys of a folder's `.folder.md` (`other_files_keep_notes`, a fill's `note`, a view's `subfolders: notes`);
 *   - the renderer's remembered boxes (`noteWindow:<folder>`, `explore:box:note`).
 *
 * `sanitizeSettings` drops a key it does not know, so `movedSettings` runs before it. The old names live in this file
 * alone: the rename script skips it, and the guard test allows "note" here.
 *
 * rename-note-to-page: skip-file
 */

/** Settings keys: old → new. */
export const SETTINGS_KEY_MOVES: Readonly<Record<string, string>> = Object.freeze({
  newNoteLocation: 'newPageLocation',
  newNoteFolder: 'newPageFolder',
  newNoteTitleTemplate: 'newPageTitleTemplate',
  noteBulletIndent: 'pageBulletIndent',
  noteBulletGap: 'pageBulletGap',
  enterKeepsStyleNotes: 'enterKeepsStylePages',
  dailyNotes: 'dailyPages',
  dailyNoteFolder: 'dailyPageFolder',
  dailyNoteFormat: 'dailyPageFormat',
  dailyNoteDayFolder: 'dailyPageDayFolder',
  dailyNoteOpens: 'dailyPageOpens',
})

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A value that said "note" (or "notes") now says "page" ("pages"); anything else as it is. */
const pageValue = (v: unknown): unknown => (v === 'note' ? 'page' : v === 'notes' ? 'pages' : v)

/** A hotkey ID: `note.bold` → `page.bold`, `dailyNote` / `app.dailyNote` → `dailyPage` / `app.dailyPage`; an aside ID keeps its `@place`. */
export function movedHotkeyId(id: string): string {
  const [row, ...place] = id.split('@')
  const moved = row.startsWith('note.') ? `page.${row.slice('note.'.length)}` : row === 'dailyNote' ? 'dailyPage' : row === 'app.dailyNote' ? 'app.dailyPage' : row
  return [moved, ...place].join('@')
}

/** A stored `hotkeys` or `hotkeysAside` with each old ID moved; a new ID that is there already wins. */
export function movedHotkeys(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const out: Record<string, unknown> = {}
  for (const [id, key] of Object.entries(raw)) if (movedHotkeyId(id) === id) out[id] = key
  for (const [id, key] of Object.entries(raw)) {
    const to = movedHotkeyId(id)
    if (to !== id && !(to in out)) out[to] = key
  }
  return out
}

/**
 * Stored settings with every old name moved, before `sanitizeSettings` reads them: an old key's value goes to its new
 * key (a new key that is there already wins), the old key goes, and the values that said `note` say `page`. The same
 * object when nothing is old, so a current file costs nothing.
 */
export function movedSettings<T>(raw: T): T {
  if (!isRecord(raw)) return raw
  const old = Object.keys(SETTINGS_KEY_MOVES).some((k) => k in raw)
  const icons = isRecord(raw.sidebarIconColors) && 'note' in raw.sidebarIconColors
  const folderPages = isRecord(raw.folderPages) && raw.folderPages.subfolders === 'notes'
  const values = raw.dailyNoteOpens === 'note' || raw.dailyPageOpens === 'note' || raw.newBoardFolder === 'note'
  const keys = [raw.hotkeys, raw.hotkeysAside].some((h) => isRecord(h) && Object.keys(h).some((id) => movedHotkeyId(id) !== id))
  if (!old && !icons && !folderPages && !values && !keys) return raw
  const out: Record<string, unknown> = { ...raw }
  for (const [from, to] of Object.entries(SETTINGS_KEY_MOVES)) {
    if (!(from in out)) continue
    if (out[to] === undefined) out[to] = out[from]
    delete out[from]
  }
  if ('dailyPageOpens' in out) out.dailyPageOpens = pageValue(out.dailyPageOpens)
  if ('newBoardFolder' in out) out.newBoardFolder = pageValue(out.newBoardFolder)
  if (icons) {
    const { note, ...rest } = raw.sidebarIconColors as Record<string, unknown>
    out.sidebarIconColors = 'page' in rest ? rest : { ...rest, page: note }
  }
  if (folderPages) out.folderPages = { ...(raw.folderPages as Record<string, unknown>), subfolders: 'pages' }
  if ('hotkeys' in out) out.hotkeys = movedHotkeys(out.hotkeys)
  if ('hotkeysAside' in out) out.hotkeysAside = movedHotkeys(out.hotkeysAside)
  return out as T
}

// ---- A folder's `.folder.md` (it travels with the vault, through git, to other people) ----

/** The `.folder.md` key of the "Move the folder only" list: old → new. */
export const OTHER_FILES_KEEP_KEY_MOVE = Object.freeze({ from: 'other_files_keep_notes', to: 'other_files_keep_pages' })

/** A view's `subfolders` value as read: `notes` (before YAZ-5036) reads as `pages`. */
export const movedSubfolders = (v: unknown): unknown => (v === 'notes' ? 'pages' : v)

/** A fill as read: its old `note` link reads as `page` (a `page` that is there already wins). */
export function movedFill(fill: unknown): unknown {
  if (!isRecord(fill) || !('note' in fill)) return fill
  const { note, ...rest } = fill
  return 'page' in rest ? rest : { ...rest, page: note }
}

/** A view of a `.folder.md` as read: `subfolders: notes` reads as `pages`, each fill's `note` as `page`; the same object when nothing is old. */
export function movedView(view: Record<string, unknown>): Record<string, unknown> {
  const subfolders = view.subfolders === 'notes'
  const fills = Array.isArray(view.fills) && view.fills.some((fill) => isRecord(fill) && 'note' in fill)
  if (!subfolders && !fills) return view
  return { ...view, ...(subfolders && { subfolders: 'pages' }), ...(fills && { fills: (view.fills as unknown[]).map(movedFill) }) }
}

// ---- The renderer's remembered boxes (localStorage) ----

/** The page window's box key of a folder, before YAZ-5036. */
export const legacyPageWindowKey = (folder: string): string => `noteWindow:${folder}`
/** The explore stack's box key of the page layer, before YAZ-5036. */
export const LEGACY_EXPLORE_PAGE_BOX_KEY = 'explore:box:note'

/**
 * A remembered item under its new key: the new key's value, else the old key's, moved once (written under the new
 * key, the old key removed). Null when neither holds one.
 */
export function movedStorageItem(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string, old: string): string | null {
  const now = storage.getItem(key)
  if (now !== null) return now
  const was = storage.getItem(old)
  if (was === null) return null
  storage.setItem(key, was)
  storage.removeItem(old)
  return was
}
