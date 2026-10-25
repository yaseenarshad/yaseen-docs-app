/**
 * The window's one passive notice (E1, GRO-2171; restyled bottom-left in YAZ-1674). App owns the
 * toast; every surface reaches it through an `onNotice(text, icon?)` callback.
 */

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

/**
 * The one sentence of a gesture over many items (audit 9): a move, a paste, a drop from Finder, an
 * undo. `done` says what landed ("Moved 2 items"), then how many did not and the first of them —
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
  links: number
}

/** "Copied 2 items to Finder? 3 notes link to them." — with no second sentence when no note links (one item: "1 note links to it"). The box asks; it does not claim (S29). */
export function dragOutText({ paths, links }: DragOutAsk): string {
  const items = paths.length === 1 ? '1 item' : `${paths.length} items`
  const them = paths.length === 1 ? 'it' : 'them'
  const notes = links === 1 ? '1 note links' : `${links} notes link`
  return links > 0 ? `Copied ${items} to Finder? ${notes} to ${them}.` : `Copied ${items} to Finder?`
}
