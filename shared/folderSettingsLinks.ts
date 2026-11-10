/**
 * WHERE LINKS LIVE inside a folder's settings, and the ONE place that knows it (YAZ-864). Shared so
 * the front end's rename and the main process's ID rewrite (YAZ-2677 D5 to D7, `linkRewrite.ts`)
 * walk the same leaves: there is one link parser, never two.
 */
import { isRecord } from './guards'

/**
 * The one reserved key `client/src/views/folderSettings.ts` owns; nothing else may name it —
 * exported (⚡ YAZ-884) only so the properties panel's RESERVED list can be spelled from the real
 * constants. Reading or writing it stays that module's business.
 */
export const FOLDER_SETTINGS_KEY = 'folder_settings'

/** The notes moved to the folder page's Other files tray (YAZ-4597, D44): `folder_settings.other_files: ["[[…]]"]`. */
export const OTHER_FILES_KEY = 'other_files'

/**
 * The folders in `other_files` whose notes stay in the table (YAZ-4747 OF2, "Move the folder only"):
 * `folder_settings.other_files_keep_notes: ["[[…]]"]`. A folder in `other_files` without an entry here takes its notes.
 */
export const OTHER_FILES_KEEP_NOTES_KEY = 'other_files_keep_notes'

/**
 * A rename has to walk INTO `folder_settings` — the one reserved key with app-defined link
 * semantics (🔒 Q1) — and the rule that no surface re-parses that key holds for the rename engine
 * too: it comes through here, and the key STRING rides back in the result rather than being spelled
 * anywhere else.
 *
 * The link-bearing leaves are exactly six: every view's [D5] `order` entry (🔒 Q3), every view's
 * `fills[].note` (YAZ-4536), every column's belongs-to `target` (🔒 Q2), every Linked mentions column's
 * `from.folder` (YAZ-4739), every `other_files` entry (YAZ-4597 D44) and every `other_files_keep_notes` entry (YAZ-4747) — the places this
 * vocabulary spells a wikilink. Each string leaf is offered to `map`; `undefined` means LEAVE IT.
 * Everything else in the value — unknown view types, extra keys, unusable shapes, an old Outline's
 * `outline` string (YAZ-4584 D40: the folder's document is its Page, the `.folder.md` body, whose
 * links a rename rewrites as a note's) — rides along verbatim.
 *
 * Deliberately over the RAW value, not the tolerant read: `folderSettings()` normalises and
 * DROPS what it cannot use, so a rewrite built on it would quietly delete a hand-written shape,
 * and a probe built on it would disagree with the rewrite about which leaves even exist. Null when
 * no leaf changed, so a page with settings but no reference is never written at all.
 */
export function mapFolderSettingsLinks(
  properties: Record<string, unknown>,
  map: (link: string) => string | undefined,
): { key: string; value: unknown } | null {
  const raw = properties[FOLDER_SETTINGS_KEY]
  if (!isRecord(raw)) return null
  let changed = false
  const mapLink = (link: unknown): unknown => {
    const next = typeof link === 'string' ? map(link) : undefined
    if (next === undefined) return link
    changed = true
    return next
  }
  // Spread-then-reassign, so every untouched key keeps its value AND its position.
  const value: Record<string, unknown> = { ...raw }
  if (Array.isArray(raw.views)) {
    value.views = raw.views.map((view: unknown) => {
      if (!isRecord(view)) return view
      const next: Record<string, unknown> = { ...view }
      if (Array.isArray(view.order)) next.order = view.order.map(mapLink)
      // A cell or row fill names its note by a link (YAZ-4536 D3): a rename keeps the fill on its note.
      if (Array.isArray(view.fills)) next.fills = view.fills.map((fill: unknown) => (isRecord(fill) && 'note' in fill ? { ...fill, note: mapLink(fill.note) } : fill))
      return next
    })
  }
  if (isRecord(raw.columns)) {
    const columns: Record<string, unknown> = {}
    for (const [name, column] of Object.entries(raw.columns)) {
      if (!isRecord(column)) {
        columns[name] = column
        continue
      }
      const next: Record<string, unknown> = 'target' in column ? { ...column, target: mapLink(column.target) } : column
      // A Linked mentions column's `from.folder` names its folder by a link (YAZ-4739): a rename keeps it on that folder.
      if (isRecord(column.from) && 'folder' in column.from) columns[name] = { ...next, from: { ...column.from, folder: mapLink(column.from.folder) } }
      else columns[name] = next
    }
    value.columns = columns
  }
  // A note moved to Other files is named by a link (YAZ-4597 D44): a rename keeps it there.
  if (Array.isArray(raw[OTHER_FILES_KEY])) value[OTHER_FILES_KEY] = raw[OTHER_FILES_KEY].map(mapLink)
  // A folder moved there "folder only" is named by a link too (YAZ-4747 OF5).
  if (Array.isArray(raw[OTHER_FILES_KEEP_NOTES_KEY])) value[OTHER_FILES_KEEP_NOTES_KEY] = raw[OTHER_FILES_KEEP_NOTES_KEY].map(mapLink)
  return changed ? { key: FOLDER_SETTINGS_KEY, value } : null
}

/** The same leaves for a caller that only needs to LOOK — verbatim, in walk order (YAZ-864). */
export function folderSettingsLinks(properties: Record<string, unknown>): string[] {
  const links: string[] = []
  mapFolderSettingsLinks(properties, (link) => {
    links.push(link)
    return undefined
  })
  return links
}
