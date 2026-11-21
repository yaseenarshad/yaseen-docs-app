/**
 * YAZ-5644: Review with a keyboard (a computer's browser tab). Space or Enter shows the next part (a tap on the card);
 * 1 to 4 answer, in the buttons' order (1 = ✕ Forgot, 2 = ✓ Remembered; with four buttons, Hard and Easy too). ← and →
 * are not keys here: on the screen they are the card arrows. The Review screen runs each key through the same paths as
 * a tap, so the tap guard holds.
 *
 * No key acts:
 *  - held down (a repeat), or with ⌘, Ctrl or Alt;
 *  - in a field (typing), or on a button or link the keyboard moved to (`:focus-visible`: Tab then Enter keeps its own
 *    meaning). A button that a click left focused does not count: its Space would answer the card.
 */
export type ReviewKey = { kind: 'next' } | { kind: 'answer'; index: number }

export type KeyFacts = Pick<KeyboardEvent, 'key' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey' | 'defaultPrevented' | 'target'>

const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const CONTROL = 'button, a, [role="button"], [role="menuitem"], [tabindex]'

const keyboardFocus = (el: Element): boolean => {
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}

export function reviewKey(e: KeyFacts, answers: number): ReviewKey | null {
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return null
  const target = e.target instanceof Element ? e.target : null
  if (target?.closest(FIELD)) return null
  const control = target?.closest(CONTROL)
  if (control && keyboardFocus(control)) return null
  if (e.key === ' ' || e.key === 'Enter') return { kind: 'next' }
  const n = /^[1-4]$/.test(e.key) ? Number(e.key) : 0
  return n >= 1 && n <= answers ? { kind: 'answer', index: n - 1 } : null
}
