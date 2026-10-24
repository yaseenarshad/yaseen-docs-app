/**
 * The line's pickers in the block handle menu (YAZ-3164, YAZ-3169; CONTRACTS rule 41) through the
 * real createCrepe wiring: the handle is aimed by hand (jsdom lays nothing out), the menu opens on
 * a right-click, and the markdown is read after each pick. Pinned here, by scenario key: the menu
 * on a line (S40) and on other blocks (S41), a line in a bullet (S42), the closed rows (S80), a row
 * opened (S81; its closing, S82, is `blockHandleMenu.test.ts`'s), the style picker (S78), a
 * typed value (S44), a bad value (S45), a preset (S46), the current value (S47), closing (S48),
 * back to the default (S49), undo (S50) and read-only (S51).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { targetLine } from './lineRows'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView; item: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
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
  return { crepe, view, item }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** The `n`th node of a type, in document order. */
const nth = (view: EditorView, type: string, n = 0): number => {
  const found: number[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === type) found.push(pos)
  })
  if (found[n] === undefined) throw new Error(`no ${type} #${n}`)
  return found[n]
}
/** The handle's probe lands inside the node at `inside`, as Crepe's handle would aim it. */
const aim = (view: EditorView, inside: number) => {
  view.posAtCoords = () => ({ pos: inside + 1, inside })
}
const rightClick = (item: HTMLElement) =>
  item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))

const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const pickers = (view: EditorView) => [...popupOf(view)!.querySelectorAll<HTMLElement>('.block-menu-picker')]
const valueOf = (view: EditorView, i: number) => pickers(view)[i].querySelector<HTMLButtonElement>('.block-menu-picker__value')!
/** Open picker `i` (0 darkness, 1 thickness, 2 style) as a click on its value does, unless it is open; its panel. */
const openRow = (view: EditorView, i: number): HTMLElement => {
  if (valueOf(view, i).getAttribute('aria-expanded') !== 'true') valueOf(view, i).click()
  return pickers(view)[i].querySelector<HTMLElement>('.block-menu-picker__panel')!
}
/** The number box of picker `i`, its row opened first. */
const box = (view: EditorView, i: number) => openRow(view, i).querySelector<HTMLInputElement>('input')!
/** Every item of picker `i`'s list, "Default (…)" first (YAZ-3208 D11), its row opened first. */
const listButtons = (view: EditorView, i: number) => [...openRow(view, i).querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')]
/** The "Default (…)" item of picker `i`. */
const defaultButton = (view: EditorView, i: number) => listButtons(view, i)[0]
/** The preset (or choice) buttons of picker `i`, after "Default". */
const presetButtons = (view: EditorView, i: number) => listButtons(view, i).slice(1)
const press = (box: HTMLInputElement, key: string) => box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
const type = (box: HTMLInputElement, text: string) => {
  box.value = text
  box.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Open the menu on the first line of the note. */
async function openOnLine(markdown: string) {
  const m = await mount(markdown)
  aim(m.view, nth(m.view, 'hr'))
  rightClick(m.item)
  return m
}

describe('which blocks get the pickers', () => {
  it('S40: a line gets "Number children" (disabled), then one row each for "Line darkness", "Line thickness" and "Line style"', async () => {
    const { view } = await openOnLine('a\n\n***\n\nb\n')
    const parts = [...popupOf(view)!.children].map((el) => {
      if (el.classList.contains('ctx-menu__item')) return `row:${el.textContent}${(el as HTMLButtonElement).disabled ? ':disabled' : ''}`
      if (el.classList.contains('block-menu-picker')) return `picker:${el.querySelector('.block-menu-picker__label')?.textContent}:${el.querySelector('.block-menu-picker__value')?.textContent}`
      return el.className
    })
    expect(parts).toEqual([
      'row:Number children:disabled',
      'document-zoom__divider',
      'picker:Line darkness:Default (50%) ▾',
      'picker:Line thickness:Default (3px) ▾',
      'picker:Line style:Default (Solid) ▾',
    ])
    const labels = (i: number) => listButtons(view, i).map((b) => b.firstElementChild?.textContent)
    expect(labels(0)).toEqual(['Default (50%)', '10%', '50%', '100%'])
    expect(labels(1)).toEqual(['Default (3px)', '1px', '3px', '6px'])
    expect(labels(2)).toEqual(['Default (Solid)', 'Solid', 'Dotted', 'Dashed'])
  })

  it('S41: a paragraph, a heading and a bullet get the menu of today', async () => {
    const { view, item } = await mount('# H\n\ntext\n\n* bullet\n')
    for (const type of ['heading', 'paragraph', 'list_item']) {
      aim(view, nth(view, type))
      rightClick(item)
      expect(popupOf(view)!.querySelectorAll('.ctx-menu__item')).toHaveLength(1)
      expect(popupOf(view)!.querySelector('.block-menu-picker')).toBeNull()
    }
  })

  it('S42: a bullet whose FIRST block is a line gets the pickers; a LATER line gets them from its OWN handle, and the bullet’s own handle shows none', async () => {
    const first = await mount('* ---\n  * child\n')
    // Crepe's handle stands for the bullet when its first block is hovered: the probe lands in the line.
    aim(first.view, nth(first.view, 'hr'))
    rightClick(first.item)
    expect(pickers(first.view)).toHaveLength(3)
    aim(first.view, nth(first.view, 'list_item'))
    rightClick(first.item)
    expect(pickers(first.view)).toHaveLength(3)

    const later = await mount('* text\n\n  ***\n')
    aim(later.view, nth(later.view, 'paragraph'))
    rightClick(later.item)
    expect(popupOf(later.view)!.querySelector('.block-menu-picker')).toBeNull()
    // Crepe gives that later line a 6-dot handle of its own: its menu has the pickers.
    aim(later.view, nth(later.view, 'hr'))
    rightClick(later.item)
    expect(pickers(later.view)).toHaveLength(3)
  })

  it('S41: a later paragraph of a bullet led by a line has its own handle, and its menu has no pickers', async () => {
    const { crepe, view, item } = await mount('- ***\n\n  text after\n')
    aim(view, nth(view, 'paragraph'))
    rightClick(item)
    expect(popupOf(view)!.querySelectorAll('.ctx-menu__item')).toHaveLength(1)
    expect(popupOf(view)!.querySelector('.block-menu-picker')).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe('- ***\n\n  text after\n')
  })

  it('targetLine: the line itself, a bullet led by a line, and nothing else', async () => {
    const { view } = await mount('* ---\n* text\n\n***\n')
    const doc = view.state.doc
    expect(targetLine(doc, nth(view, 'hr', 0))?.pos).toBe(nth(view, 'hr', 0))
    expect(targetLine(doc, nth(view, 'list_item', 0))?.pos).toBe(nth(view, 'hr', 0))
    expect(targetLine(doc, nth(view, 'list_item', 1))).toBeNull()
    expect(targetLine(doc, nth(view, 'paragraph', 0))).toBeNull()
    expect(targetLine(doc, nth(view, 'hr', 1))?.pos).toBe(nth(view, 'hr', 1))
    expect(targetLine(doc, -1)).toBeNull()
    const led = await mount('- ***\n\n  text after\n')
    expect(targetLine(led.view.state.doc, nth(led.view, 'paragraph'))).toBeNull()
  })

  it('S51: a read-only note shows no pickers', async () => {
    const { view, item } = await mount('***\n')
    view.setProps({ editable: () => false })
    aim(view, nth(view, 'hr'))
    rightClick(item)
    expect(popupOf(view)?.querySelector('.block-menu-picker') ?? null).toBeNull()
  })
})

describe('picking', () => {
  it('S80: the menu opens with every row closed and no box focused; each value button shows the current value', async () => {
    const before = document.activeElement
    const { view } = await openOnLine('***\n<!-- line: thickness 6px, style dotted -->\n')
    expect(pickers(view).map((p) => p.querySelector<HTMLElement>('.block-menu-picker__panel')!.hidden)).toEqual([true, true, true])
    expect(document.activeElement).toBe(before)
    expect([0, 1, 2].map((i) => valueOf(view, i).textContent)).toEqual(['Default (50%) ▾', '6px ▾', 'Dotted ▾'])
  })

  it('S81: a click on a value opens only that row, its box focused and selected, with the current preset pressed', async () => {
    const { view } = await openOnLine('***\n<!-- line: thickness 6px -->\n')
    const darkness = box(view, 0)
    expect(document.activeElement).toBe(darkness)
    expect([darkness.selectionStart, darkness.selectionEnd]).toEqual([0, darkness.value.length])
    expect(darkness.value).toBe('50%')
    // The line follows the default: "Default" is pressed, not the 50% preset (D11).
    expect(listButtons(view, 0).map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false'])
    const thickness = box(view, 1)
    expect(pickers(view)[0].querySelector<HTMLElement>('.block-menu-picker__panel')!.hidden).toBe(true)
    expect(document.activeElement).toBe(thickness)
    expect(thickness.value).toBe('6px')
    const pressed = presetButtons(view, 1).map((b) => [b.getAttribute('aria-pressed'), b.lastElementChild?.textContent])
    expect(pressed).toEqual([['false', ''], ['false', ''], ['true', '✓']])
  })

  it('S78: "Line style" offers Solid (default), Dotted, Dashed with a sample each; a pick applies, closes, and one ⌘Z undoes it', async () => {
    const { crepe, view, item } = await openOnLine('a\n\n***\n\nb\n')
    const choices = presetButtons(view, 2)
    expect(choices.map((b) => b.querySelector('.block-menu-picker__sample')?.className)).toEqual([
      'block-menu-picker__sample line-sample',
      'block-menu-picker__sample line-sample line-sample--dotted',
      'block-menu-picker__sample line-sample line-sample--dashed',
    ])
    expect(choices.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
    expect(defaultButton(view, 2).lastElementChild?.textContent).toBe('✓')
    choices[2].click()
    expect(popupOf(view)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: style dashed -->\n\nb\n')
    rightClick(item)
    expect(presetButtons(view, 2).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
    presetButtons(view, 2)[1].click()
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: style dotted -->\n\nb\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: style dashed -->\n\nb\n')
    rightClick(item)
    defaultButton(view, 2).click()
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\nb\n')
    expect(view.state.doc.child(1).attrs.pattern).toBeNull()
    rightClick(item)
    presetButtons(view, 2)[0].click()
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: style solid -->\n\nb\n')
  })

  it('S44: Enter applies a typed value and closes; the unit is optional', async () => {
    const { crepe, view, item } = await openOnLine('a\n\n***\n\nb\n')
    type(box(view, 0), '80')
    press(box(view, 0), 'Enter')
    expect(popupOf(view)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: darkness 80% -->\n\nb\n')
    expect(view.dom.contains(document.activeElement)).toBe(true)
    rightClick(item)
    type(box(view, 1), '6px')
    press(box(view, 1), 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: darkness 80%, thickness 6px -->\n\nb\n')
    rightClick(item)
    type(box(view, 0), ' 75 % ')
    press(box(view, 0), 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: darkness 75%, thickness 6px -->\n\nb\n')
  })

  it.each([['text'], ['5.5'], [''], ['4'], ['101'], ['50px']])('S45: darkness "%s" shows the message, keeps the menu open and changes nothing', async (draft) => {
    const { crepe, view } = await openOnLine('***\n')
    const input = box(view, 0)
    type(input, draft)
    press(input, 'Enter')
    expect(popupOf(view)).not.toBeNull()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const error = popupOf(view)!.querySelector('.document-zoom__error')
    expect(error?.textContent).toBe('Use a whole number from 5–100%.')
    expect(error?.getAttribute('role')).toBe('alert')
    expect(input.getAttribute('aria-describedby')).toBe(error?.id)
    expect(getMarkdownForSave(crepe)).toBe('***\n')
    // Typing again clears the message.
    type(input, '5')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(popupOf(view)!.querySelector('.document-zoom__error')).toBeNull()
  })

  it('S45: a bad thickness names its own range', async () => {
    const { view } = await openOnLine('***\n')
    const input = box(view, 1)
    type(input, '25')
    press(input, 'Enter')
    expect(popupOf(view)!.querySelector('.document-zoom__error')?.textContent).toBe('Use a whole number from 1–24px.')
  })

  it('S46: a preset click applies and closes', async () => {
    const { crepe, view } = await openOnLine('***\n')
    presetButtons(view, 1)[2].click()
    expect(popupOf(view)).toBeNull()
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: thickness 6px -->\n')
  })

  it('S47, S78: the current value, typed, picked or chosen, closes the menu with no document change', async () => {
    const { view, item } = await openOnLine('***\n<!-- line: darkness 100%, thickness 6px, style dotted -->\n')
    const doc = view.state.doc
    presetButtons(view, 0)[2].click()
    expect(popupOf(view)).toBeNull()
    rightClick(item)
    presetButtons(view, 2)[1].click()
    expect(popupOf(view)).toBeNull()
    rightClick(item)
    type(box(view, 1), '6')
    press(box(view, 1), 'Enter')
    expect(popupOf(view)).toBeNull()
    expect(view.state.doc).toBe(doc)
    expect(undo(view.state)).toBe(false)
  })

  it('S48: Escape, a click away, a scroll and a window blur close with no change and drop the draft', async () => {
    const closers: Array<(box: HTMLInputElement) => void> = [
      (box) => press(box, 'Escape'),
      () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
      () => document.body.dispatchEvent(new Event('scroll', { bubbles: true })),
      () => window.dispatchEvent(new Event('blur')),
    ]
    for (const closeIt of closers) {
      const { crepe, view, item } = await openOnLine('***\n')
      type(box(view, 0), '60')
      closeIt(box(view, 0))
      expect(popupOf(view)).toBeNull()
      expect(getMarkdownForSave(crepe)).toBe('***\n')
      rightClick(item)
      expect(box(view, 0).value).toBe('50%')
    }
  })

  it('S48: the box’s Escape stops at the menu, and the focus goes back to the editor', async () => {
    const { view } = await openOnLine('***\n')
    let heard = false
    const listener = () => (heard = true)
    window.addEventListener('keydown', listener)
    press(box(view, 0), 'Escape')
    window.removeEventListener('keydown', listener)
    expect(heard).toBe(false)
    expect(view.dom.contains(document.activeElement)).toBe(true)
  })

  it('S94: "Default" removes that part, and a line with every part at Default saves as plain ***', async () => {
    const { crepe, view, item } = await openOnLine('***\n<!-- line: darkness 80%, thickness 6px, length 40% -->\n')
    defaultButton(view, 0).click()
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: thickness 6px, length 40% -->\n')
    expect(view.state.doc.child(0).attrs.darkness).toBeNull()
    rightClick(item)
    defaultButton(view, 1).click()
    expect(getMarkdownForSave(crepe)).toBe('***\n\n<!-- line: length 40% -->\n')
    const line = await openOnLine('***\n<!-- line: thickness 12px -->\n')
    defaultButton(line.view, 1).click()
    expect(getMarkdownForSave(line.crepe)).toBe('***\n')
  })

  it('S93: a picked or typed value equal to the default is written', async () => {
    const { crepe, view, item } = await openOnLine('a\n\n***\n\nb\n')
    presetButtons(view, 0)[1].click()
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: darkness 50% -->\n\nb\n')
    rightClick(item)
    type(box(view, 1), '3px')
    press(box(view, 1), 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: darkness 50%, thickness 3px -->\n\nb\n')
    rightClick(item)
    // The value button now shows the value, not "Default (…)".
    expect(valueOf(view, 0).textContent).toBe('50% ▾')
  })

  it('D11: "Default" reads the vault’s current default from the line’s computed --line-default-*', async () => {
    const { view, item } = await mount('***\n')
    const wrapper = view.nodeDOM(nth(view, 'hr')) as HTMLElement
    wrapper.style.setProperty('--line-default-darkness', '70%')
    wrapper.style.setProperty('--line-default-thickness', '8px')
    wrapper.style.setProperty('--line-default-pattern', 'dashed')
    aim(view, nth(view, 'hr'))
    rightClick(item)
    expect([0, 1, 2].map((i) => valueOf(view, i).textContent)).toEqual(['Default (70%) ▾', 'Default (8px) ▾', 'Default (Dashed) ▾'])
    expect(box(view, 0).value).toBe('70%')
    expect(defaultButton(view, 2).querySelector('.block-menu-picker__sample')?.className).toBe('block-menu-picker__sample line-sample line-sample--dashed')
  })

  it('S50: ⌘Z undoes one pick in one step', async () => {
    const { crepe, view, item } = await openOnLine('a\n\n***\n\nb\n')
    presetButtons(view, 0)[0].click()
    rightClick(item)
    presetButtons(view, 1)[0].click()
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: darkness 10%, thickness 1px -->\n\nb\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\n<!-- line: darkness 10% -->\n\nb\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('a\n\n***\n\nb\n')
  })

  it('a line in a bullet is styled in place', async () => {
    const { crepe, view } = await openOnLine('* ---\n  * child\n')
    presetButtons(view, 0)[2].click()
    expect(getMarkdownForSave(crepe)).toBe('- ***\n  <!-- line: darkness 100% -->\n  * child\n')
  })
})
