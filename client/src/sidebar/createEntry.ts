/**
 * Pure logic behind the sidebar's "New note" / "New folder" flow (GRO-2022):
 * name validation, target-directory resolution, and final path building.
 * The UI (context menu + inline input) lives in Sidebar/Tree; the main process
 * enforces the same rules again (absolute path, vault extension, no overwrite).
 */
import { BOARD_EXTENSION, boardBaseName, fileKind } from '@shared/fileKind'
import type { BoardKind } from '@shared/types'
import { validateEntryName } from '@shared/entryName'
import { basename, dirname } from '../lib/paths'

export { plainEntryName, validateEntryName, type EntryKind } from '@shared/entryName'

/** The name an empty board box gives (YAZ-3028 D9): `Untitled`, then `Untitled 2`, … */
const UNTITLED = 'Untitled'

/**
 * The absolute path of a new BOARD named `typed` (YAZ-3028 D9, Draw's `entryPath`): the name as typed,
 * with its kind's extension unless the name already carries it — so `Flow.drawio` typed into a
 * "New draw.io diagram" box is not `Flow.drawio.drawio`. A name a file cannot hold is refused.
 */
export function boardPath(parentDir: string, typed: string, kind: BoardKind): string {
  const name = typed.trim()
  const invalid = validateEntryName(name)
  if (invalid !== null) throw new Error(invalid)
  return `${parentDir}/${fileKind(name) === kind ? name : name + BOARD_EXTENSION[kind]}`
}

/**
 * The names an EMPTY board box tries, in order (YAZ-3028 D9): `Untitled`, `Untitled 2`, … — after the
 * box's seed, so the dated item gives `10_20- Untitled`. Bounded: a folder that already holds every
 * one of them gets the create's own "already exists".
 */
export function untitledNames(seed: string, max = 20): string[] {
  return Array.from({ length: max }, (_, i) => `${seed}${UNTITLED}${i === 0 ? '' : ` ${i + 1}`}`)
}

/** Seed for "New dated folder" (YAZ-1604) and "New dated note" (YAZ-2242): `09_14- ` — today's MM_DD, then `- ` so the title lands one space after the dash. */
export function datedSeed(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getMonth() + 1)}_${p(now.getDate())}- `
}

/** The default of "New item name starts with" (YAZ-4246, YAZ-4252): the Dated note's `MM_DD- ` (`datedSeed`). */
export const DEFAULT_NEW_NOTE_TITLE = '{MM}_{DD}- '

/**
 * A new note's title from the template of Settings › Files & Links › New notes › "New item name starts with" (YAZ-4246):
 * `{YYYY}`, `{YY}`, `{MM}`, `{DD}`, `{HH}` and `{mm}` as `now` gives them, two digits each but the year; any other text,
 * other braces too, as typed. An empty template gives an empty title.
 */
export function renderTitleTemplate(template: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const tokens: Record<string, string> = {
    YYYY: String(now.getFullYear()),
    YY: p(now.getFullYear() % 100),
    MM: p(now.getMonth() + 1),
    DD: p(now.getDate()),
    HH: p(now.getHours()),
    mm: p(now.getMinutes()),
  }
  return template.replace(/\{(YYYY|YY|MM|DD|HH|mm)\}/g, (_match, token: string) => tokens[token]!)
}

/**
 * The least a right-clicked row has to say for the menu to target it: its KIND and its path.
 * A `TreeNode` satisfies it structurally, and so does a search row (YAZ-2050), which is
 * why the rule below asks for this and not for a whole tree node it would never read.
 */
export interface MenuRow {
  type: 'file' | 'dir'
  path: string
  /** A SHORTCUT row only (YAZ-2290 D2): the folder the row stands in — `path` is the note where it lives. */
  shortcutIn?: string
  /** A FOLDER PAGE row only (YAZ-4587, D37): the folder whose page file the row is — `path` is that folder too. */
  pageOf?: string
  /** The top row the right-clicked row stands under (YAZ-2845 D1): which copy of a row that shows twice. */
  top?: string
}

/** Where a right-click creates: a dir row → itself, a file row → its parent (a shortcut row → the folder it stands in), blank space → the root. */
export function targetDirFor(node: MenuRow | null, root: string): string {
  if (node === null) return root
  if (node.type === 'dir') return node.path
  if (node.shortcutIn !== undefined) return node.shortcutIn
  return dirname(node.path)
}

/**
 * Absolute path for the sidebar's inline rename of a view-only FILE (Links E1, GRO-2194): same
 * parent directory. An explicit supported suffix is kept as typed; the old exact suffix is
 * appended only when none is recognized. A note or a folder is retitled instead (YAZ-2420 🔒 D16),
 * or, in a vault that does not use IDs, named by `plainEntryName`.
 */
export function renamedPath(oldPath: string, newName: string): string {
  let final = newName.trim()
  const old = basename(oldPath)
  if (final === old) return oldPath
  // A board's box shows its name without its extension (YAZ-3536 D3). When that name itself ends in one
  // (`Flow.md` of `Flow.md.excalidraw`), the box showed it, the user did not type it: only a board
  // extension typed in full counts (bug YAZ-3553). After a plain name (`Flow`), a typed `.png` stays a kind change.
  const shown = boardBaseName(old)
  const shownHasKind = shown !== old && fileKind(shown) !== null
  if (fileKind(final) === null || (shownHasKind && boardBaseName(final) === final)) final += oldPath.slice(oldPath.lastIndexOf('.'))
  return `${dirname(oldPath)}/${final}`
}
