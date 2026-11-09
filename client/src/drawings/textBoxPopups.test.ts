import { afterEach, describe, expect, it, vi } from 'vitest'
import { Selection, TextSelection } from '@milkdown/kit/prose/state'
import { docToBox, PANEL_HIGHLIGHT_HEX } from './textBoxDoc'
import { helpers, mountBox, typeText, unmountAll } from './textBoxTestKit'
// After the kit, which loads the editor first: this module alone would start an import cycle
import { HIGHLIGHT_HEX } from '../editor/marks/highlight'

vi.mock('../editor/createCrepe', async (load) => {
  const real = await load<typeof import('../editor/createCrepe')>()
  const list = ((globalThis as { __textBoxCrepes?: unknown[] }).__textBoxCrepes ??= [])
  return {
    ...real,
    createCrepe: (...args: Parameters<typeof real.createCrepe>) => {
      const crepe = real.createCrepe(...args)
      list.push(crepe)
      return crepe
    },
  }
})

afterEach(unmountAll)

const settle = () => new Promise((r) => setTimeout(r, 80))
/** The text color ▾'s panel (YAZ-4445), in the pop-ups' layer. */
const colorPanel = () => document.querySelector<HTMLElement>('.excalidraw-text-box-popups .text-color-panel')
/** A real click on a panel button: the mousedown it cancels (the selection stays), then the click. */
const clickInPanel = (label: string) => {
  const el = colorPanel()!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  if (el === null) throw new Error(`no panel button: ${label}`)
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  el.dispatchEvent(down)
  expect(down.defaultPrevented).toBe(true)
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
}
const pressItem = (key: string) =>
  document.querySelector<HTMLElement>(`.excalidraw-text-box-popups .milkdown-toolbar [data-toolbar-item="${key}"]`)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
/** The ▾'s None: the letters take the box color again (YAZ-4445: the ⊘ button moved into the ▾). */
const pickNone = () => {
  pressItem('text-color-more')
  clickInPanel('Text color: none')
}
const boxText = (view: Awaited<ReturnType<typeof mountBox>>['view']) => docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).text

describe('the pop-up toolbar and the / menu of a text box (YAZ-4277 1C, D4, D8)', () => {
  it('shows the toolbar on a letter selection, outside the zoomed root, with the checklist, the letter colors and no heading', async () => {
    const { view, root } = await mountBox('pick these words')
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)))
    await settle()
    const toolbar = document.querySelector<HTMLElement>('.excalidraw-text-box-popups .milkdown-toolbar')
    expect(toolbar).not.toBeNull()
    expect(root.querySelector('.milkdown-toolbar')).toBeNull()
    expect(toolbar!.dataset.show).toBe('true')
    const buttons = [...toolbar!.querySelectorAll<HTMLElement>('[data-toolbar-item]')]
    expect(buttons.map((button) => button.dataset.toolbarItem)).toEqual([
      // YAZ-4388 (main): pink moved into the highlight ▾ panel, `highlight-more`
      'text', 'checklist', 'bulletList', 'bold', 'italic', 'underline', 'strikethrough', 'highlight', 'highlight-green', 'highlight-blue', 'highlight-more',
      'text-color-black', 'text-color-red', 'text-color-blue', 'text-color-more',
    ])
    // 1E: a color button colors the selected letters, and the ▾'s None takes it off (YAZ-4445)
    const color = (key: string) => buttons.find((button) => button.dataset.toolbarItem === key)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    color('text-color-red')
    expect(docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).textRuns).toEqual([{ start: 0, end: 4, color: '#e03131' }])
    pickNone()
    expect(docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).textRuns).toBeUndefined()
    // the Checklist button makes the line a checklist item
    const checklist = buttons.find((button) => button.dataset.toolbarItem === 'checklist')!
    checklist.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(boxText(view)).toBe('☐ pick these words')
  })

  it('maps every note highlight name a box has no name for to the note’s own hex (YAZ-4388)', () => {
    const { yellow, green, blue, pink, ...others } = HIGHLIGHT_HEX
    void [yellow, green, blue, pink]
    expect(PANEL_HIGHLIGHT_HEX).toEqual(others)
  })

  it.each([
    ['pink', 'pink'],
    ['orange', '#ff9632'],
    ['gray', '#969696'],
    ['#123abc', '#123abc'],
  ])('keeps a %s highlight from the ▾ panel (YAZ-4388) on the box letters, as %s', async (color, run) => {
    const { view } = await mountBox('pick these words')
    view.dispatch(view.state.tr.addMark(1, 5, view.state.schema.marks.highlight.create({ color })))
    // the box keeps the four note names it draws; any other panel colour is its own hex, which a box draws too
    expect(docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).textRuns).toEqual([{ start: 0, end: 4, highlight: run }])
  })

  it('shows the / menu outside the root, with the checklist row and no heading, quote, code or numbered row', async () => {
    const { view, root } = await mountBox('')
    view.focus()
    typeText(view, '/')
    await settle()
    const menu = document.querySelector<HTMLElement>('.excalidraw-text-box-popups .milkdown-slash-menu')
    expect(menu).not.toBeNull()
    expect(root.querySelector('.milkdown-slash-menu')).toBeNull()
    const rows = [...menu!.querySelectorAll<HTMLElement>('.menu-group li')]
    expect(rows.map((row) => row.textContent?.trim())).toEqual(['Text', 'Current time', 'Bullet List', 'Task List'])
    expect([...menu!.querySelectorAll('.tab-group li')].map((tab) => tab.textContent)).toEqual(['Text', 'List'])
    // the Task List row makes the line a checklist item
    const task = rows.find((row) => row.textContent?.trim() === 'Task List')!
    task.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    task.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }))
    await settle()
    expect(boxText(view)).toBe('☐ ')
  })
})

/**
 * YAZ-4398 1H: the toolbar and the `/` menu are placed from the canvas. The view's `coordsAtPos` asks the mount's
 * `clientRectAt` with the box offset of the position, and uses the editor's own layout only when the canvas has no answer.
 */
describe('the pop-ups are placed from the canvas (YAZ-4398 1H)', () => {
  const at = (left: number, top: number) => ({ left, right: left + 1, top, bottom: top + 20 })
  /** The px of the floating element's own place, from its inline style (Floating UI writes left / top or a translate). */
  const placed = (el: HTMLElement) => {
    const style = el.style
    const translate = /translate(?:3d)?\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(style.transform)
    return translate !== null ? { x: Number(translate[1]), y: Number(translate[2]) } : { x: Number.parseFloat(style.left), y: Number.parseFloat(style.top) }
  }

  it('coordsAtPos is the canvas rect of the box offset (not the document position)', async () => {
    const clientRectAt = vi.fn((offset: number) => at(1000 + offset * 10, 400))
    const { view } = await mountBox('pick these words', undefined, { anchor: 0, head: 0 }, [], clientRectAt)
    // position 6 in the document is offset 5 in the box's text: "pick |these"
    expect(view.coordsAtPos(6)).toEqual(at(1050, 400))
    expect(clientRectAt).toHaveBeenLastCalledWith(5)
  })

  it('a selection puts the toolbar at the canvas rect of the selected words', async () => {
    const canvas = { x: 1200, y: 640 }
    const { view } = await mountBox('pick these words', undefined, { anchor: 0, head: 0 }, [], () => at(canvas.x, canvas.y))
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6, 11)))
    await settle()
    const toolbar = document.querySelector<HTMLElement>('.excalidraw-text-box-popups .milkdown-toolbar')!
    expect(toolbar.dataset.show).toBe('true')
    const first = placed(toolbar)
    // the canvas moves the words (a pan or a zoom): the toolbar follows the canvas, not the hidden editor
    canvas.x = 300
    canvas.y = 90
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)))
    await settle()
    const second = placed(toolbar)
    // jsdom has no viewport width, so Floating UI's shift pins the toolbar's x at 0; its y follows the canvas
    expect(first.y - second.y).toBeCloseTo(550, 0)
  })

  it('the / menu is placed at the canvas rect of the caret', async () => {
    const canvas = { x: 700, y: 500 }
    const { view } = await mountBox('', undefined, { anchor: 0, head: 0 }, [], () => at(canvas.x, canvas.y))
    view.focus()
    typeText(view, '/')
    await settle()
    const menu = document.querySelector<HTMLElement>('.excalidraw-text-box-popups .milkdown-slash-menu')!
    const first = placed(menu)
    canvas.x = 100
    canvas.y = 100
    typeText(view, 't')
    await settle()
    const second = placed(menu)
    expect(first.x - second.x).toBeCloseTo(600, 0)
    expect(first.y - second.y).toBeCloseTo(400, 0)
  })
})

/**
 * YAZ-4440 (1H1, demo round 2): ⌘A in a box makes ProseMirror's `AllSelection` (the keymap's select all), not a
 * `TextSelection`. The toolbar shows on it as on a drag over all the words, and its buttons act on all the text.
 */
describe('⌘A shows the pop-up toolbar (YAZ-4440)', () => {
  const at = (left: number, top: number) => ({ left, right: left + 1, top, bottom: top + 20 })
  /** ⌘A as ProseMirror's keymap reads it here ("Mod" is ⌘ on a Mac, Ctrl elsewhere). */
  const selectAll = (view: Awaited<ReturnType<typeof mountBox>>['view']) => {
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
    const event = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true })
    expect(view.someProp('handleKeyDown', (f) => f(view, event))).toBe(true)
  }
  const button = (key: string) =>
    document.querySelector<HTMLElement>(`.excalidraw-text-box-popups .milkdown-toolbar [data-toolbar-item="${key}"]`)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))

  it('after ⌘A the toolbar shows, placed from the canvas at the ends of the text', async () => {
    const clientRectAt = vi.fn((offset: number) => at(500 + offset * 10, 300))
    const { view } = await mountBox('pick these\nwords', undefined, { anchor: 2, head: 2 }, [], clientRectAt)
    view.focus()
    selectAll(view)
    // ⌘A selects the letters, first to last (YAZ-3746 13AA), not ProseMirror's select-all from outside the first line
    expect(view.state.selection.from).toBe(Selection.atStart(view.state.doc).from)
    expect(view.state.selection.to).toBe(Selection.atEnd(view.state.doc).to)
    await settle()
    const toolbar = document.querySelector<HTMLElement>('.excalidraw-text-box-popups .milkdown-toolbar')!
    expect(toolbar.dataset.show).toBe('true')
    // the toolbar's place comes from the canvas: the first and the last offset of the box's text
    expect(clientRectAt).toHaveBeenCalledWith(0)
    expect(clientRectAt).toHaveBeenCalledWith('pick these\nwords'.length)
  })

  it('after ⌘A each button acts on all the text', async () => {
    const text = 'pick these\nwords'
    const { view } = await mountBox(text)
    view.focus()
    selectAll(view)
    await settle()
    const runs = () => docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).textRuns
    const all = (style: Record<string, unknown>) => [{ start: 0, end: 10, ...style }, { start: 11, end: 16, ...style }]
    for (const [key, style] of [
      ['bold', { bold: true }],
      ['italic', { italic: true }],
      ['underline', { underline: true }],
      ['strikethrough', { strikethrough: true }],
      ['text-color-red', { color: '#e03131' }],
    ] as const) {
      button(key)
      expect(runs()).toEqual(all(style))
      // the ▾'s None and a second click take the style off again
      if (key === 'text-color-red') pickNone()
      else button(key)
      expect(runs()).toBeUndefined()
    }
    button('highlight')
    expect(runs()?.every((run) => run.highlight !== undefined)).toBe(true)
    expect(runs()?.map((run) => [run.start, run.end])).toEqual([[0, 10], [11, 16]])
    button('checklist')
    expect(boxText(view)).toBe('☐ pick these\n☐ words')
  })
})

/**
 * YAZ-4442 (1H2): a box's list item holds one line (`paragraph bullet_list?`, `textBoxLock.ts`). The list buttons
 * wrapped all the selected plain lines in ONE item, which a box cannot hold: the click threw and nothing changed.
 */
describe('the list buttons on several plain lines of a box (YAZ-4442)', () => {
  const click = (key: string) =>
    document.querySelector<HTMLElement>(`.excalidraw-text-box-popups .milkdown-toolbar [data-toolbar-item="${key}"]`)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))

  it.each([
    ['checklist', '☐ one\n☐ two\n☐ three'],
    ['bulletList', '• one\n• two\n• three'],
  ])('%s makes each selected plain line an item, and a second click makes them plain lines again', async (key, items) => {
    const { view } = await mountBox('before\none\ntwo\nthree')
    view.focus()
    // a drag from inside "one" to inside "three"
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 10, 22)))
    await settle()
    click(key)
    expect(boxText(view)).toBe(`before\n${items}`)
    click(key)
    expect(boxText(view)).toBe('before\none\ntwo\nthree')
  })
})

/** YAZ-4396 1F: the editor is invisible and zoomed, so ProseMirror never scrolls to show its selection (the board did move). */
describe('the text box editor never scrolls (YAZ-4396 1F)', () => {
  it('its scroll-to-selection handler answers "done", so ProseMirror scrolls no layer', async () => {
    const { view } = await mountBox('pick these words')
    expect(view.someProp('handleScrollToSelection', (f) => f(view))).toBe(true)
    // and a transaction that asks to scroll reaches the handler, not ProseMirror's own scroll
    const coords = vi.spyOn(view, 'coordsAtPos')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)).scrollIntoView())
    expect(coords).not.toHaveBeenCalled()
  })
})

/**
 * YAZ-4445 (1H3, Yaseen: "can we make this look the same also so its 1 design language?"): the pop-up toolbar's text
 * colors are the board toolbar's tiles: a colored "A" on white (black, red, blue), then a ▾ with the board's other
 * colors and None, which replaced the ⊘ button. The names are the board's: "Text red".
 */
describe('the text colors are the board toolbar tiles (YAZ-4445)', () => {
  const toolbarItem = (key: string) => document.querySelector<HTMLElement>(`.excalidraw-text-box-popups .milkdown-toolbar [data-toolbar-item="${key}"]`)!
  const runs = (view: Awaited<ReturnType<typeof mountBox>>['view']) => docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).textRuns
  const selectWord = async () => {
    const box = await mountBox('pick these words')
    box.view.focus()
    box.view.dispatch(box.view.state.tr.setSelection(TextSelection.create(box.view.state.doc, 1, 5)))
    await settle()
    return box
  }
  /** A tile as the board draws it: its kind, its color and its letter. */
  const tile = (button: Element) => {
    const el = button.querySelector<HTMLElement>('.swatch-tile')
    return el && { kinds: [...el.classList].filter((c) => c !== 'swatch-tile'), color: el.style.getPropertyValue('--swatch-color'), letter: el.querySelector('.swatch-tile__letter')?.textContent }
  }

  it('three tiles with a colored "A" on white, named as on the board, then the ▾', async () => {
    await selectWord()
    for (const [key, color, name] of [
      ['text-color-black', '#1e1e1e', 'Text black'],
      ['text-color-red', '#e03131', 'Text red'],
      ['text-color-blue', '#1971c2', 'Text blue'],
    ]) {
      expect(tile(toolbarItem(key))).toEqual({ kinds: ['swatch-tile--color'], color, letter: 'A' })
      expect(toolbarItem(key).title).toBe(name)
    }
    // the board's ▾: the glyph, no tile
    expect(toolbarItem('text-color-more').querySelector('.swatch-more')?.textContent).toBe('▾')
    expect(tile(toolbarItem('text-color-more'))).toBeNull()
  })

  it('the ▾ holds the board’s other colors and None; a pick colors the letters, None takes the color off', async () => {
    const { view } = await selectWord()
    const before = view.state.selection
    pressItem('text-color-more')
    expect(colorPanel()).not.toBeNull()
    expect(colorPanel()!.hidden).toBe(false)
    // it takes neither the selection nor the focus
    expect(view.state.selection.eq(before)).toBe(true)
    const buttons = [...colorPanel()!.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Text green', 'Text white', 'Text orange', 'Text violet', 'Text gray', 'Text color: none'])
    expect(buttons.slice(0, 5).map((b) => tile(b)?.color)).toEqual(['#2f9e44', '#ffffff', '#e8590c', '#6741d9', '#343a40'])
    expect(buttons.slice(0, 5).every((b) => tile(b)?.letter === 'A')).toBe(true)
    expect(buttons[5].textContent).toBe('None')

    clickInPanel('Text green')
    expect(runs(view)).toEqual([{ start: 0, end: 4, color: '#2f9e44' }])
    // as on the board, the ▾ stays open for the next pick, its pick ringed
    expect(colorPanel()!.hidden).toBe(false)
    expect(colorPanel()!.querySelector('button[aria-label="Text green"]')!.getAttribute('aria-pressed')).toBe('true')
    await settle()
    // the ▾ marks a color of its own with a bar of that color, as the board's
    expect(toolbarItem('text-color-more').classList.contains('active')).toBe(true)
    expect(document.querySelector<HTMLElement>('.excalidraw-text-box-popups .milkdown-toolbar')!.style.getPropertyValue('--text-color-more-colour')).toBe('#2f9e44')
    expect(toolbarItem('text-color-red').classList.contains('active')).toBe(false)

    clickInPanel('Text color: none')
    expect(runs(view)).toBeUndefined()
    expect(colorPanel()!.hidden).toBe(true)
    await settle()
    expect(toolbarItem('text-color-more').classList.contains('active')).toBe(false)
  })

  it('the white text color is a white "A" on a dark tile', async () => {
    const { view } = await selectWord()
    pressItem('text-color-more')
    const white = colorPanel()!.querySelector<HTMLButtonElement>('button[aria-label="Text white"]')!
    expect(tile(white)).toEqual({ kinds: ['swatch-tile--color', 'is-canonical-white'], color: '#ffffff', letter: 'A' })
    clickInPanel('Text white')
    expect(runs(view)).toEqual([{ start: 0, end: 4, color: '#ffffff' }])
  })

  it('Escape, a click outside or a new selection closes the ▾', async () => {
    const { view } = await selectWord()
    pressItem('text-color-more')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(colorPanel()!.hidden).toBe(true)
    pressItem('text-color-more')
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    expect(colorPanel()!.hidden).toBe(true)
    pressItem('text-color-more')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6, 11)))
    expect(colorPanel()!.hidden).toBe(true)
    // the ▾ again closes it too
    pressItem('text-color-more')
    pressItem('text-color-more')
    expect(colorPanel()!.hidden).toBe(true)
  })

  it('the highlight ▾ panel finds its ▾ in the pop-ups’ layer: placed under it, and it stays on a scroll', async () => {
    await selectWord()
    const arrow = toolbarItem('highlight-more')
    arrow.getBoundingClientRect = () => ({ left: 200, right: 216, top: 268, bottom: 300, width: 16, height: 32, x: 200, y: 268, toJSON: () => ({}) })
    pressItem('highlight-more')
    const panel = document.querySelector<HTMLElement>('body > .highlight-panel')!
    expect(panel.hidden).toBe(false)
    expect([panel.style.left, panel.style.top]).toEqual(['200px', '304px'])
    document.dispatchEvent(new Event('scroll'))
    expect(panel.hidden).toBe(false)
    panel.remove()
  })
})
