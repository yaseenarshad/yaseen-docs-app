/**
 * Block handle menu (YAZ-726) on a real Crepe in jsdom. The Crepe is built directly (not via
 * createCrepe) because createCrepe already registers the menu with the real numberChildrenRow
 * provider, whose capture contextmenu listener would swallow the event before the test's provider ran.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createBlockHandleMenu, parseNumberField, renderMenu, type MenuNumberField, type MenuRow, type RowProvider } from './blockHandleMenu'
import { features } from './featureConfig'

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

describe('number fields (YAZ-3164 D3)', () => {
  it('draws the zoom menu’s box and presets after a divider, labels the default, and presses the current value', async () => {
    const { view, item } = await mount(() => [{ label: 'One', run: vi.fn() }, field({ value: 10 })])
    contextmenu(item)
    const popup = popupOf(view)!
    expect([...popup.children].map((el) => el.className)).toEqual(['ctx-menu__item', 'document-zoom__divider', 'document-zoom__custom', 'document-zoom__divider', 'document-zoom__presets'])
    const label = popup.querySelector('label')!
    const box = popup.querySelector('input')!
    expect(label.textContent).toBe('Size')
    expect(label.htmlFor).toBe(box.id)
    expect(box.value).toBe('10%')
    expect(box.inputMode).toBe('numeric')
    const buttons = [...popup.querySelectorAll('.document-zoom__presets button')]
    expect(buttons.map((b) => b.firstElementChild?.textContent)).toEqual(['10%', '50% (default)', '100%'])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(buttons.map((b) => b.lastElementChild?.textContent)).toEqual(['✓', '', ''])
  })

  it('a menu that starts with a field has no divider first, and the first box takes the focus with its text selected', async () => {
    const { view, item } = await mount(() => [field(), field({ label: 'Other' })])
    contextmenu(item)
    const popup = popupOf(view)!
    expect(popup.firstElementChild?.className).toBe('document-zoom__custom')
    const [first] = popup.querySelectorAll('input')
    expect(document.activeElement).toBe(first)
    expect([first.selectionStart, first.selectionEnd]).toEqual([0, 3])
  })

  it('Enter runs a new valid value once and closes; the current value closes without running', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [field({ run })])
    contextmenu(item)
    let box = popupOf(view)!.querySelector('input')!
    box.value = '60'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(run).toHaveBeenCalledExactlyOnceWith(60)
    expect(popupOf(view)).toBeNull()
    contextmenu(item)
    box = popupOf(view)!.querySelector('input')!
    box.value = '50%'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(popupOf(view)).toBeNull()
  })

  it('a bad value shows the error, marks the box and keeps the menu open; typing clears it', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [field({ run })])
    contextmenu(item)
    const box = popupOf(view)!.querySelector('input')!
    box.value = 'abc'
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(run).not.toHaveBeenCalled()
    expect(popupOf(view)).not.toBeNull()
    expect(box.getAttribute('aria-invalid')).toBe('true')
    expect(popupOf(view)!.querySelector('.document-zoom__error')?.textContent).toBe('Use a whole number from 5–100%.')
    box.dispatchEvent(new Event('input', { bubbles: true }))
    expect(box.getAttribute('aria-invalid')).toBe('false')
    expect(popupOf(view)!.querySelector('.document-zoom__error')).toBeNull()
  })

  it('a preset click runs and closes; a click on the current preset only closes', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [field({ run })])
    contextmenu(item)
    popupOf(view)!.querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')[2].click()
    expect(run).toHaveBeenCalledExactlyOnceWith(100)
    expect(popupOf(view)).toBeNull()
    contextmenu(item)
    popupOf(view)!.querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')[1].click()
    expect(run).toHaveBeenCalledTimes(1)
    expect(popupOf(view)).toBeNull()
  })

  it('a click inside the box keeps the menu open; a click away closes it with no run', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [field({ run })])
    contextmenu(item)
    popupOf(view)!.querySelector('input')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(popupOf(view)).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(popupOf(view)).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('rows alone take no focus (the id link’s menu, YAZ-2293, is unchanged)', () => {
    const before = document.activeElement
    const popup = renderMenu(document.body, [{ label: 'Copy ID', run: vi.fn() }], () => {})
    expect(popup.querySelector('input')).toBeNull()
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
})
