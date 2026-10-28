/**
 * A jump opens its file IN THIS TAB, at the place (YAZ-3454 4B, D10): Cmd+click, F12, and a row of
 * the peek box opened with Enter or a double click. Monaco asks its editor opener for any file that
 * is not the editor's own model; this module answers for `file://` targets.
 *
 * THE DOOR. The tab's `onOpenFile` — the same one a note's link uses (`navigate`: this tab, with
 * history, or the tab that already shows the file) — so Back returns the way it does for a link.
 * The place rides beside it: `openCodeAt` keeps it for the file, and the code tab that shows the
 * file takes it — a new tab when it mounts, a tab already open at once. One jump, one place: a tab
 * already open that is still there after the jump uses it up, so a later new tab on that file does
 * not jump to an old place (YAZ-3454 nit).
 *
 * Only a code file opens (`fileKind` `text`): a jump never hands a stub such as `.pyi` to the OS.
 *
 * BACK RETURNS TO THE PLACE (YAZ-3458), as in VS Code: a code tab that a jump or a link leaves keeps its
 * cursor and scroll under its history entry (`keepBackView`), and that entry, mounted again by Back or
 * Forward, takes them (`takeBackView`). The folds are not in it: they are the file's (`codeFolds.ts`).
 * At most `MAX_BACK_VIEWS` are kept, the oldest go first.
 */
import { fileKind } from '@shared/fileKind'
import { monaco } from './monaco'

type Editor = ReturnType<typeof monaco.editor.create>
type ViewState = NonNullable<ReturnType<Editor['saveViewState']>>

export interface CodePlace {
  /** 1-based, as Monaco counts. */
  lineNumber: number
  column: number
}

/** How long a place waits for its tab to mount: a cold tab loads its file first. */
const PLACE_TTL_MS = 10_000
/** How many left history entries keep their place: each one is a few numbers. */
export const MAX_BACK_VIEWS = 100

const backViews = new Map<string, ViewState>()

/** Keeps the cursor and scroll of the history entry `key` that a code tab leaves (folds aside). */
export function keepBackView(key: string, view: ViewState): void {
  backViews.delete(key)
  backViews.set(key, { ...view, contributionsState: {} })
  if (backViews.size > MAX_BACK_VIEWS) backViews.delete(backViews.keys().next().value as string)
}

/** The cursor and scroll the history entry `key` was left with, once; undefined when none. */
export function takeBackView(key: string): ViewState | undefined {
  const view = backViews.get(key)
  backViews.delete(key)
  return view
}

const pending = new Map<string, CodePlace & { at: number }>()
const shown = new Map<string, Set<(place: CodePlace) => void>>()
const openers = new Map<Editor, (path: string) => void>()
let lastFocused: Editor | null = null
let installed = false

/** Opens `path` through `open` (the tab's `onOpenFile`) and puts the cursor at `place` there. */
export function openCodeAt(path: string, place: CodePlace, open: (path: string) => void): void {
  const entry = { ...place, at: Date.now() }
  pending.set(path, entry)
  open(path)
  // A tab already on this file is where `navigate` goes: it shows the place now.
  const showing = [...(shown.get(path) ?? [])]
  for (const show of showing) show(place)
  if (showing.length === 0) return
  // Once `navigate` has landed: if one of those tabs is still there, it took the place, so drop it.
  // If each one closed (the file left the right panel for this tab), the new tab still takes it.
  setTimeout(() => {
    const still = shown.get(path)
    if (pending.get(path) === entry && showing.some((show) => still?.has(show) === true)) pending.delete(path)
  }, 0)
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
 * own `path` from another tab shows the place here. Shows the place a jump left for this tab (`placed`).
 */
export function trackCodeTab(editor: Editor, path: string, onOpenFile: ((path: string) => void) | undefined): { placed: boolean; dispose(): void } {
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
    placed: place !== null,
    dispose() {
      focus.dispose()
      openers.delete(editor)
      if (lastFocused === editor) lastFocused = null
      listeners.delete(show)
      if (listeners.size === 0) shown.delete(path)
    },
  }
}
