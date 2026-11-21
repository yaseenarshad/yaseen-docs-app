/**
 * Edit card's keys on screen (YAZ-5034, YAZ-5332), for a card in a page (`cardBlockView.ts`) and a card embed
 * (`cardEmbed.ts`) alike, each the app's hotkey label (`keyLabelDom`): the head's "Done (Esc / Cmd+Enter)", and the
 * quiet row under the editor, "Hide word (Cmd+L) · New side (Cmd+Shift+Enter) · Done (Cmd+Enter)".
 */
import { DONE_KEYS } from '@shared/keyLabel'
import { keyLabelDom } from '../../keys/KeyLabel'

/** The keys of the row under Edit card's editor; Esc is said once, by the head's Done (YAZ-5332). */
export const CARD_EDIT_KEYS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: '⌘L', label: 'Hide word' },
  { keys: '⌘⇧↵', label: 'New side' },
  { keys: '⌘↵', label: 'Done' },
]

/** The quiet key row under Edit card's editor, on one line. */
export function cardKeyRow(): HTMLElement {
  const row = document.createElement('div')
  row.className = 'explore__foot card__keys'
  row.contentEditable = 'false'
  row.setAttribute('aria-hidden', 'true')
  for (const { keys, label } of CARD_EDIT_KEYS) row.append(keyLabelDom(label, keys))
  return row
}

/** The head's Edit card button: "Edit card", or while edited "Done (Esc / Cmd+Enter)" (drawn again only on a change). */
export function drawEditButton(button: HTMLButtonElement, editing: boolean): void {
  if (!editing) {
    if (button.textContent !== 'Edit card') button.textContent = 'Edit card'
  } else if (button.querySelector('.key-label') === null) button.replaceChildren(keyLabelDom('Done', DONE_KEYS))
  button.setAttribute('aria-label', editing ? 'Done' : 'Edit card')
}
