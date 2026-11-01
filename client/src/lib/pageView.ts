/**
 * Each editor answers "how does your page look now?" (YAZ-2951 D4).
 *
 * "Duplicate tab", ⌘⇧N and "Move to new window" give the copy its source's page view: drill-in,
 * live folds, scroll spot and text size. That state lives inside the editor (plugin state, refs),
 * never in the tab model: keeping it there would render App again on each fold and drill-in.
 *
 * So each editor puts ONE reader function here when it opens, keyed by its tab's scroller
 * (`.editor-host`; a code tab's own element, `.code-editor`, YAZ-3451, whose Monaco scrolls inside
 * itself; a drawing's `.drawing-editor`, YAZ-3737 D13, for its pan and zoom), and takes it out when it goes. The
 * reader runs only when an action asks — the three above, and a tab that goes to sleep (YAZ-3737 5A), which keeps
 * the view for its wake: nothing runs while you type, fold, drill in or scroll. A WeakMap: a scroller that
 * leaves the DOM takes its entry with it.
 */
import type { PageView } from '@shared/types'

type PageViewReader = () => PageView

const readers = new WeakMap<Element, PageViewReader>()

/** Answer for `host` (a tab's `.editor-host`, `.code-editor` or `.drawing-editor`); returns the off function, which removes only this reader. */
export function registerPageView(host: Element, read: PageViewReader): () => void {
  readers.set(host, read)
  return () => {
    // A recreated editor in the same scroller registered after this one: leave its reader alone.
    if (readers.get(host) === read) readers.delete(host)
  }
}

/** The page view of tab `tabId` now, or undefined when the tab has no open editor (S8, S9). */
export function readPageView(tabId: string): PageView | undefined {
  const host = document.querySelector(`[data-tab="${CSS.escape(tabId)}"] :is(.editor-host, .code-editor, .drawing-editor)`)
  return host === null ? undefined : readers.get(host)?.()
}
