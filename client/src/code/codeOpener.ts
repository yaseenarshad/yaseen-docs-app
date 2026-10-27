/**
 * A jump opens its file IN THIS TAB, at the place (YAZ-3454 4B, D10): Cmd+click, F12, and a row of
 * the peek box opened with Enter or a double click. Monaco asks its editor opener for any file that
 * is not the editor's own model; this module answers for `file://` targets.
 *
 * THE DOOR. The tab's `onOpenFile` — the same one a note's link uses (`navigate`: this tab, with
 * history, or the tab that already shows the file) — so Back returns the way it does for a link.
 * The place rides beside it: `openCodeAt` keeps it for the file, and the code tab that shows the
 * file takes it — a new tab when it mounts, a tab already open at once.
 *
 * Only a code file opens (`fileKind` `text`): a jump never hands a stub such as `.pyi` to the OS.
 */
import { fileKind } from '@shared/fileKind'
import { monaco } from './monaco'

type Editor = ReturnType<typeof monaco.editor.create>

export interface CodePlace {
  /** 1-based, as Monaco counts. */
  lineNumber: number
  column: number
}

/** How long a place waits for its tab to mount: a cold tab loads its file first. */
const PLACE_TTL_MS = 10_000

const pending = new Map<string, CodePlace & { at: number }>()
const shown = new Map<string, Set<(place: CodePlace) => void>>()
const openers = new Map<Editor, (path: string) => void>()
let lastFocused: Editor | null = null
let installed = false

/** Opens `path` through `open` (the tab's `onOpenFile`) and puts the cursor at `place` there. */
export function openCodeAt(path: string, place: CodePlace, open: (path: string) => void): void {
  pending.set(path, { ...place, at: Date.now() })
  open(path)
  // A tab already on this file is where `navigate` goes: it shows the place now.
  for (const show of shown.get(path) ?? []) show(place)
}

/** The place a jump left for `path`, once; null when there is none or it is old. */
export function takePlace(path: string): CodePlace | null {
  const place = pending.get(path)
  pending.delete(path)
  return place !== undefined && Date.now() - place.at < PLACE_TTL_MS ? { lineNumber: place.lineNumber, column: place.column } : null
}

/** Cursor at the place, in the middle of the view. */
export function showPlace(editor: Editor, place: CodePlace): void {
  editor.setPosition(place)
  editor.revealPositionInCenter(place)
}

function placeOf(selectionOrPosition: unknown): CodePlace {
  const s = selectionOrPosition as { startLineNumber?: number; startColumn?: number; lineNumber?: number; column?: number } | undefined
  if (s?.startLineNumber !== undefined) return { lineNumber: s.startLineNumber, column: s.startColumn ?? 1 }
  if (s?.lineNumber !== undefined) return { lineNumber: s.lineNumber, column: s.column ?? 1 }
  return { lineNumber: 1, column: 1 }
}

function install(): void {
  if (installed) return
  installed = true
  monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      if (resource.scheme !== 'file') return false
      // The peek box's own editor is not a tab: the last tab the user was in opens it.
      const open = openers.get(source as Editor) ?? (lastFocused === null ? undefined : openers.get(lastFocused))
      if (open === undefined) return false
      const path = resource.fsPath
      if (fileKind(path) === 'text') openCodeAt(path, placeOf(selectionOrPosition), open)
      return true
    },
  })
}

/**
 * Makes `editor` a code tab that jumps: its targets open through `onOpenFile`, and a jump to its
 * own `path` from another tab shows the place here. Shows the place a jump left for this tab.
 */
export function trackCodeTab(editor: Editor, path: string, onOpenFile: ((path: string) => void) | undefined): { dispose(): void } {
  install()
  if (onOpenFile !== undefined) openers.set(editor, onOpenFile)
  const focus = editor.onDidFocusEditorWidget(() => void (lastFocused = editor))
  const show = (place: CodePlace) => showPlace(editor, place)
  const listeners = shown.get(path) ?? new Set()
  listeners.add(show)
  shown.set(path, listeners)
  const place = takePlace(path)
  if (place !== null) show(place)
  return {
    dispose() {
      focus.dispose()
      openers.delete(editor)
      if (lastFocused === editor) lastFocused = null
      listeners.delete(show)
      if (listeners.size === 0) shown.delete(path)
    },
  }
}
