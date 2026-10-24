/**
 * Block handle menu (YAZ-726) on a real Crepe in jsdom. The Crepe is built directly (not via
 * createCrepe) because createCrepe already registers the menu with the real numberChildrenRow
 * provider, whose capture contextmenu listener would swallow the event before the test's provider ran.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createBlockHandleMenu, parseNumberField, renderMenu, type MenuChoiceField, type MenuNumberField, type MenuRow, type RowProvider } from './blockHandleMenu'
import { features } from './featureConfig'
import appCss from '../app.css?inline'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(rows: RowProvider): Promise<{ crepe: Crepe; view: EditorView; handle: HTMLElement; item: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = new Crepe({ root, defaultValue: 'alpha\n\nbravo\n', features })
  crepe.editor.use(createBlockHandleMenu(rows))
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  const item = document.createElement('div')
  item.className = 'operation-item'
  handle.appendChild(item)
  view.dom.parentElement!.appendChild(handle)
  handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
  view.posAtCoords = () => ({ pos: 1, inside: 0 })
  return { crepe, view, handle, item }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** The popup exists only while open. */
const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const itemsOf = (view: EditorView) => Array.from(popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item'))

function contextmenu(target: Element): MouseEvent {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
  target.dispatchEvent(e)
  return e
}

const twoRows = (): MenuRow[] => [
  { label: 'One', run: vi.fn() },
  { label: 'Two', run: vi.fn() },
]

describe('open', () => {
  it('renders the provider rows at the pointer and prevents the native menu', async () => {
    const { view, item } = await mount(twoRows)
    const e = contextmenu(item)
    expect(e.defaultPrevented).toBe(true)
    expect(popupOf(view)).not.toBeNull()
    expect(itemsOf(view).map((b) => b.textContent)).toEqual(['One', 'Two'])
  })

  it('click runs the row once and closes', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [{ label: 'Go', run }])
    contextmenu(item)
    itemsOf(view)[0]!.click()
    expect(run).toHaveBeenCalledTimes(1)
    expect(popupOf(view)).toBeNull()
  })

  it('disabled row carries the attribute and does not run', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [{ label: 'Nope', disabled: true, run }])
    contextmenu(item)
    const [button] = itemsOf(view)
    expect(button!.hasAttribute('disabled')).toBe(true)
    button!.click()
    expect(run).not.toHaveBeenCalled()
  })

  it('never shows for an empty provider', async () => {
    const { view, item } = await mount(() => [])
    contextmenu(item)
    expect(popupOf(view)).toBeNull()
  })

  it('ignores a contextmenu on a paragraph', async () => {
    const { view } = await mount(twoRows)
    const e = contextmenu(view.dom.querySelector('p')!)
    expect(e.defaultPrevented).toBe(false)
    expect(popupOf(view)).toBeNull()
  })
})

describe('dismiss', () => {
  const cases: Array<[string, (view: EditorView) => void]> = [
    ['outside mousedown', () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))],
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['scroll', () => document.body.dispatchEvent(new Event('scroll', { bubbles: true }))],
    ['window blur', () => window.dispatchEvent(new Event('blur'))],
    ['doc change', (view) => view.dispatch(view.state.tr.insertText('x', 1))],
  ]
  for (const [name, dismiss] of cases) {
    it(name, async () => {
      const { view, item } = await mount(twoRows)
      contextmenu(item)
      expect(popupOf(view)).not.toBeNull()
      dismiss(view)
      expect(popupOf(view)).toBeNull()
    })
  }

  it('mousedown inside the popup keeps it open', async () => {
    const { view, item } = await mount(twoRows)
    contextmenu(item)
    itemsOf(view)[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(popupOf(view)).not.toBeNull()
  })
})

describe('ownership', () => {
  it('only the handle owner opens', async () => {
    const a = await mount(twoRows)
    const b = await mount(twoRows)
    contextmenu(b.item)
    expect(popupOf(a.view)).toBeNull()
    expect(popupOf(b.view)).not.toBeNull()
    contextmenu(a.item)
    expect(popupOf(a.view)).not.toBeNull()
  })
})

describe('suppressing Crepe', () => {
  it('stops right-button mousedown/mouseup at the handle, lets left-button through', async () => {
    const { item } = await mount(twoRows)
    const down = vi.fn()
    const up = vi.fn()
    item.addEventListener('mousedown', down)
    item.addEventListener('mouseup', up)
    item.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }))
    item.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }))
    expect(down).not.toHaveBeenCalled()
    expect(up).not.toHaveBeenCalled()
    item.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    expect(down).toHaveBeenCalledTimes(1)
  })
})

describe('destroy', () => {
  it('removes the popup and stops listening', async () => {
    const { crepe, view, item } = await mount(twoRows)
    const parent = view.dom.parentElement!
    contextmenu(item)
    expect(popupOf(view)).not.toBeNull()
    await crepe.destroy()
    mounted.splice(0)
    expect(parent.querySelector('.ctx-menu--editor')).toBeNull()
    // `item` stays inside the editor's parent so a leaked listener would still match own().
    const down = vi.fn()
    item.addEventListener('mousedown', down)
    item.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }))
    expect(down).toHaveBeenCalledTimes(1)
    expect(contextmenu(item).defaultPrevented).toBe(false)
    expect(parent.querySelector('.ctx-menu--editor')).toBeNull()
  })
})

/** A number field like the line's darkness (YAZ-3164 D3, default 50); `run` is a spy. */
const field = (over: Partial<MenuNumberField> = {}): MenuNumberField => ({
  kind: 'number',
  label: 'Size',
  unit: '%',
  value: 50,
  presets: [10, 50, 100],
  fallback: 50,
  min: 5,
  max: 100,
  error: 'Use a whole number from 5–100%.',
  run: vi.fn(),
  ...over,
})

/** A choice field like the line's style (YAZ-3164 D7); `run` is a spy. */
const choice = (over: Partial<MenuChoiceField> = {}): MenuChoiceField => ({
  kind: 'choice',
  label: 'Kind',
  value: 'a',
  choices: [
    { value: 'a', label: 'Alpha', sample: 'sample-a' },
    { value: 'b', label: 'Bravo' },
  ],
  fallback: 'a',
  run: vi.fn(),
  ...over,
})

const pickers = (view: EditorView) => [...popupOf(view)!.querySelectorAll<HTMLElement>('.block-menu-picker')]
const valueOf = (picker: HTMLElement) => picker.querySelector<HTMLButtonElement>('.block-menu-picker__value')!
const panelOf = (picker: HTMLElement) => picker.querySelector<HTMLElement>('.block-menu-picker__panel')!
const enter = (box: HTMLInputElement) => box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

describe('pickers (YAZ-3164 D3, condensed)', () => {
  it('S80: each picker is one row — the name left, the value right — every one closed, and nothing takes the focus', async () => {
    const { view, item } = await mount(() => [{ label: 'One', run: vi.fn() }, field({ value: 10 }), choice({ value: 'b' })])
    const before = document.activeElement
    contextmenu(item)
    const popup = popupOf(view)!
    expect([...popup.children].map((el) => el.className)).toEqual(['ctx-menu__item', 'document-zoom__divider', 'block-menu-picker', 'block-menu-picker'])
    const [size, kind] = pickers(view)
    expect(size.querySelector('.block-menu-picker__label')?.textContent).toBe('Size')
    expect(valueOf(size).textContent).toBe('10% ▾')
    expect(valueOf(kind).textContent).toBe('Bravo ▾')
    for (const picker of [size, kind]) {
      expect(panelOf(picker).hidden).toBe(true)
      expect(valueOf(picker).getAttribute('aria-expanded')).toBe('false')
      expect(valueOf(picker).getAttribute('aria-controls')).toBe(panelOf(picker).id)
    }
    expect(document.activeElement).toBe(before)
  })

  it('S81: a click on a value opens that picker — the box focused and selected — and closes any other', async () => {
    const { view, item } = await mount(() => [field({ value: 10 }), choice()])
    contextmenu(item)
    const [size, kind] = pickers(view)
    valueOf(kind).click()
    expect(panelOf(kind).hidden).toBe(false)
    expect(valueOf(kind).getAttribute('aria-expanded')).toBe('true')
    valueOf(size).click()
    expect(panelOf(kind).hidden).toBe(true)
    expect(valueOf(kind).getAttribute('aria-expanded')).toBe('false')
    expect(panelOf(size).hidden).toBe(false)
    const box = panelOf(size).querySelector('input')!
    expect(document.activeElement).toBe(box)
    expect(box.value).toBe('10%')
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 3])
    expect(box.getAttribute('aria-label')).toBe('Size')
  })

  it('S82: a second click on the open value closes the picker', async () => {
    const { view, item } = await mount(() => [field()])
    contextmenu(item)
    const [size] = pickers(view)
    valueOf(size).click()
    valueOf(size).click()
    expect(panelOf(size).hidden).toBe(true)
    expect(valueOf(size).getAttribute('aria-expanded')).toBe('false')
    expect(popupOf(view)).not.toBeNull()
  })

  it('a number panel is the zoom menu’s: the box, a divider, "Default (…)" first, then the presets, the current one pressed', async () => {
    const { view, item } = await mount(() => [field({ value: 10 })])
    contextmenu(item)
    const panel = panelOf(pickers(view)[0])
    expect([...panel.children].map((el) => el.className)).toEqual(['document-zoom__custom', 'document-zoom__divider', 'document-zoom__presets'])
    const buttons = [...panel.querySelectorAll('.document-zoom__presets button')]
    expect(buttons.map((b) => b.firstElementChild?.textContent)).toEqual(['Default (50%)', '10%', '50%', '100%'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false', 'false'])
    expect(buttons.map((b) => b.lastElementChild?.textContent)).toEqual(['', '✓', '', ''])
  })

  it('YAZ-3208 D11: a field that follows the default reads "Default (…) ▾", its box shows the default, and "Default" is pressed', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [field({ value: null, fallback: 70, run }), choice({ value: null, fallback: 'b' })])
    contextmenu(item)
    expect(valueOf(pickers(view)[0]).textContent).toBe('Default (70%) ▾')
    expect(valueOf(pickers(view)[1]).textContent).toBe('Default (Bravo) ▾')
    valueOf(pickers(view)[0]).click()
    expect(panelOf(pickers(view)[0]).querySelector('input')!.value).toBe('70%')
    const buttons = [...panelOf(pickers(view)[0]).querySelectorAll('.document-zoom__presets button')]
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
    // "Default" again is the current value: nothing runs. A preset equal to the default is a value (D9).
    ;(buttons[0] as HTMLButtonElement).click()
    expect(run).not.toHaveBeenCalled()
    contextmenu(item)
    valueOf(pickers(view)[0]).click()
    panelOf(pickers(view)[0]).querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')[2].click()
    expect(run).toHaveBeenCalledExactlyOnceWith(50)
  })

  it('a choice panel lists "Default (…)", then the choices with their samples, the current one pressed', async () => {
    const { view, item } = await mount(() => [choice({ value: 'b' })])
    contextmenu(item)
    const buttons = [...panelOf(pickers(view)[0]).querySelectorAll('.document-zoom__presets button')]
    expect(buttons.map((b) => b.firstElementChild?.textContent)).toEqual(['Default (Alpha)', 'Alpha', 'Bravo'])
    // "Default" draws the default choice's sample.
    expect(buttons[0].querySelector('.block-menu-picker__sample')?.className).toBe('block-menu-picker__sample sample-a')
    expect(buttons[1].querySelector('.block-menu-picker__sample')?.className).toBe('block-menu-picker__sample sample-a')
    expect(buttons[2].querySelector('.block-menu-picker__sample')).toBeNull()
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
  })

  it('S83: Enter runs a new valid value once and closes the whole menu; the current value closes without running', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [field({ run })])
    contextmenu(item)
    valueOf(pickers(view)[0]).click()
    let box = popupOf(view)!.querySelector('input')!
    box.value = '60'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    enter(box)
    expect(run).toHaveBeenCalledExactlyOnceWith(60)
    expect(popupOf(view)).toBeNull()
    contextmenu(item)
    valueOf(pickers(view)[0]).click()
    box = popupOf(view)!.querySelector('input')!
    box.value = '50%'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    enter(box)
    expect(run).toHaveBeenCalledTimes(1)
    expect(popupOf(view)).toBeNull()
  })

  it('a bad value shows the error, marks the box and keeps the menu open; typing clears it', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [field({ run })])
    contextmenu(item)
    valueOf(pickers(view)[0]).click()
    const box = popupOf(view)!.querySelector('input')!
    box.value = 'abc'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    enter(box)
    expect(run).not.toHaveBeenCalled()
    expect(popupOf(view)).not.toBeNull()
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(popupOf(view)!.querySelector('.document-zoom__error')?.textContent).toBe('Use a whole number from 5–100%.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    expect(box.getAttribute('aria-invalid')).toBe('false')
    expect(popupOf(view)!.querySelector('.document-zoom__error')).toBeNull()
  })

  it('S83: a preset or a choice runs and closes the whole menu; the current one only closes', async () => {
    const runSize = vi.fn()
    const runKind = vi.fn()
    const { view, item } = await mount(() => [field({ run: runSize }), choice({ run: runKind })])
    contextmenu(item)
    valueOf(pickers(view)[0]).click()
    panelOf(pickers(view)[0]).querySelectorAll<HTMLButtonElement>('button')[3].click()
    expect(runSize).toHaveBeenCalledExactlyOnceWith(100)
    expect(popupOf(view)).toBeNull()
    contextmenu(item)
    valueOf(pickers(view)[1]).click()
    panelOf(pickers(view)[1]).querySelectorAll<HTMLButtonElement>('button')[2].click()
    expect(runKind).toHaveBeenCalledExactlyOnceWith('b')
    expect(popupOf(view)).toBeNull()
    contextmenu(item)
    panelOf(pickers(view)[1]).querySelectorAll<HTMLButtonElement>('button')[1].click()
    expect(runKind).toHaveBeenCalledTimes(1)
    expect(popupOf(view)).toBeNull()
  })

  it('S84: Tab from the editor goes to the first value button (Shift-Tab to the last); Enter on it opens the picker', async () => {
    const { view, item } = await mount(() => [{ label: 'One', run: vi.fn() }, field(), choice()])
    view.focus()
    contextmenu(item)
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    view.dom.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(valueOf(pickers(view)[0]))
    view.focus()
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(valueOf(pickers(view)[1]))
    // A focused button's Enter and Space are its click (the browser's own); the picker opens.
    valueOf(pickers(view)[0]).click()
    expect(panelOf(pickers(view)[0]).hidden).toBe(false)
    // Inside the menu Tab is the browser's: nothing here takes it.
    const inside = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    popupOf(view)!.querySelector('input')!.dispatchEvent(inside)
    expect(inside.defaultPrevented).toBe(false)
  })

  it('Tab with a menu of rows only is left to the editor: nothing in the menu takes the focus', async () => {
    const { view, item } = await mount(twoRows)
    view.focus()
    contextmenu(item)
    let reached = false
    const listener = (e: KeyboardEvent) => (reached = e.key === 'Tab')
    view.dom.addEventListener('keydown', listener)
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    view.dom.removeEventListener('keydown', listener)
    expect(reached).toBe(true)
    expect(document.activeElement?.closest('.ctx-menu')).toBeFalsy()
  })

  it('a click inside a panel keeps the menu open; a click away closes it with no run, and the focus goes back to the editor', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [field({ run })])
    contextmenu(item)
    valueOf(pickers(view)[0]).click()
    popupOf(view)!.querySelector('input')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(popupOf(view)).not.toBeNull()
    window.dispatchEvent(new Event('blur'))
    expect(popupOf(view)).toBeNull()
    expect(run).not.toHaveBeenCalled()
    expect(view.dom.contains(document.activeElement)).toBe(true)
  })

  it('rows alone take no focus (the id link’s menu, YAZ-2293, is unchanged)', () => {
    const before = document.activeElement
    const popup = renderMenu(document.body, [{ label: 'Copy ID', run: vi.fn() }], () => {})
    expect(popup.querySelector('input')).toBeNull()
    expect(popup.querySelector('.document-zoom__divider')).toBeNull()
    expect(document.activeElement).toBe(before)
    popup.remove()
  })

  it('parseNumberField: whole numbers in range, the unit optional and only its own', () => {
    const spec = { unit: 'px' as const, min: 1, max: 24 }
    expect(parseNumberField(spec, '6')).toBe(6)
    expect(parseNumberField(spec, ' 6px ')).toBe(6)
    expect(parseNumberField(spec, '6 px')).toBe(6)
    for (const bad of ['', '0', '25', '6%', '6.5', 'six', '-3', '1e1']) expect(parseNumberField(spec, bad), bad).toBeNull()
  })

  it('the menu keeps its width when a bad number’s message shows: the message wraps inside it', () => {
    const rule = /\.ctx-menu--editor \.document-zoom__error\s*\{([^}]*)\}/.exec(appCss.replace(/\/\*[\s\S]*?\*\//g, ''))
    expect(rule?.[1]).toMatch(/width:\s*0;/)
    expect(rule?.[1]).toMatch(/min-width:\s*100%;/)
  })

  it('YAZ-3222: Enter on an untouched box of a field that follows the default closes with no run; a typed value, even the default’s, is a pick (D9)', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [field({ value: null, fallback: 45, run })])
    contextmenu(item)
    valueOf(pickers(view)[0]).click()
    let box = popupOf(view)!.querySelector('input')!
    expect(box.value).toBe('45%')
    enter(box)
    expect(run).not.toHaveBeenCalled()
    expect(popupOf(view)).toBeNull()
    contextmenu(item)
    valueOf(pickers(view)[0]).click()
    box = popupOf(view)!.querySelector('input')!
    box.value = '45'
    box.dispatchEvent(new Event('input', { bubbles: true }))
    enter(box)
    expect(run).toHaveBeenCalledExactlyOnceWith(45)
  })
})

