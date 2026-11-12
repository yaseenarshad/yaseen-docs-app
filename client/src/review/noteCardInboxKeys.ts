/**
 * The Inbox's keys (YAZ-4962, D18), in ONE place: the handler (`NoteCardInbox.tsx`) and the hint row read this list.
 * They are fixed, as Explore's own Esc, E and ⌘↵ are: the key table (`shared/keys/`) holds only keys a user can change,
 * and a bare key (Space, a digit, a letter) is not one a user can set outside a drawing (`isUsableFor`).
 */

/** What a key press is in the Inbox, or null when it is not one of its keys. */
export type NoteCardInboxKey = { kind: 'step' } | { kind: 'answer'; button: number } | { kind: 'undo' } | { kind: 'open' } | { kind: 'tab' } | { kind: 'edit' } | { kind: 'close' }

interface KeyPress {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** The key's meaning: Space, 1–4, ⌘Z, O, ⌘↵, E, Esc. ⌃ stands for ⌘ off a Mac. */
export function noteCardInboxKey(event: KeyPress): NoteCardInboxKey | null {
  const mod = event.metaKey || event.ctrlKey
  if (event.altKey) return null
  if (mod) {
    if (event.shiftKey) return null
    if (event.key.toLowerCase() === 'z') return { kind: 'undo' }
    if (event.key === 'Enter') return { kind: 'tab' }
    return null
  }
  if (event.shiftKey) return null
  if (event.key === ' ') return { kind: 'step' }
  if (/^[1-4]$/.test(event.key)) return { kind: 'answer', button: Number(event.key) - 1 }
  if (event.key === 'o' || event.key === 'O') return { kind: 'open' }
  if (event.key === 'e' || event.key === 'E') return { kind: 'edit' }
  if (event.key === 'Escape') return { kind: 'close' }
  return null
}

/** What the hint row knows of the moment: a key shows only while it does something (silence is the default). */
export interface NoteCardInboxMoment {
  /** A card shows (not the done screen). */
  card: boolean
  /** The buttons show: Space has no more to show. */
  answering: boolean
  canUndo: boolean
  /** The page can open in edit mode (not a read-only vault). */
  editable: boolean
}

/**
 * The hint row (D18): each key once, quiet, in the order a review uses them, and only while it does something. The
 * answer digits are on the buttons, so the row does not say them again.
 */
export const noteCardInboxHints = ({ card, answering, canUndo, editable }: NoteCardInboxMoment): { keys: string; label: string }[] => [
  ...(card && !answering ? [{ keys: 'Space', label: 'Show' }] : []),
  ...(canUndo ? [{ keys: '⌘Z', label: 'Undo' }] : []),
  ...(card ? [{ keys: 'O', label: 'Open page' }] : []),
  ...(card && editable ? [{ keys: 'E', label: 'Edit page' }] : []),
  ...(card ? [{ keys: '⌘↵', label: 'Open page in a new tab' }] : []),
  { keys: 'Esc', label: 'Close' },
]
