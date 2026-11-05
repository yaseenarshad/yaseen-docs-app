import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@milkdown/kit/prose/state'
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
      'text-color-black', 'text-color-red', 'text-color-blue', 'text-color-box',
    ])
    // 1E: a color button colors the selected letters, and the box color takes it off
    const color = (key: string) => buttons.find((button) => button.dataset.toolbarItem === key)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
    color('text-color-red')
    expect(docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).textRuns).toEqual([{ start: 0, end: 4, color: '#e03131' }])
    color('text-color-box')
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
    expect(view.state.selection.from).toBe(0)
    expect(view.state.selection.to).toBe(view.state.doc.content.size)
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
      // the box color and a second click take the style off again
      button(key === 'text-color-red' ? 'text-color-box' : key)
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
