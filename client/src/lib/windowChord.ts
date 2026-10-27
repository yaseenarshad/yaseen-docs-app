/**
 * The renderer's ownership boundary for WINDOW-level chords (YAZ-1280's ⌘B, YAZ-1338's ⌘⇧C,
 * YAZ-1674's ⌘X / ⌘C / ⌘V).
 *
 * App installs its listeners in bubble phase, so editors and modal tools get first refusal; this
 * is the SECOND boundary, and it accepts only ordinary, non-editing app chrome. It lives in one
 * place on purpose: the three predicates differ by exactly a key and a Shift, and a rule about what
 * counts as "editing" that drifted between them would be a bug nobody could see — a chord that
 * fires inside a field the other one respects.
 */
import { eventKey } from '@shared/hotkeyBindings'
import { readOnlyNoteHoldsKeys } from './readOnlyCaret'

/**
 * The chord's own half: which key, and exactly which modifiers (never merely tolerated). ⌘ is assumed
 * unless `meta` says otherwise; ⌥ and ⌃ are off unless named (YAZ-3397 D2: a changed key can carry them).
 */
export interface WindowChord {
  /**
   * Compared case-insensitively — Shift changes `key`'s case. With ⌥ held the PHYSICAL key is compared: ⌥ changes
   * `key` on a Mac ('∫' for ⌥B). A key that is not a letter also matches by its physical key (YAZ-3410): `key` is
   * ' ' for Space, 'ArrowUp' for ↑ and '!' for ⇧1, never the accelerator's 'space', 'up' or '1'. A letter matches
   * only by what it types, so ⌘B stays where the keyboard layout puts it.
   */
  key: string
  shift: boolean
  alt?: boolean
  ctrl?: boolean
  meta?: boolean
}

function keyMatches(event: KeyboardEvent, chord: WindowChord): boolean {
  const physical = eventKey(event)
  if (chord.alt === true) return physical?.toLowerCase() === chord.key
  return event.key.toLowerCase() === chord.key || (physical !== null && !/^[A-Z]$/.test(physical) && physical.toLowerCase() === chord.key)
}

/** A null chord is a command with no key now (YAZ-3397 D2): nothing owns it. */
export function ownsWindowChord(event: KeyboardEvent, chord: WindowChord | null): boolean {
  if (chord === null) return false
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.metaKey !== (chord.meta ?? true) ||
    event.ctrlKey !== (chord.ctrl ?? false) ||
    event.altKey !== (chord.alt ?? false) ||
    event.shiftKey !== chord.shift ||
    !keyMatches(event, chord)
  ) return false

  const target = event.target
  if (!(target instanceof Element)) return false
  // A read-only note is a note (YAZ-3127, D8): its body, or `<body>` with the reader's selection in it, keeps its keys.
  if (readOnlyNoteHoldsKeys(target)) return false
  if (target.ownerDocument.querySelector('[aria-modal="true"]') !== null) return false

  for (let el: Element | null = target; el !== null; el = el.parentElement) {
    if (el.matches('input, textarea, select')) return false
    const contenteditable = el.getAttribute('contenteditable')
    if (contenteditable !== null && contenteditable.toLowerCase() !== 'false') return false
  }
  return true
}
