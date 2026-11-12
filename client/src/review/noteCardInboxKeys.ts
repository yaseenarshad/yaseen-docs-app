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

/** The hint row (D18): each key once, quiet, in the order a review uses them. `answers` is the number of buttons. */
export const noteCardInboxHints = (answers: number): { keys: string; label: string }[] => [
  { keys: 'Space', label: 'Show' },
  { keys: answers === 4 ? '1–4' : '1–2', label: 'Answer' },
  { keys: '⌘Z', label: 'Undo' },
  { keys: 'O', label: 'Open page' },
  { keys: 'E', label: 'Edit' },
  { keys: '⌘↵', label: 'New tab' },
  { keys: 'Esc', label: 'Close' },
]
