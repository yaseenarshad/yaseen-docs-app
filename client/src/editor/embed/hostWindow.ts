/**
 * WHAT BOTH HOSTS DO WITH A WINDOW (YAZ-4834 A17): the note's `![[…]]` decorations (`boardEmbed.ts`) and the board
 * image node (`imageView.ts`) mount, size, menu and flush their windows the same way, so the steps live here once.
 * Eager and small: the window itself stays in its lazy chunk (`loadBoardWindow`).
 *
 *   - THE FIRST BOX (item 12, A6): before the window is there, the box holds the height the window will take first —
 *     the stored height, else a new window's (`newWindowSize`, 16:9 of the width, 160 to 480 px). The window then
 *     settles once to the board's shape when its picture comes (`boardWindow.ts`).
 *   - THE MOUNT: load the chunk, mount, put the window in the box, apply the selection and the fold the host knew
 *     meanwhile. The window's "one screen" is the box's scrolling ancestor (`scrollRootOf`, YAZ-4862). A chunk that will not load, or a mount that throws, leaves one quiet "Can't show …" line.
 *   - THE FLUSH (A8): each editor view keeps the flushes of its windows; `getMarkdownForSave` runs them first, so a
 *     view still waiting for its 800 ms write is in the text that every save flush (close, quit, rename) reads.
 */
import type { EmbedOptions } from '@shared/embedOptions'
import type { BoardBounds } from '../../diagrams/renderDiagram'
import type { MenuRow } from '../blockHandleMenu'
import { loadBoardWindow, type BoardWindowHandle, type BoardWindowHost, type WindowMenuRow } from './types'

export const MIN_WIDTH = 120
/** A new window's height from the board's shape (D11). */
export const NEW_MIN_HEIGHT = 160
export const NEW_MAX_HEIGHT = 480

/** A new window's size (D11): the given width (the column's); the height from the board's shape (16:9 before it is known), 160 to 480. */
export function newWindowSize(bounds: BoardBounds | null, columnWidth: number): { width: number; height: number } {
  const width = Math.max(MIN_WIDTH, Math.round(columnWidth))
  const shape = bounds === null || bounds.width <= 0 ? 9 / 16 : bounds.height / bounds.width
  return { width, height: Math.round(Math.min(NEW_MAX_HEIGHT, Math.max(NEW_MIN_HEIGHT, width * shape))) }
}

/** The window's first size: the stored one; a stored width alone (`|300`, A7) or none takes its height from `bounds`. */
export function firstWindowSize(options: EmbedOptions | null, bounds: BoardBounds | null, columnWidth: number): { width: number; height: number } {
  if (options !== null && options.height !== null) return { width: options.width, height: options.height }
  return newWindowSize(bounds, options?.width ?? columnWidth)
}

/** A window row as a menu row; the window's `checked` (a page's flyout) is the ✓ hint. */
export const menuRowOf = (row: WindowMenuRow): MenuRow => ({
  label: row.label,
  run: row.run,
  disabled: row.disabled,
  hint: row.checked === true ? '✓' : undefined,
  children: row.children === undefined ? undefined : [row.children.map(menuRowOf)],
})

/** What the host knew of its embed while the chunk loaded. */
export interface BoxState {
  selected: boolean
  fold: { foldable: boolean; folded: boolean }
}

export const BOX_BROKEN_CLASS = 'board-embed--broken'

/** The window could not load: the box says so, and keeps its place. */
function cantShow(box: HTMLElement, name: string): void {
  box.style.removeProperty('--board-embed-height')
  box.classList.add(BOX_BROKEN_CLASS)
  box.textContent = `Can't show ${name}`
}

/**
 * The nearest ancestor of `el` that scrolls (YAZ-4862): the note scrolls in `.editor-host`, which clips first, so the
 * viewport is the wrong "one screen" there. Null = none (the viewport). Read once per mount.
 */
export function scrollRootOf(el: Element): Element | null {
  for (let node = el.parentElement; node !== null && node !== document.body && node !== document.documentElement; node = node.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}

/** What a host gives `mountInBox`. */
export interface BoxMount {
  /** The options the text holds now: the box's first height. */
  options: EmbedOptions | null
  columnWidth: () => number
  /** The window's host, read when the chunk is there. */
  host: () => BoardWindowHost
  /** False once the box no longer wants its window (the widget went, the node became an image). */
  live: () => boolean
  /** The handle, before the selection and the fold of `state()` apply. */
  done: (handle: BoardWindowHandle) => void
  state: () => BoxState
  /** The board's name, for "Can't show …". */
  name: () => string
}

/** Mounts a window in `box` once the chunk is there (see the module doc). The box holds its first height until then. */
export function mountInBox(box: HTMLElement, m: BoxMount): void {
  box.style.setProperty('--board-embed-height', `${firstWindowSize(m.options, null, m.columnWidth()).height}px`)
  void loadBoardWindow().then(
    (mod) => {
      if (!m.live()) return
      let handle: BoardWindowHandle
      try {
        handle = mod.mountBoardWindow({ ...m.host(), scrollRoot: scrollRootOf(box) })
      } catch {
        cantShow(box, m.name())
        return
      }
      box.style.removeProperty('--board-embed-height')
      box.replaceChildren(handle.dom)
      m.done(handle)
      const { selected, fold } = m.state()
      if (selected) handle.setSelected(true)
      if (fold.foldable) handle.setFoldable(true)
      if (fold.folded) handle.setFolded(true)
    },
    () => {
      if (m.live()) cantShow(box, m.name())
    },
  )
}

/** The flushes of each editor view's windows (A8). */
const flushes = new WeakMap<object, Set<() => void>>()

/** Adds a window's flush to `view`'s; the returned function removes it. */
export function onFlush(view: object, flush: () => void): () => void {
  let set = flushes.get(view)
  if (set === undefined) flushes.set(view, (set = new Set()))
  set.add(flush)
  return () => {
    set.delete(flush)
  }
}

/** Every window of `view` writes the view it still waits to write, now. */
export function flushBoardWindows(view: object): void {
  const set = flushes.get(view)
  if (set !== undefined) for (const flush of [...set]) flush()
}
