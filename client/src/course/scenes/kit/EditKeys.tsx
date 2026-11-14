/**
 * EDIT CARD (YAZ-5121; the kit's one copy, YAZ-5128) AND ITS KEYS, IN WORDS: the key row under the card editor and the
 * head's "Done Esc Cmd + Enter", as the app writes them. The keys come from the app's own list (`editor/card/cardEditKeys.ts`, `CARD_EDIT_KEYS`) and
 * its own words (`keys/KeyCaps.tsx`, `keyWords.ts`): "Cmd + L hide word · Cmd + Shift + Enter new side · Cmd + Enter /
 * Esc Done". Use these in any copy of the card editor; never type a key symbol by hand.
 */
import type { CSSProperties, ReactNode } from 'react'
import { CARD_EDIT_KEYS } from '../../../editor/card/cardEditKeys'
import { KeyCaps } from '../../../keys/KeyCaps'

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

/**
 * A card in Edit card, as the app draws it in a page (`cardBlockView.ts`, `cardEditor.ts`): the head with the ID,
 * Preview (YAZ-5152), "Done Esc Cmd + Enter" and ⋯; the Title field above Side 1 (YAZ-5164; empty, it shows its placeholder "Title", as `cardEditor.ts` sets it);
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
