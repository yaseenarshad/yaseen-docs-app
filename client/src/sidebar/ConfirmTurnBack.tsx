import { basename } from '../lib/paths'
import { ConfirmSheet } from '../components/ConfirmSheet'

/**
 * The turn-back sheet's copy (🔒 D5, YAZ-817) — LOCKED verbatim, and PURE + separately tested,
 * exactly like `deleteConfirmMessage` next door, so the component around it stays trivial.
 *
 * What it has to say is the whole reason the reverse asks at all: turning back changes what the
 * page means without deleting its content or memberships (🔒 D3). Belonging is plain text each
 * note writes about ITSELF — a `folder_pages` entry naming this page — so no member is rewritten
 * and no entry is dropped. They simply stop counting for as long as the flag is gone, which is
 * what puts a page with no
 * other parent in Uncategorized meanwhile. Say that plainly, then say nothing is deleted.
 *
 * The page is named the way the delete sheet names its target — `basename`, extension and all —
 * so the two sheets in this folder speak with one voice.
 */
export function turnBackConfirmMessage(path: string): string {
  return `Turn '${basename(path)}' back into a normal page? Pages that belong to it keep their entries — any that belong nowhere else will appear in Uncategorized until this is a folder page again. Nothing is deleted.`
}

interface ConfirmTurnBackProps {
  /** The folder page being turned back; only its basename reaches the copy. */
  path: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirm sheet for "Turn back into normal page" (🔒 D5, YAZ-817). Only the REVERSE asks:
 * turning INTO a folder page adds one frontmatter key and is undone by this very menu item, so
 * it fires immediately (🔒 D1). Turning back is the direction that changes what a whole page
 * MEANS to everything pointing at it, and that earns one beat.
 *
 * The behaviour is `ConfirmSheet`'s, shared by every confirm sheet since YAZ-2201 (their copies
 * are gone; the DOM is pinned unchanged): our own sheet and never a native dialog, initial focus
 * on CANCEL so a stray Enter arriving from the tree changes nothing, Esc cancels, Enter confirms,
 * click-away cancels.
 *
 * Two deliberate omissions:
 *  - NO "Don't ask me again" (🔒 D5). Delete earns one because it repeats and is unrecoverable;
 *    this is neither, and a silent version of the one gesture that unparents a whole folder page
 *    is not worth the keystroke it saves.
 *  - the confirm button is NOT `--danger`. Nothing is destroyed here (🔒 D3) and the sheet says
 *    so; red would contradict its own copy.
 */
export function ConfirmTurnBack({ path, onConfirm, onCancel }: ConfirmTurnBackProps) {
  return <ConfirmSheet labelId="confirm-turn-back-text" text={turnBackConfirmMessage(path)} confirmLabel="Turn back" onConfirm={onConfirm} onCancel={onCancel} />
}
