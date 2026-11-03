import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { docToBox, posAt, type TextRuns } from './textBoxDoc'
import { helpers, mountBox, typeText, unmountAll } from './textBoxTestKit'

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

/**
 * The keys of a text box (YAZ-4277 1D parity rows 9, 18, 20, 23, 24): the notes engine's own keys, on the box's
 * text and runs. They were the textarea's (`textWysiwyg.test.tsx`), and live in the box editor now.
 */

const box = (view: EditorView, before = { text: '', textRuns: undefined as TextRuns }) => docToBox(view.state.doc, before, helpers)

/** A key as the keyboard sends it: the editor's key handlers, then nothing (the tests type letters with `typeText`). */
function press(view: EditorView, key: string, mods: { mod?: boolean; shift?: boolean; alt?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { key, metaKey: !!mods.mod, ctrlKey: false, shiftKey: !!mods.shift, altKey: !!mods.alt, bubbles: true, cancelable: true })
  // ProseMirror reads a shifted letter's base key from its key code
  if (key.length === 1) Object.defineProperty(event, 'keyCode', { value: key.toUpperCase().charCodeAt(0) })
  return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false
}

function select(view: EditorView, start: number, end = start) {
  const { doc } = view.state
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, posAt(doc, start, helpers), posAt(doc, end, helpers))))
}

describe('the keys of a text box (YAZ-4277 1D)', () => {
  it.each([
    ['b', {}, { bold: true }],
    ['i', {}, { italic: true }],
    ['u', {}, { underline: true }],
    ['x', { shift: true }, { strikethrough: true }],
    ['h', { shift: true }, { highlight: 'yellow' }],
  ] as const)('⌘%s styles only the selected letters, and again takes it off', async (key, mods, style) => {
    const { view } = await mountBox('Hello world')
    select(view, 6, 11)
    expect(press(view, mods && 'shift' in mods ? key.toUpperCase() : key, { mod: true, ...mods })).toBe(true)
    expect(box(view).textRuns).toEqual([{ start: 6, end: 11, ...style }])
    press(view, mods && 'shift' in mods ? key.toUpperCase() : key, { mod: true, ...mods })
    expect(box(view).textRuns).toBeUndefined()
  })

  it('gives the next typed letters the style of a key pressed with only a caret, and a caret move drops it', async () => {
    const { view } = await mountBox('ab')
    select(view, 2)
    press(view, 'b', { mod: true })
    typeText(view, 'X')
    expect(box(view)).toEqual({ text: 'abX', textRuns: [{ start: 2, end: 3, bold: true }] })
    select(view, 1)
    select(view, 3)
    typeText(view, 'Y')
    expect(box(view).textRuns).toEqual([{ start: 2, end: 4, bold: true }])
  })

  it('un-styles a part of a run', async () => {
    const { view } = await mountBox('Hello world', [{ start: 0, end: 11, bold: true }])
    select(view, 0, 6)
    press(view, 'b', { mod: true })
    expect(box(view).textRuns).toEqual([{ start: 6, end: 11, bold: true }])
  })

  it('keeps a highlight with other styles', async () => {
    const { view } = await mountBox('word', [{ start: 0, end: 4, bold: true }])
    select(view, 0, 4)
    press(view, 'H', { mod: true, shift: true })
    expect(box(view).textRuns).toEqual([{ start: 0, end: 4, bold: true, highlight: 'yellow' }])
  })

  it('⌘Z gives back cut letters with their styles', async () => {
    const { view } = await mountBox('Hello world', [{ start: 6, end: 11, bold: true }])
    select(view, 5, 11)
    view.dispatch(view.state.tr.deleteSelection())
    expect(box(view)).toEqual({ text: 'Hello', textRuns: undefined })
    const { undo } = await import('@milkdown/kit/prose/history')
    undo(view.state, view.dispatch)
    expect(box(view)).toEqual({ text: 'Hello world', textRuns: [{ start: 6, end: 11, bold: true }] })
  })

  it('Enter in a bullet continues the list; Enter on an empty bullet leaves it', async () => {
    const { view } = await mountBox('• one')
    select(view, 5)
    press(view, 'Enter')
    typeText(view, 'two')
    expect(box(view).text).toBe('• one\n• two')
    press(view, 'Enter')
    press(view, 'Enter')
    typeText(view, 'after')
    expect(box(view).text).toBe('• one\n• two\nafter')
  })

  it('Enter in a nested bullet keeps its level', async () => {
    const { view } = await mountBox('• one\n    ○ two')
    select(view, 15)
    press(view, 'Enter')
    typeText(view, 'three')
    expect(box(view).text).toBe('• one\n    ○ two\n    ○ three')
  })

  it('Tab and Shift-Tab indent and outdent a bullet', async () => {
    const { view } = await mountBox('• one\n• two')
    select(view, 11)
    press(view, 'Tab')
    expect(box(view).text).toBe('• one\n    ○ two')
    press(view, 'Tab', { shift: true })
    expect(box(view).text).toBe('• one\n• two')
  })

  it('Tab adds 4 spaces at the start of each covered plain line; Shift-Tab takes up to 4 away', async () => {
    const { view } = await mountBox('one\ntwo\nthree')
    select(view, 1, 6)
    press(view, 'Tab')
    expect(box(view).text).toBe('    one\n    two\nthree')
    press(view, 'Tab', { shift: true })
    expect(box(view).text).toBe('one\ntwo\nthree')
    const { view: partial } = await mountBox('  two')
    select(partial, 3)
    press(partial, 'Tab', { shift: true })
    expect(box(partial).text).toBe('two')
  })

  it('a style typed on a bullet stays on its letters when the list changes', async () => {
    const { view } = await mountBox('• one\n• bold', [{ start: 8, end: 12, bold: true }])
    select(view, 12)
    press(view, 'Tab')
    expect(box(view)).toEqual({ text: '• one\n    ○ bold', textRuns: [{ start: 12, end: 16, bold: true }] })
  })

  it('a paste from a note keeps its letter styles (row 26)', async () => {
    ;(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent ??= class extends Event {
      clipboardData = null
    }
    const { view } = await mountBox('')
    view.pasteHTML('<p><strong>b</strong> <em>i</em> <u>u</u> <del>s</del> <mark>h</mark> <mark class="highlight-green">g</mark></p>')
    expect(box(view)).toEqual({
      text: 'b i u s h g',
      textRuns: [
        { start: 0, end: 1, bold: true },
        { start: 2, end: 3, italic: true },
        { start: 4, end: 5, underline: true },
        { start: 6, end: 7, strikethrough: true },
        { start: 8, end: 9, highlight: 'yellow' },
        { start: 10, end: 11, highlight: 'green' },
      ],
    })
  })

  it('a copy goes to a note with its tags (row 27)', async () => {
    const { view } = await mountBox('bold plain', [{ start: 0, end: 4, bold: true }])
    select(view, 0, 10)
    const data = new Map<string, string>()
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (type: string, value: string) => data.set(type, value), clearData: () => data.clear(), getData: (type: string) => data.get(type) ?? '' },
    })
    view.dom.dispatchEvent(event)
    expect(data.get('text/html')).toContain('<strong>bold</strong>')
    expect(data.get('text/plain')).toContain('bold plain')
  })

  it("takes the user's note keys from Settings › Hotkeys (row 18)", async () => {
    const { storage } = await import('../lib/storage')
    const spy = vi.spyOn(storage, 'getSettings').mockReturnValue({ ...storage.getSettings(), hotkeys: { 'note.highlight': 'CmdOrCtrl+Alt+H' } } as ReturnType<typeof storage.getSettings>)
    try {
      const { view } = await mountBox('word')
      select(view, 0, 4)
      // ⌘⇧H no longer highlights; the user's ⌘⌥H does
      press(view, 'H', { mod: true, shift: true })
      expect(box(view).textRuns).toBeUndefined()
      press(view, 'h', { mod: true, alt: true })
      expect(box(view).textRuns).toEqual([{ start: 0, end: 4, highlight: 'yellow' }])
    } finally {
      spy.mockRestore()
    }
  })
})
