/**
 * The move confirm (D21): a folder's values leave a note with the folder (D20), so a move — or a
 * "Remove shortcut" — that would clear some asks first, naming what goes. One that clears nothing
 * never asks. The LOCKED copy lives in the pure functions; the component stays trivial.
 */
import { ConfirmSheet } from '../components/ConfirmSheet'
import type { WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { pageLabel, usePathTitles } from '../lib/pageLabel'
import { dirname } from '../lib/paths'
import type { LeftBehind, Move } from '../links/shortcuts'

/** The folders by name: `A`, `A and B`, `A, B and C`; past three, the first three `and N more`. */
export function folderList(names: readonly string[]): string {
  if (names.length > 3) return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The LOCKED copy for a move (D21): one item is named, several are counted; a note loses "its values", a folder or several items count the notes that do. */
export function moveConfirmMessage(items: readonly { name: string; kind: 'file' | 'dir' }[], destination: string, lost: { notes: number; folders: readonly string[] }): string {
  const one = items.length === 1 ? items[0] : undefined
  const folders = folderList(lost.folders)
  const cleared = one?.kind === 'file' ? `Its values for ${folders} will be cleared.` : `${lost.notes} ${lost.notes === 1 ? 'note will lose its' : 'notes will lose their'} values for ${folders}.`
  return `Move ${one === undefined ? `${items.length} items` : `'${one.name}'`} to '${destination}'? ${cleared}`
}

/** The LOCKED copy for "Remove shortcut" (D21): the folder the row stands in, the note, and the folders whose values go. */
export function removeShortcutConfirmMessage(note: string, folder: string, folders: readonly string[]): string {
  return `Remove the shortcut from '${folder}'? The values of '${note}' for ${folderList(folders)} will be cleared.`
}

type ConfirmMoveProps = {
  /** What would be cleared (`valuesLeftBehind` / `valuesLeftByShortcut`); its folders are named by their directory. */
  lost: LeftBehind
  /** The window's index snapshot (YAZ-2420 🔒 D14): what the copy names, it names by title. Absent, by file name. */
  indexSource?: WikilinkResolveSource
  onConfirm: () => void
  onCancel: () => void
} & (
  | {
      /** The moves asked about, all into ONE folder; only their names and the destination's reach the copy. */
      moves: readonly Move[]
    }
  | {
      /** "Remove shortcut": the note, and the folder its shortcut row stands in. */
      shortcut: { path: string; dir: string }
    }
)

/**
 * In-app confirm sheet for a move, or a shortcut's removal, that clears values (D21), on
 * `ConfirmSheet`. The confirm button IS `--danger`: the values are gone once it is pressed. Keys
 * are bound to the sheet (`keys="sheet"`), `ConfirmRename`'s rule: a keystroke can open it — Enter
 * on a menu item — and must not be the one that confirms it. Cancel takes the focus.
 */
export function ConfirmMove({ lost, indexSource, onConfirm, onCancel, ...ask }: ConfirmMoveProps) {
  const titles = usePathTitles(indexSource)
  const folders = lost.folders.map((dir) => pageLabel(dir, true, titles))
  const text =
    'moves' in ask
      ? moveConfirmMessage(
          ask.moves.map((move) => ({ name: pageLabel(move.oldPath, move.kind === 'dir', titles), kind: move.kind })),
          // The vault's top level is named by the vault: the root directory's own name.
          pageLabel(dirname(ask.moves[0].newPath), true, titles),
          { notes: lost.notes, folders },
        )
      : removeShortcutConfirmMessage(pageLabel(ask.shortcut.path, false, titles), pageLabel(ask.shortcut.dir, true, titles), folders)
  return <ConfirmSheet labelId="confirm-move-text" text={text} confirmLabel={'moves' in ask ? 'Move' : 'Remove'} danger keys="sheet" onConfirm={onConfirm} onCancel={onCancel} />
}
