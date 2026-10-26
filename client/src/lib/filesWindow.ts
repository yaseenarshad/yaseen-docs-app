/**
 * A FILES WINDOW'S CLICKS (YAZ-3357 D2, D7): a Files window is only the sidebar, so each row's door sends ONE message to
 * main (`window:open-from-files`), and main hands it to the full window that shows the page's vault — or opens one.
 * The sidebar keeps its own doors (click, double click, ⌘-click); a Files window only gives them other callbacks.
 */
import type { FilesAction, FilesOpenHow } from '@shared/types'
import { api } from '../api'

/** An Enter key press is under way in this Files window (D7): set at its `keydown`, cleared when its task ends. */
let enterDown = false
let enterTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Watch this Files window's keys for `filesClickHow` (D7; bug YAZ-3399). An open during the task of an Enter `keydown` is
 * Enter's (the key, or the click it makes on a row button); the flag ends with that task, so no later open reads it.
 * Not `window.event`: it can hold an event whose dispatch is over, or none in a dispatch outside the window. Answers the cleanup.
 */
export function watchFilesKeys(target: Window = window): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || event.isComposing) return
    enterDown = true
    clearTimeout(enterTimer)
    enterTimer = setTimeout(() => {
      enterDown = false
    })
  }
  target.addEventListener('keydown', onKey, true)
  return () => {
    target.removeEventListener('keydown', onKey, true)
    clearTimeout(enterTimer)
    enterDown = false
  }
}

/**
 * How a row's plain open opens from a Files window (D7): Enter keeps the tab, any other open previews. The double click
 * and ⌘-click have doors of their own. Only an Enter whose key press is under way counts (`watchFilesKeys`).
 */
export function filesClickHow(): FilesOpenHow {
  return enterDown ? 'keep' : 'preview'
}

/** Ask main to run `action` in a full window (D2). A refusal is a notice: the click did nothing. */
export function askFromFiles(action: FilesAction, onNotice: (message: string) => void): void {
  api.window.openFromFiles(action).catch((err: unknown) => onNotice(`Can't open that: ${err instanceof Error ? err.message : String(err)}`))
}
