/**
 * EDIT CARD (YAZ-5121; the kit's one copy, YAZ-5128) AND ITS KEYS, IN WORDS: the key row under the card editor and the
 * head's Done, as the app writes them (YAZ-5332, one hotkey label: the action, then its keys in brackets). The keys come
 * from the app's own list (`editor/card/cardEditKeys.ts`, `CARD_EDIT_KEYS`) and its own label (`keys/KeyLabel.tsx`):
 * "Hide word (Cmd+L) · New side (Cmd+Shift+Enter) · Done (Cmd+Enter)", and the head's "Done (Esc / Cmd+Enter)". Use
 * these in any copy of the card editor; never type a key symbol by hand.
 */
import type { CSSProperties, ReactNode } from 'react'
import { DONE_KEYS } from '@shared/keyLabel'
import { CARD_EDIT_KEYS } from '../../../editor/card/cardEditKeys'
import { KeyLabel } from '../../../keys/KeyLabel'

/** The quiet key row under Edit card's editor (`cardKeyRow` in `cardEditKeys.ts`), with the app's classes. */
export function CardEditKeyRow() {
  return (
    <div className="explore__foot card__keys kit-editkeys" aria-hidden="true">
      {CARD_EDIT_KEYS.map(({ keys, label }) => (
        <KeyLabel key={label} action={label} keys={keys} />
      ))}
    </div>
  )
}

/** The head's edit button while editing: "Done (Esc / Cmd+Enter)" (`drawEditButton`, `cardEditKeys.ts`). */
export function CardDoneKeys() {
  return <KeyLabel action="Done" keys={DONE_KEYS} />
}

/**
 * One of Edit card's key bindings, from the app's list, for `Keys` or a toolbar copy (they draw it in words):
 * `editKey('hide word')` → `⌘L`, which `KeyLabel` writes "Cmd+L" (the label's case does not count).
 */
export function editKey(label: string): string {
  return CARD_EDIT_KEYS.find((k) => k.label.toLowerCase() === label.toLowerCase())?.keys.split(' / ')[0] ?? ''
}

/**
 * A card in Edit card, as the app draws it in a page (`cardBlockView.ts`, `cardEditor.ts`): the head with the ID,
 * Preview (YAZ-5152), "Done (Esc / Cmd+Enter)" and ⋯; the Title field above Side 1 (YAZ-5164; empty, it shows its placeholder "Title", as `cardEditor.ts` sets it);
 * the sides (`children`); the key row. `title`: the field's text, or a node (a selection, a caret); `done` 0..1 brings in
 * the head's buttons; `keys` 0..1 the key row.
 */
export function EditCard({ id, title, done = 1, keys = 1, className, style, children }: { id: string; title?: ReactNode; done?: number; keys?: number; className?: string; style?: CSSProperties; children?: ReactNode }) {
  const empty = title === undefined || title === ''
  return (
    <div className={`card card--editing kit-editcard${className === undefined ? '' : ` ${className}`}`} style={style}>
      <div className="card__head">
        <span className="card__id">{id}</span>
        <span className="card__preview" style={{ opacity: done }}>
          Preview
        </span>
        <span className="card__edit" style={{ opacity: done }}>
          <CardDoneKeys />
        </span>
        <span className="card__more">⋯</span>
      </div>
      <p className={`card-editor__title${empty ? ' kit-editcard__title--empty' : ''}`}>{empty ? 'Title' : title}</p>
      <div className="kit-editcard__text">{children}</div>
      {keys > 0 && (
        <div style={{ opacity: keys }}>
          <CardEditKeyRow />
        </div>
      )}
    </div>
  )
}
