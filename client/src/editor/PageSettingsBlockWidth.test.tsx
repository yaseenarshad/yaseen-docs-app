/**
 * The page cog's "Code block width" and "Table width" (YAZ-4783 layer 2): Default (Settings') or this page's px. The
 * host keeps the value (in the page's frontmatter); the menu shows it and hands a change back. The menu is a portal on
 * `document.body`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageSettings } from './PageSettings'
import { UNIT_WORDS, UnitContext, unitTextOf } from '../vault/unitWord'

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
    expect(group('Page width')).toBeNull() // YAZ-5640: a folder page's Page tab passes no handler either
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

describe('the cog’s "Page width" row (YAZ-5640)', () => {
  it('YAZ-5753: the row says the vault’s word: "Doc width" in a vault that calls a page a doc, "Page width" by default', () => {
    for (const [word, unit] of [['Page', undefined], ['Doc', unitTextOf(UNIT_WORDS.doc)]] as const) {
      container = document.createElement('div')
      document.body.append(container)
      root = createRoot(container)
      const menu = <PageSettings pageWidth={null} appContentWidth="narrow" onChangePageWidth={() => undefined} />
      act(() => root.render(unit === undefined ? menu : <UnitContext.Provider value={unit}>{menu}</UnitContext.Provider>))
      act(() => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      const row = group(`${word} width`)
      expect(row, word).not.toBeNull()
      expect(row!.previousElementSibling?.textContent).toBe(`${word} width:`)
      expect([...row!.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Default', 'Narrow', 'Medium', 'Full'])
      act(() => root.unmount())
      container.remove()
    }
  })
})

describe('the cog’s "Page width" Custom px and "Position" (YAZ-5871)', () => {
  type Props = Parameters<typeof PageSettings>[0]
  function open(props: Props) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root.render(<PageSettings {...props} />))
    act(() => container.querySelector<HTMLButtonElement>('.page-settings__trigger')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  }
  const buttons = (label: string) => [...group(label)!.querySelectorAll<HTMLButtonElement>('button')]
  const press = (button: HTMLButtonElement) => act(() => void button.dispatchEvent(new MouseEvent('click', { bubbles: true })))

  it('D1: a typed px is the page’s own width, clamped to 400–2400; an empty box on a step changes nothing; an emptied Custom is Default', () => {
    const onChangePageWidth = vi.fn()
    open({ pageWidth: 'medium', appContentWidth: 'narrow', onChangePageWidth })
    expect(field('Page width').value).toBe('')
    expect(buttons('Page width').find((b) => b.textContent === 'Medium')!.getAttribute('aria-pressed')).toBe('true')
    enter(field('Page width'))
    expect(onChangePageWidth).not.toHaveBeenCalled()
    type(field('Page width'), '760')
    enter(field('Page width'))
    expect(onChangePageWidth).toHaveBeenLastCalledWith(760)
    type(field('Page width'), '99999')
    enter(field('Page width'))
    expect(onChangePageWidth).toHaveBeenLastCalledWith(2400)
    type(field('Page width'), '12')
    enter(field('Page width'))
    expect(onChangePageWidth).toHaveBeenLastCalledWith(400)
    act(() => root.unmount())
    container.remove()
    onChangePageWidth.mockClear()
    open({ pageWidth: 1200, appContentWidth: 760, onChangePageWidth })
    expect(field('Page width').value).toBe('1200')
    expect(field('Page width').closest('label')!.hasAttribute('data-own')).toBe(true)
    expect(buttons('Page width').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false'])
    expect(buttons('Page width')[0]!.title).toBe('Default follows Settings › Appearance › Content width: 760 px')
    type(field('Page width'), '')
    enter(field('Page width'))
    expect(onChangePageWidth).toHaveBeenLastCalledWith(null)
  })

  it('D2: Position is Default · Centre · Left; a pick hands the position, Default hands null; Full (its own or Settings’) turns the row off', () => {
    const onChangePagePosition = vi.fn()
    open({ pageWidth: null, appContentWidth: 'narrow', onChangePageWidth: () => undefined, pagePosition: 'left', appContentPosition: 'center', onChangePagePosition })
    expect(buttons('Position').map((b) => [b.textContent, b.getAttribute('aria-pressed'), b.disabled])).toEqual([['Default', 'false', false], ['Centre', 'false', false], ['Left', 'true', false]])
    expect(buttons('Position')[0]!.title).toBe('Default follows Settings › Appearance › Page position: Centre')
    press(buttons('Position')[1]!)
    expect(onChangePagePosition).toHaveBeenLastCalledWith('center')
    press(buttons('Position')[0]!)
    expect(onChangePagePosition).toHaveBeenLastCalledWith(null)
    act(() => root.unmount())
    container.remove()
    for (const [pageWidth, appContentWidth] of [['full', 'narrow'], [null, 'full']] as const) {
      open({ pageWidth, appContentWidth, onChangePageWidth: () => undefined, pagePosition: null, onChangePagePosition })
      expect(buttons('Position').every((b) => b.disabled), `${pageWidth} ${appContentWidth}`).toBe(true)
      act(() => root.unmount())
      container.remove()
    }
    // A page of its own Narrow under Settings' Full has a position again.
    open({ pageWidth: 'narrow', appContentWidth: 'full', onChangePageWidth: () => undefined, pagePosition: null, onChangePagePosition })
    expect(buttons('Position').some((b) => b.disabled)).toBe(false)
  })
})
