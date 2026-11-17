/**
 * "Add [10] new cards" (YAZ-5042 round 2, Yaseen: "keep it add ten cards, but we do the math behind the scenes"):
 * ONE small field for how many MORE cards today takes: the done screen's pill, and the ⚙ part's "Add today [10] Add"
 * (YAZ-5690, look `setting`, New cards and Up next, the Mac's cards menu and the phone's sheet). The number starts at
 * the Settings number (`start`, at most what waits); a focus selects it, so typing replaces it.
 *
 * - Enter adds the number (above what waits adds all that waits: the hook's rule); empty or 0 adds nothing.
 * - Esc leaves the field; Up and Down change the number by 1.
 * - The field's keys stay in it: they reach neither the Inbox's keys (Space, the digits) nor the menu's Esc.
 * - On the done screen a click on "Add" or the words adds the number shown; a click on the number types.
 * - In the ⚙ part (`setting`, YAZ-5690 round 3, Yaseen: "too easy to click") "Add" or Enter never adds on its own: it
 *   asks in place, "Add 7 new cards to today?" with Cancel first and focused (`AskInPlace`); Add there adds. Cancel,
 *   Esc or a click elsewhere goes back to the field.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { AddKind } from '@shared/cardSchedule'
import { AskInPlace } from '../components/AskInPlace'

interface AddMoreFieldProps {
  kind: AddKind
  /** The number the field starts at: the Settings number, at most what waits. */
  start: number
  onAdd: (count: number) => void
  /** `done`: the pill, "Add [10] new cards". `setting`: "[10] Add". */
  look: 'done' | 'setting'
  /** The done pill's end (YAZ-5322): "from [Spanish ▾]", the new cards' folder pick. */
  after?: ReactNode
}

/** The done pill's words after the number: "new cards", "Up next". */
export const addWords = (kind: AddKind, n: number): string => (kind === 'new' ? `new card${n === 1 ? '' : 's'}` : 'Up next')

/** The ⚙ part's ask: "Add 7 new cards to today?", "Add 1 Up next card to today?". */
export const addQuestion = (kind: AddKind, n: number): string => `Add ${n} ${kind === 'new' ? 'new' : 'Up next'} card${n === 1 ? '' : 's'} to today?`

/** The field's number, or null when it is not a whole number above 0. */
export const typedCount = (value: string): number | null => {
  const n = Number(value.trim())
  return value.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null
}

export function AddMoreField({ kind, start, onAdd, look, after }: AddMoreFieldProps) {
  const [value, setValue] = useState(String(start))
  // The ⚙ part's ask (round 3): the number waiting for its second click.
  const [asking, setAsking] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)
  // The done screen's pill follows a new start (another add, another day) while nobody types in it.
  const typed = useRef(false)
  useEffect(() => {
    if (!typed.current) setValue(String(start))
  }, [start])
  const add = () => {
    const n = typedCount(value)
    if (n === null) return
    if (look === 'setting') return setAsking(n)
    typed.current = false
    onAdd(n)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      input.current?.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      typed.current = true
      setValue(String(Math.max(1, (typedCount(value) ?? 0) + (e.key === 'ArrowUp' ? 1 : -1))))
    }
  }
  const n = typedCount(value) ?? start
  const field = (
    <input
      ref={input}
      className="card-inbox__add-number"
      type="text"
      inputMode="numeric"
      aria-label={kind === 'new' ? 'How many new cards to add' : 'How many Up next cards to add'}
      value={value}
      style={{ width: `${Math.max(2, value.length) + 1}ch` }}
      onChange={(e) => {
        typed.current = true
        setValue(e.target.value.replace(/[^0-9]/g, ''))
      }}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        if (typedCount(value) === null) setValue(String(start))
      }}
    />
  )
  if (look === 'setting' && asking !== null)
    return (
      <AskInPlace
        question={addQuestion(kind, asking)}
        yes="Add"
        className="card-inbox__add-ask"
        onYes={() => {
          setAsking(null)
          typed.current = false
          onAdd(asking)
        }}
        onNo={() => setAsking(null)}
      />
    )
  if (look === 'setting')
    return (
      <span className="card-inbox__add-setting" data-kind={kind}>
        {field}
        <button type="button" className="card-inbox__add-go" onMouseDown={(e) => e.preventDefault()} onClick={add}>
          Add
        </button>
      </span>
    )
  return (
    <span className="card-inbox__done-add" data-kind={kind}>
      <button type="button" className="card-inbox__done-add-word" onMouseDown={(e) => e.preventDefault()} onClick={add}>
        Add
      </button>
      {field}
      <button type="button" className="card-inbox__done-add-word" onMouseDown={(e) => e.preventDefault()} onClick={add}>
        {addWords(kind, n)}
      </button>
      {after}
    </span>
  )
}
