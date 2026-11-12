/**
 * THE KEYS OF A SMALL CHOICE BOX (YAZ-4989): the "Allow edits?" box of the Read only chip (a page, an Explore layer's E),
 * the sidebar lock's "Allow file changes?" box, and the "This vault is read only" sheet. Yaseen: "can i use the keyboard
 * to arrow down to the other options then hit enter rather than always having to only hit enter on 1 min?"
 *
 *  - ↓ and Tab go to the next choice, ↑ and ⇧Tab to the one before; both ends wrap, so the focus never leaves the box.
 *  - Enter picks the choice that has the focus (a click on it), never only the first one.
 *  - Esc stays the box's own (it cancels).
 *
 * `choices` is the order, the box's buttons in their DOM order by default. A key it uses goes no further: a page's,
 * the sidebar's or the Explore stack's own keys (Tab round the layer, ← → steps) never hear it.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

const enabledButtons = (box: ParentNode): HTMLButtonElement[] => [...box.querySelectorAll<HTMLButtonElement>('button:not([disabled])')]

/** Handles one key in a choice box; true when it used it (the event is then stopped). */
export function choiceKey(event: KeyboardEvent | ReactKeyboardEvent, box: ParentNode | null, choices?: readonly HTMLElement[]): boolean {
  if (box === null || event.metaKey || event.ctrlKey || event.altKey) return false
  const tab = event.key === 'Tab'
  const step = event.key === 'ArrowDown' || (tab && !event.shiftKey) ? 1 : event.key === 'ArrowUp' || (tab && event.shiftKey) ? -1 : 0
  const list = choices ?? enabledButtons(box)
  const at = list.findIndex((b) => b === document.activeElement)
  if (step === 0 && event.key !== 'Enter') return false
  if (step === 0) {
    // Enter: the focused choice. A held Enter is no answer (the repeats of the press that opened the box).
    if (at === -1 || event.repeat) return false
    event.preventDefault()
    event.stopPropagation()
    list[at].click()
    return true
  }
  if (list.length === 0 || (event.shiftKey && !tab)) return false
  event.preventDefault()
  event.stopPropagation()
  const next = at === -1 ? (step === 1 ? 0 : list.length - 1) : (at + step + list.length) % list.length
  list[next].focus()
  return true
}
