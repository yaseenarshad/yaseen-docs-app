/**
 * The rows "ID letters" and "Old IDs" of Settings › This vault (YAZ-2677 🔒 D5, D6), and the ONE
 * typed-confirm box that they share with "Give IDs" (🔒 D2). Each row asks first, in a box with a
 * text field, and the main process does the change (`ids.reletter`, `ids.backfill`): the row waits
 * for it and shows what the vault holds afterwards.
 */
import { useEffect, useRef, useState } from 'react'
import { isIdLetters } from '@shared/noteId'
import type { IdsState } from '@shared/types'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { idsLettersAsk, lettersAskMessage, lettersLine, NEW_LETTERS_ASK, oldIdsAskMessage, oldIdsLine } from './idsAskMessage'
import type { SettingsCtx } from './registry'

type Ids = NonNullable<SettingsCtx['ids']>

/**
 * A confirm box with a text field (🔒 D2): the confirm button and Enter do nothing until what is
 * typed is `valid`. `onConfirm` takes it in capitals. The field holds the focus: Enter in it is
 * safe. Its keys stay inside it, so the dialog under it does not close.
 */
export function TypedConfirmSheet({ labelId, text, ask, confirmLabel, valid, onConfirm, onCancel }: { labelId: string; text: string; ask: string; confirmLabel: string; valid: (typed: string) => boolean; onConfirm: (typed: string) => void; onCancel: () => void }) {
  const [typed, setTyped] = useState('')
  const field = useRef<HTMLInputElement>(null)
  // After the sheet's own effect, which puts the focus on Cancel.
  useEffect(() => field.current?.focus(), [])
  return (
    <ConfirmSheet labelId={labelId} text={text} confirmLabel={confirmLabel} confirmDisabled={!valid(typed)} keys="contained" onConfirm={() => onConfirm(typed.toUpperCase())} onCancel={onCancel}>
      <label className="confirm__letters">
        {ask}
        <input ref={field} className="confirm__input" type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
      </label>
    </ConfirmSheet>
  )
}

const said = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** One change at a time for a row, and a row that is gone is told nothing: `run` resolves to the line the row shows. */
function useRun(): { busy: boolean; line: string | null; run: (working: string, change: () => Promise<string | null>) => void } {
  const [line, setLine] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => {
      shown.current = false
    }
  }, [])
  const run = (working: string, change: () => Promise<string | null>): void => {
    if (busy) return
    setBusy(true)
    setLine(working)
    void change().then((next) => {
      if (!shown.current) return
      setLine(next)
      setBusy(false)
    })
  }
  return { busy, line, run }
}

/**
 * "ID letters" (🔒 D5, S79, S80, S83, S85): the vault's letters, read from the main process when the
 * row appears, and "Change letters". The box counts the notes that change and takes the new
 * letters: bad input, and the letters the vault already has, do nothing. Where a change stopped,
 * the row says how many notes still have the old letters, and "Finish" runs the same change again.
 */
export function IdLettersControl({ ids, vault }: { ids: Ids; vault?: string }) {
  const [state, setState] = useState<IdsState | null>(null)
  const [asking, setAsking] = useState(false)
  const { busy, line, run } = useRun()
  const read = ids.state
  useEffect(() => {
    let live = true
    read().then(
      (next) => live && setState(next),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [read])
  const change = (letters: string): void =>
    run('Changing…', () =>
      ids.reletter(letters).then(
        (next) => {
          setState(next)
          return null
        },
        (err: unknown) => `Couldn't change the letters: ${said(err)}`,
      ),
    )
  return (
    <>
      <div className="settings__options">
        <button type="button" className="settings__option" disabled={busy || state === null} onClick={() => setAsking(true)}>
          Change letters
        </button>
        {state !== null && state.stale > 0 && (
          <button type="button" className="settings__option" disabled={busy} onClick={() => change(state.letters)}>
            Finish
          </button>
        )}
      </div>
      <p className="setting__hint" role="status">
        {line ?? (state === null ? '' : lettersLine(state))}
      </p>
      {asking && state !== null && (
        <TypedConfirmSheet
          labelId="confirm-ids-letters-text"
          text={lettersAskMessage(state, vault)}
          ask={NEW_LETTERS_ASK}
          confirmLabel="Change letters"
          valid={(typed) => isIdLetters(typed) && typed.toUpperCase() !== state.letters}
          onConfirm={(letters) => {
            setAsking(false)
            change(letters)
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}

/**
 * "Old IDs" (🔒 D6, S88 to S91): how many notes hold an old 12-character ID, and "Give them
 * numbers". The box says the count and to sync and close the other Mac first, and takes the vault's
 * own letters. The row goes when the vault's index holds no old ID; while some are left, a second run finishes.
 */
export function OldIdsControl({ ids, vault }: { ids: Ids; vault?: string }) {
  const [asking, setAsking] = useState<string | null>(null)
  const { busy, line, run } = useRun()
  return (
    <>
      <div className="settings__options">
        <button type="button" className="settings__option" disabled={busy} onClick={() => void ids.state().then(({ letters }) => setAsking(letters), () => undefined)}>
          Give them numbers
        </button>
      </div>
      <p className="setting__hint" role="status">
        {line ?? oldIdsLine(ids.old)}
      </p>
      {asking !== null && (
        <TypedConfirmSheet
          labelId="confirm-ids-old-text"
          text={oldIdsAskMessage(ids.old, vault)}
          ask={idsLettersAsk(asking)}
          confirmLabel="Give them numbers"
          valid={(typed) => typed.toUpperCase() === asking}
          onConfirm={() => {
            setAsking(null)
            run('Giving numbers…', () =>
              ids.backfill().then(
                ({ old }) => (old === 0 ? 'Each note has a number now.' : `${oldIdsLine(old)} Run it again to finish.`),
                (err: unknown) => `Couldn't give the numbers: ${said(err)}`,
              ),
            )
          }}
          onCancel={() => setAsking(null)}
        />
      )}
    </>
  )
}
