import { useEffect, useRef, useState } from 'react'
import { ConfirmSheet } from './ConfirmSheet'

/**
 * A confirm box with a text field (YAZ-2677 🔒 D2; Settings' ID letters and Give IDs, a card's Reset history YAZ-5376): the confirm button and Enter do nothing until what is
 * typed is `valid`. `onConfirm` takes it in capitals. The field holds the focus: Enter in it is
 * safe. Its keys stay inside it, so the dialog under it does not close.
 */
export function TypedConfirmSheet({ labelId, text, ask, confirmLabel, danger = false, valid, onConfirm, onCancel }: { labelId: string; text: string; ask: string; confirmLabel: string; danger?: boolean; valid: (typed: string) => boolean; onConfirm: (typed: string) => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('')
  const field = useRef<HTMLInputElement>(null)
  // After the sheet's own effect, which puts the focus on Cancel.
  useEffect(() => field.current?.focus(), [])
  return (
    <ConfirmSheet labelId={labelId} text={text} confirmLabel={confirmLabel} danger={danger} confirmDisabled={!valid(typed)} keys="contained" onConfirm={() => onConfirm(typed.toUpperCase())} onCancel={onCancel}>
      <label className="confirm__letters">
        {ask}
        <input ref={field} className="confirm__input" type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
      </label>
    </ConfirmSheet>
  )
}
