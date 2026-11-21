// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChoiceRows, type ChoiceRowSpec } from './ChoiceRow'

/**
 * YAZ-5666: the phone Settings' one "choice row" (option D). Closed: the name, the value and ›. A tap opens its choices
 * in place under it (✓ on the current one); a tap on a choice saves and folds it; a tap on the open row's name folds it
 * without a change. One row open at a time. Made-up rows only.
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const chosen = vi.fn()

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [values, setValues] = useState({ folding: true, wide: false })
  const rows: ChoiceRowSpec[] = [
    {
      id: 'folding',
      label: 'Folding',
      value: values.folding,
      choices: [
        { value: true, label: 'On' },
        { value: false, label: 'Off' },
      ],
      onChoose: (v) => {
        chosen('folding', v)
        setValues((s) => ({ ...s, folding: v as boolean }))
      },
    },
    {
      id: 'wide',
      label: 'Wide tables',
      value: values.wide,
      choices: [
        { value: false, label: 'Same as Desktop' },
        { value: true, label: 'Fit Screen' },
      ],
      onChoose: (v) => {
        chosen('wide', v)
        setValues((s) => ({ ...s, wide: v as boolean }))
      },
    },
  ]
  return <ChoiceRows label="This vault on mobile" rows={rows} disabled={disabled} />
}

beforeEach(() => {
  chosen.mockReset()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (disabled = false) => act(() => root.render(<Harness disabled={disabled} />))
const row = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find((b) => b.getAttribute('aria-label')!.startsWith(`${name},`))!
/** The choices that can be tapped now: an open row's (a folding one is inert). */
const open = () => [...host.querySelectorAll<HTMLElement>('[role="radiogroup"]:not([inert])')]
const choice = (label: string) => [...open().flatMap((g) => [...g.querySelectorAll<HTMLButtonElement>('[role="radio"]')])].find((b) => b.textContent!.startsWith(label))!
const tap = (el: HTMLElement) => act(() => el.click())

describe('the choice row (YAZ-5666)', () => {
  it('closed: a button with its name and value, collapsed (VoiceOver: "Folding, On, collapsed"); no choices to tap', () => {
    render()
    const b = row('Folding')
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('aria-label')).toBe('Folding, On')
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect(b.textContent).toBe('FoldingOn›')
    expect(row('Wide tables').getAttribute('aria-label')).toBe('Wide tables, Same as Desktop')
    expect(open()).toEqual([])
  })

  it('a single tap never changes a value: it opens the choices in place, a radio group with ✓ on the current one', () => {
    render()
    tap(row('Folding'))
    expect(chosen).not.toHaveBeenCalled()
    expect(row('Folding').getAttribute('aria-expanded')).toBe('true')
    const [group] = open()
    expect(group.getAttribute('aria-label')).toBe('Folding')
    expect(row('Folding').getAttribute('aria-controls')).toBe(group.id)
    const radios = [...group.querySelectorAll('[role="radio"]')]
    expect(radios.map((r) => [r.textContent, r.getAttribute('aria-checked')])).toEqual([
      ['On✓', 'true'],
      ['Off', 'false'],
    ])
  })

  it('two taps change it: the choice saves and the row folds shut with the new value', () => {
    render()
    tap(row('Folding'))
    tap(choice('Off'))
    expect(chosen).toHaveBeenCalledExactlyOnceWith('folding', false)
    expect(row('Folding').getAttribute('aria-label')).toBe('Folding, Off')
    expect(row('Folding').getAttribute('aria-expanded')).toBe('false')
    expect(open()).toEqual([])
  })

  it("a tap on the open row's name folds it without a change; a tap on the current choice changes nothing", () => {
    render()
    tap(row('Wide tables'))
    tap(row('Wide tables'))
    expect(row('Wide tables').getAttribute('aria-expanded')).toBe('false')
    tap(row('Wide tables'))
    tap(choice('Same as Desktop'))
    expect(chosen).not.toHaveBeenCalled()
    expect(open()).toEqual([])
    expect(row('Wide tables').getAttribute('aria-label')).toBe('Wide tables, Same as Desktop')
  })

  it('one row open at a time: opening another closes the first', () => {
    render()
    tap(row('Folding'))
    tap(row('Wide tables'))
    expect([row('Folding'), row('Wide tables')].map((b) => b.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
    expect(open().map((g) => g.getAttribute('aria-label'))).toEqual(['Wide tables'])
    tap(choice('Fit Screen'))
    expect(chosen).toHaveBeenCalledExactlyOnceWith('wide', true)
    expect(row('Folding').getAttribute('aria-label')).toBe('Folding, On')
  })

  it('with no way to save: the rows show the value and do not open', () => {
    render(true)
    expect(row('Folding').disabled).toBe(true)
    tap(row('Folding'))
    expect(open()).toEqual([])
  })

  it('motion: a short open and close, none with "reduce motion"', () => {
    const css = readFileSync(fileURLToPath(import.meta.url).replace(/ChoiceRow\.test\.tsx$/, 'choiceRow.css'), 'utf8')
    expect(css).toMatch(/\.choice-row__choices \{[^}]*animation: choice-row-open 0\.1\d?s/)
    expect(css).toMatch(/\.choice-row__choices\[inert\] \{[^}]*animation: choice-row-close 0\.1\d?s/)
    const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduce).toMatch(/\.choice-row__choices,\s*\.choice-row__choices\[inert\] \{\s*animation: none;/)
    expect(reduce).toMatch(/\.choice-row__chevron \{\s*transition: none;/)
  })
})
