/**
 * A FILES WINDOW'S CLICKS (YAZ-3357 D2, D7): a Files window is only the sidebar, so each row's door sends ONE message to
 * main (`window:open-from-files`), and main hands it to the full window that shows the page's vault — or opens one.
 * The sidebar keeps its own doors (click, double click, ⌘-click); a Files window only gives them other callbacks.
 */
import type { FilesAction, FilesOpenHow } from '@shared/types'
import { api } from '../api'

/**
 * How a row's plain open opens from a Files window (D7): a click previews; Enter — a key, or the click a key makes on a
 * row button (no pointer, so `detail` 0) — keeps the tab. The double click and ⌘-click have doors of their own.
 * Only the event being handled NOW decides (bug YAZ-3399): `window.event` can still hold one whose dispatch is over
 * (`eventPhase` NONE), and that one must not turn a later open into a kept tab. With none, the open previews.
 */
export function filesClickHow(event: Event | undefined = window.event): FilesOpenHow {
  if (event === undefined || event.eventPhase === Event.NONE) return 'preview'
  if (event instanceof KeyboardEvent) return event.key === 'Enter' ? 'keep' : 'preview'
  return event instanceof MouseEvent && event.type === 'click' && event.detail === 0 ? 'keep' : 'preview'
}

/** Ask main to run `action` in a full window (D2). A refusal is a notice: the click did nothing. */
export function askFromFiles(action: FilesAction, onNotice: (message: string) => void): void {
  api.window.openFromFiles(action).catch((err: unknown) => onNotice(`Can't open that: ${err instanceof Error ? err.message : String(err)}`))
}
