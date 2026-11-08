/**
 * STAND-IN for 10D's `pageViewIndex` (YAZ-4587 calls it; 10D's file replaces this one at merge, same signature):
 * the index of the folder's Page tab — the view whose type is `page`, or a stored `outline` (D38) — or -1.
 */
export function pageViewIndex(views: readonly { type: string }[]): number {
  return views.findIndex((v) => v.type === 'page' || v.type === 'outline')
}
