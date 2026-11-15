/**
 * The Page tab (YAZ-4584 D38): the folder's own document, the body of its `.folder.md`, in the note
 * editor. It replaced the Outline view, and a stored `type: outline` reads as `page` (`folderSettings`).
 * A folder has at most one.
 */
export const PAGE_VIEW_TYPE = 'page'

/** The index of a folder's Page view, or -1 (the sidebar's page row opens the folder on it, YAZ-4584). */
export function pageViewIndex(views: readonly { type: string }[]): number {
  return views.findIndex((view) => view.type === PAGE_VIEW_TYPE || view.type === 'outline')
}
