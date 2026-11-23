/**
 * A folder page's own switch for its file in the sidebar (YAZ-3746 D37), stored IN its `.folder.md` as
 * `readonly` is: `show_page_file: true | false`. The folder page's cog writes it ("Show folder page file":
 * On, Off, or Settings — no key, which follows Settings › Folder pages). The sidebar reads it for that folder
 * and every folder below it; the nearest rule wins. Any other value counts as no key. Pure: no fs, no DOM.
 */
import { FOLDER_PAGE_CHOICES, type FolderPagesSettings } from './types'
export const SHOW_PAGE_FILE_KEY = 'show_page_file'

/** The folder's own choice off its `.folder.md` properties: `undefined` follows Settings. */
export function showPageFileOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[SHOW_PAGE_FILE_KEY]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * A folder page's own "Preview on hover" (YAZ-4601 D51), stored IN its `.folder.md` as `show_page_file` is:
 * `hover_preview: true | false`. It was the ONE switch over the row hover and the link pill hover on that page. Since
 * demo 13D it is the LEGACY key: the cog writes the two below, and reads this one only where a new key is absent, so a
 * page's old Off still covers both. The cog's first write of either new switch moves the old value onto the other new
 * key and removes this one (`FolderView`). Any other value counts as no key.
 */
export const HOVER_PREVIEW_KEY = 'hover_preview'

/** The folder's own LEGACY hover choice off its `.folder.md` properties: `undefined` = no key. */
export function hoverPreviewOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[HOVER_PREVIEW_KEY]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * The two folder-page hover switches (YAZ-4601 demo 13D), each `true | false` in `.folder.md`, each with the cog's
 * Settings — no key —, On or Off: `hover_rows` is "Preview rows on hover" (a row, a card, a line of Other files;
 * Settings' `hoverOn(settings, 'folderViews')`) and `hover_links` "Preview links on hover" (a link pill in a cell;
 * Settings' `hoverOn(settings, 'folderLinks')`).
 */
export const HOVER_ROWS_KEY = 'hover_rows'
export const HOVER_LINKS_KEY = 'hover_links'

/** The folder's own "Preview rows on hover": its key, else the legacy `hover_preview`; `undefined` follows Settings. */
export function hoverRowsOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[HOVER_ROWS_KEY]
  return typeof value === 'boolean' ? value : hoverPreviewOf(properties)
}

/** The folder's own "Preview links on hover": its key, else the legacy `hover_preview`; `undefined` follows Settings. */
export function hoverLinksOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[HOVER_LINKS_KEY]
  return typeof value === 'boolean' ? value : hoverPreviewOf(properties)
}

/**
 * A folder page's own "Confirm changes" (YAZ-3746 13AN), `confirm_changes: true | false` in its `.folder.md`; the cog's
 * Settings — no key — follows Settings › Folder pages › Confirm changes (on by default). Any other value counts as no key.
 */
export const CONFIRM_CHANGES_KEY = 'confirm_changes'

/** The folder's own choice off its `.folder.md` properties: `undefined` follows Settings. */
export function confirmChangesOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[CONFIRM_CHANGES_KEY]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * A folder page's own "Show New buttons" (YAZ-3746 13BL), `show_new_buttons: true | false` in its `.folder.md`; the cog's
 * Settings — no key — follows Settings › Folder pages › Show New buttons (on by default). Any other value counts as no key.
 */
export const SHOW_NEW_BUTTONS_KEY = 'show_new_buttons'

/** The folder's own choice off its `.folder.md` properties: `undefined` follows Settings. */
export function showNewButtonsOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[SHOW_NEW_BUTTONS_KEY]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * A folder page's own switch for its Other files tray (YAZ-4597, D43), stored IN its `.folder.md` as `show_page_file`
 * is: `show_other_files: true | false`. The cog writes it ("Show Other files": On, Off, or Settings — no key, which
 * follows Settings › Folder pages, default on). Any other value counts as no key.
 */
export const SHOW_OTHER_FILES_KEY = 'show_other_files'

/** The folder's own choice off its `.folder.md` properties: `undefined` follows Settings. */
export function showOtherFilesOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[SHOW_OTHER_FILES_KEY]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * A folder page's own "Show parent folders' columns" (YAZ-4713 C2, C12), `inherit_columns: true | false` in its
 * `.folder.md`; the cog's Settings — no key — follows Settings › Folder pages (on by default). Off: the page shows only
 * the columns its own folder declares. Any other value counts as no key.
 */
export const INHERIT_COLUMNS_KEY = 'inherit_columns'

/** The folder's own choice off its `.folder.md` properties: `undefined` follows Settings. */
export function inheritColumnsOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[INHERIT_COLUMNS_KEY]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * A folder page's own "Show where columns come from" (YAZ-4713 C11), `column_marks: icon | name | off` in its
 * `.folder.md`: the column header's mark (`FolderPagesSettings.columnMarks`). No key follows Settings › Folder pages
 * (`icon` by default). Any other value counts as no key.
 */
export const COLUMN_MARKS_KEY = 'column_marks'

/** The folder's own choice off its `.folder.md` properties: `undefined` follows Settings. */
export function columnMarksOf(properties: Readonly<Record<string, unknown>>): FolderPagesSettings['columnMarks'] | undefined {
  const value = properties[COLUMN_MARKS_KEY]
  return FOLDER_PAGE_CHOICES.columnMarks.find((choice) => choice === value)
}
