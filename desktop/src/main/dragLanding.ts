import { CONTRACT } from '@shared/ipc'

/**
 * Where a drag out of the sidebar landed (YAZ-3263). A window learns only of a drop on ITSELF, so a
 * drag that ends in a SECOND window of the app looks, to the first, like a drag that ended in Finder
 * (D9B, S26): it would ask "Copied N items to Finder?" though nothing was copied. Main sees both
 * ends: the paths of the first window's `fs:drag-out`, then the same paths dropped in the second.
 * So main keeps the last drag out, and tells its window once when another window takes it.
 *
 * The second window reports the drop when it fires, before any of its doors run (`fs:import`
 * refused by S22, App's door with its D21 sheet, the editor, or a place that takes nothing and only
 * navigates). Keyed on the paths (D4's explicit identity): the window compares them to its own drag.
 */
interface Contents {
  id: number
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

let last: { from: Contents; paths: readonly string[] } | null = null

/** A window's rows went to the OS drag (`fs:drag-out`): this drag replaces any older one. */
export function rememberDragOut(from: Contents, paths: readonly string[]): void {
  last = { from, paths }
}

/**
 * Files were dropped in the window of `by`. One of the last drag out's paths among them, from ANOTHER
 * window, is that drag landing in the app: its window hears `file:drag-landed` with its own paths,
 * once. A drop back in the drag's own window tells nothing: that window marks its own drops (S30).
 */
export function dropLanded(by: Contents, paths: readonly string[]): void {
  const drag = last
  if (drag === null || drag.from.id === by.id || !paths.some((path) => drag.paths.includes(path))) return
  last = null
  if (!drag.from.isDestroyed()) drag.from.send(CONTRACT.file.onDragLanded.channel, { paths: [...drag.paths] })
}
