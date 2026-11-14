/**
 * The page cog's "Code block width" and "Table width" (YAZ-4783 layer 2): Default (Settings') or this page's px. The
 * host keeps the value (in the page's frontmatter); the menu shows it and hands a change back. The menu is a portal on
 * `document.body`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageSettings } from './PageSettings'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement
let changed: ReturnType<typeof vi.fn<(width: number | null) => void>>

function mount(initial: number | null, withRows = true) {
  changed = vi.fn()
  function Harness() {
    const [width, setWidth] = useState<number | null>(initial)
    const onChange = (next: number | null) => {
      changed(next)
      setWidth(next)
    }
    return withRows ? <PageSettings codeWidth={width} onChangeCodeWidth={onChange} tableWidth={null} onChangeTableWidth={() => undefined} /> : <PageSettings />
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
  act(() => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

const group = (label: string) => document.body.querySelector<HTMLElement>(`.page-settings__menu [role="group"][aria-label="${label}"]`)
const defaultButton = (label: string) => group(label)!.querySelector<HTMLButtonElement>('button')!
const field = (label: string) => group(label)!.querySelector<HTMLInputElement>('input')!
const type = (input: HTMLInputElement, text: string) =>
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
const enter = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))

describe('the cog’s block widths (YAZ-4783 layer 2)', () => {
  it('no handler, no row (a board, a drawing, a code file)', () => {
    mount(null, false)
    expect(group('Code block width')).toBeNull()
    expect(group('Table width')).toBeNull()
  })

  it('a page with no width shows Default pressed and an empty field; its tooltip names the Settings row', () => {
    mount(null)
    expect(defaultButton('Code block width').getAttribute('aria-pressed')).toBe('true')
    expect(defaultButton('Code block width').title).toBe('Default follows Settings › Editor › Code blocks › Width')
    expect(defaultButton('Table width').title).toBe('Default follows Settings › Tables › All tables › Width')
    expect(field('Code block width').value).toBe('')
  })

  it('a typed px is kept on ⏎, clamped to 240–4000; Default hands null; the menu stays open', () => {
    mount(null)
    type(field('Code block width'), '900')
    enter(field('Code block width'))
    expect(changed).toHaveBeenLastCalledWith(900)
    expect(defaultButton('Code block width').getAttribute('aria-pressed')).toBe('false')
    expect(field('Code block width').closest('label')!.hasAttribute('data-own')).toBe(true)
    type(field('Code block width'), '99999')
    enter(field('Code block width'))
    expect(changed).toHaveBeenLastCalledWith(4000)
    type(field('Code block width'), '12')
    enter(field('Code block width'))
    expect(changed).toHaveBeenLastCalledWith(240)
    act(() => defaultButton('Code block width').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(changed).toHaveBeenLastCalledWith(null)
    expect(field('Code block width').value).toBe('')
    expect(group('Code block width')).not.toBeNull()
  })

  it('an emptied field is Default; the same value again hands nothing', () => {
    mount(1200)
    expect(field('Code block width').value).toBe('1200')
    enter(field('Code block width'))
    expect(changed).not.toHaveBeenCalled()
    type(field('Code block width'), '')
    enter(field('Code block width'))
    expect(changed).toHaveBeenLastCalledWith(null)
  })
})
