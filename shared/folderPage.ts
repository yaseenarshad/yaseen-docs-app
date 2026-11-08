/**
 * A folder page's own switch for its file in the sidebar (YAZ-3746 D37), stored IN its `.folder.md` as
 * `readonly` is: `show_page_file: true | false`. The folder page's cog writes it ("Show folder page file":
 * On, Off, or Settings — no key, which follows Settings › Folder pages). The sidebar reads it for that folder
 * and every folder below it; the nearest rule wins. Any other value counts as no key. Pure: no fs, no DOM.
 */
export const SHOW_PAGE_FILE_KEY = 'show_page_file'

/** The folder's own choice off its `.folder.md` properties: `undefined` follows Settings. */
export function showPageFileOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[SHOW_PAGE_FILE_KEY]
  return typeof value === 'boolean' ? value : undefined
}

/**
 * A folder page's own "Preview on hover" (YAZ-4601 D51), stored IN its `.folder.md` as `show_page_file` is:
 * `hover_preview: true | false`. The cog writes it ("Preview on hover": Settings — no key —, On or Off). It covers the
 * row hover and the link pill hover on that page. Any other value counts as no key.
 */
export const HOVER_PREVIEW_KEY = 'hover_preview'

/** The folder's own hover choice off its `.folder.md` properties: `undefined` follows Settings (`hoverOn(settings, 'folderViews')`). */
export function hoverPreviewOf(properties: Readonly<Record<string, unknown>>): boolean | undefined {
  const value = properties[HOVER_PREVIEW_KEY]
  return typeof value === 'boolean' ? value : undefined
}
