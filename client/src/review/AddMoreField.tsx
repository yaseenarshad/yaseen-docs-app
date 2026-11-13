/**
 * "Add [10] more new cards" (YAZ-5042 round 2, Yaseen: "keep it add ten cards, but we do the math behind the
 * scenes"): ONE small field for how many MORE cards today takes, in the cards menu's row and on the done screen's pill.
 * The number starts at the Settings number (`start`, at most what waits) and is selected, so typing replaces it.
 *
 * - Enter adds the number (above what waits adds all that waits: the hook's rule); empty or 0 adds nothing.
 * - Esc goes back (`onCancel`); Up and Down change the number by 1.
 * - The field's keys stay in it: they reach neither the Inbox's keys (Space, the digits) nor the menu's Esc.
 * - On the done screen a click on "Add" or the words adds the number shown; a click on the number types.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AddKind } from '@shared/cardSchedule'

interface AddMoreFieldProps {
  kind: AddKind
  /** The number the field starts at: the Settings number, at most what waits. */
  start: number
  onAdd: (count: number) => void
  /** Esc: back to the count (the menu). The done screen's pill has none. */
  onCancel?: () => void
  /** `menu`: "Add [10] more new cards", focused at once. `done`: the pill, "Add [10] new cards". */
  look: 'menu' | 'done'
}

/** The words after the number: "more new cards" in the menu (today has some), "new cards" on the done screen. */
export const addWords = (kind: AddKind, look: 'menu' | 'done', n: number): string => {
  const more = look === 'menu' ? 'more ' : ''
  return kind === 'new' ? `${more}new card${n === 1 ? '' : 's'}` : `${more}Up next`
}

/** The field's number, or null when it is not a whole number above 0. */
export const typedCount = (value: string): number | null => {
  const n = Number(value.trim())
  return value.trim() !== '' && Number.isInteger(n) && n > 0 ? n : null
}

export function AddMoreField({ kind, start, onAdd, onCancel, look }: AddMoreFieldProps) {
  const [value, setValue] = useState(String(start))
  const input = useRef<HTMLInputElement>(null)
  // The done screen's pill follows a new start (another add, another day) while nobody types in it.
  const typed = useRef(false)
  useEffect(() => {
    if (!typed.current) setValue(String(start))
  }, [start])
  useEffect(() => {
    if (look !== 'menu') return
    input.current?.focus()
    input.current?.select()
  }, [look])
  const add = () => {
    const n = typedCount(value)
    if (n === null) return
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
      if (onCancel !== undefined) onCancel()
      else input.current?.blur()
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
      className="note-card-inbox__add-number"
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
        if (look === 'done' && typedCount(value) === null) setValue(String(start))
      }}
    />
  )
  if (look === 'menu')
    return (
      <span className="note-card-inbox__add-field" data-kind={kind}>
        Add {field} {addWords(kind, 'menu', n)}
        <span className="note-card-inbox__add-enter" aria-hidden="true">
          Enter
        </span>
      </span>
    )
  return (
    <span className="note-card-inbox__done-add" data-kind={kind}>
      <button type="button" className="note-card-inbox__done-add-word" onMouseDown={(e) => e.preventDefault()} onClick={add}>
        Add
      </button>
      {field}
      <button type="button" className="note-card-inbox__done-add-word" onMouseDown={(e) => e.preventDefault()} onClick={add}>
        {addWords(kind, 'done', n)}
      </button>
    </span>
  )
}
