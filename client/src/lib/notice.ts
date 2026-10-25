/**
 * The window's one passive notice (E1, GRO-2171; restyled bottom-left in YAZ-1674). App owns the
 * toast; every surface reaches it through an `onNotice(text, icon?)` callback.
 */
import { basename } from './paths'

/** A can't-open-link notice (E1, GRO-2171) dismisses itself after this long. */
export const LINK_NOTICE_MS = 4000

/** A move's toast with Undo, and an undo's with Redo, fade after this long (YAZ-3255 D11). ⌘Z and ⌘⇧Z work after it too. */
export const UNDO_NOTICE_MS = 6000

/**
 * The toast's glyph (D10 amended, YAZ-1674): what KIND of thing just happened, drawn before the
 * text. `'info'` unless the caller names a kind; the file clipboard's confirmations name their
 * verb, its failures say `'error'`; a favorite added or removed says `'favorite'` (YAZ-1766 D6).
 */
export type NoticeKind = 'copy' | 'cut' | 'paste' | 'favorite' | 'error' | 'info'

export interface Notice {
  text: string
  icon: NoticeKind
  /**
   * One button on the toast (YAZ-1897, ported by YAZ-3039: "See changes" after a merge). A notice
   * with an action is news to act on, so it stays until acted on or dismissed instead of fading
   * after `LINK_NOTICE_MS` — unless it `fades` (YAZ-3255 D11): the Undo of a move and the Redo of
   * an undo are a chance, not news, and go after `UNDO_NOTICE_MS`.
   */
  action?: { label: string; run: () => void; fades?: true }
}

/** "1 item" / "3 items" — the one spelling the menu's labels and the notices share. */
export const countItems = (n: number) => (n === 1 ? '1 item' : `${n} items`)

/** How many names a gesture's toast shows before " + N more" (YAZ-3274 D22). */
export const NAMES_SHOWN = 3

/** What an item of a gesture is: a file (a note, a drawing, any file) or a folder. */
export type ItemKind = 'file' | 'dir'

/** An item of a gesture as its toast names it (YAZ-3293 D23): its name on disk and its kind. */
export interface NamedItem {
  name: string
  kind: ItemKind
}

/** An item by its name on disk, as Finder shows it (YAZ-3293 D23): the last part of its path, with the extension ("Todo.md"). */
export const onDisk = (path: string, kind: ItemKind): NamedItem => ({ name: basename(path), kind })

const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`)

/**
 * The items by kind (YAZ-3293 D23): "2 files", "1 folder", "1 folder and 2 files" — the folders
 * first in a mix. The menu's counted labels ("Delete 2 files") and the Cut and Copy toasts say this alone.
 */
export function countKinds(items: readonly { kind: ItemKind }[]): string {
  const folders = items.filter((item) => item.kind === 'dir').length
  const files = items.length - folders
  if (folders === 0 && files === 0) return countItems(0)
  if (folders === 0) return plural(files, 'file')
  if (files === 0) return plural(folders, 'folder')
  return `${plural(folders, 'folder')} and ${plural(files, 'file')}`
}

/**
 * The items of a gesture (YAZ-3274 D22, amended by YAZ-3293 D23): the kinds (`countKinds`), then the
 * first `NAMES_SHOWN` names on disk in brackets, in the order of the gesture — "1 folder (Projects)",
 * "1 folder and 2 files (Projects, Todo.md, Plan.md)", "12 files (a.md, b.md, c.md + 9 more)" (S76–S79).
 */
export function namedItems(items: readonly NamedItem[]): string {
  if (items.length === 0) return countKinds(items)
  const more = items.length > NAMES_SHOWN ? ` + ${items.length - NAMES_SHOWN} more` : ''
  return `${countKinds(items)} (${items.slice(0, NAMES_SHOWN).map((item) => item.name).join(', ')}${more})`
}

/**
 * The one sentence of a gesture over many items (audit 9): a move, a paste, a drop from Finder, an
 * undo. `done` says what landed ("Moved 2 files (Todo.md, Plan.md)", `namedItems`), then how many did not and the first of them —
 * "Moved 2 items, skipped 1: Plan already exists" (S11). With nothing landed (`done` null), the
 * failure alone: "Can't move 2 items: Plan already exists". Null when nothing ran at all.
 */
export function gestureNotice(done: string | null, failed: readonly string[], cannot: string): string | null {
  if (failed.length === 0) return done
  if (done === null) return `${cannot}${failed.length === 1 ? '' : ` ${countItems(failed.length)}`}: ${failed[0]}`
  return `${done}, skipped ${failed.length}: ${failed[0]}`
}

/** How long a notice stays (D11): null while an action waits on the user; else the ms before it goes. */
export function noticeMs(notice: Notice): number | null {
  if (notice.action === undefined) return LINK_NOTICE_MS
  return notice.action.fades === true ? UNDO_NOTICE_MS : null
}

/**
 * The box after rows were dragged out to Finder (YAZ-3254 D9B): Finder took copies, and the box asks
 * whether the vault keeps the items. Its own slot beside the toast, so a later toast does not hide it
 * (S32); it stays until answered, and a second drag out replaces it. `links`: the notes outside the
 * items that link to them, off the window's index snapshot.
 */
export interface DragOutAsk {
  paths: string[]
  /** Each path's kind, in the order of `paths` (YAZ-3293 D23): the box names the items by kind and by name on disk. */
  kinds: ItemKind[]
  links: number
}

/** "Copied 2 files (Todo.md, Plan.md) to Finder? 3 notes link to them." — with no second sentence when no note links (one item: "1 note links to it"). The box asks; it does not claim (S29). */
export function dragOutText({ paths, kinds, links }: DragOutAsk): string {
  const items = namedItems(paths.map((path, i) => onDisk(path, kinds[i])))
  const them = paths.length === 1 ? 'it' : 'them'
  const notes = links === 1 ? '1 note links' : `${links} notes link`
  return links > 0 ? `Copied ${items} to Finder? ${notes} to ${them}.` : `Copied ${items} to Finder?`
}
