/**
 * EDIT CARD'S KEYS, IN WORDS (YAZ-5121): the key row under the card editor and the head's "Done Esc Cmd + Enter",
 * as the app writes them. The keys come from the app's own list (`editor/card/cardEditKeys.ts`, `CARD_EDIT_KEYS`) and
 * its own words (`keys/KeyCaps.tsx`, `keyWords.ts`): "Cmd + L hide word · Cmd + Shift + Enter new side · Cmd + Enter /
 * Esc Done". Use these in any copy of the card editor; never type a key symbol by hand.
 */
import { CARD_EDIT_KEYS } from '../../../editor/card/cardEditKeys'
import { KeyCaps } from '../../../keys/KeyCaps'
import { keyText } from '../../../keys/keyWords'

/** The quiet key row under Edit card's editor (`cardKeyRow` in `cardBlockView.ts`), with the app's classes. */
export function CardEditKeyRow() {
  return (
    <div className="explore__foot card__keys kit-editkeys" aria-hidden="true">
      {CARD_EDIT_KEYS.map(({ keys, label }) => (
        <span key={label}>
          <KeyCaps keys={keys} /> {label}
        </span>
      ))}
    </div>
  )
}

/** The head's edit button while editing: "Done", then Esc and Cmd + Enter (`cardEmbed.ts`, `cardBlockView.ts`). */
export function CardDoneKeys() {
  return (
    <>
      Done <KeyCaps keys="esc" /> <KeyCaps keys="⌘↵" />
    </>
  )
}

/**
 * One of Edit card's key bindings, from the app's list, for `Keys` or a toolbar copy (they draw it in words):
 * `editKey('hide word')` → the binding `KeyCaps` writes "Cmd + L".
 */
export function editKey(label: string): string {
  return CARD_EDIT_KEYS.find((k) => k.label === label)?.keys.split(' / ')[0] ?? ''
}

/** The same key in words, as plain text: `editKeyText('hide word')` → "Cmd + L". */
export const editKeyText = (label: string): string => keyText(editKey(label))
