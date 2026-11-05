import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { outlineCollapsedPositions } from '../editor/outline/outlineFolding'
import { docToBox, itemLines, posAt } from './textBoxDoc'
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
 * Folds in edit (YAZ-4306) and ⌘↑ / ⌘↓ in edit (YAZ-4308, 2C): the box editor keeps the box's folds in the note's own
 * fold state, reports them as line indexes, and acts on them as a note does.
 */

const folds = (view: EditorView) => itemLines(view.state.doc, outlineCollapsedPositions(view.state), helpers)
const text = (view: EditorView) => docToBox(view.state.doc, { text: '', textRuns: undefined }, helpers).text

function press(view: EditorView, key: string, mods: { mod?: boolean; alt?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { key, metaKey: !!mods.mod, altKey: !!mods.alt, bubbles: true, cancelable: true })
  if (key.length === 1) Object.defineProperty(event, 'keyCode', { value: key.toUpperCase().charCodeAt(0) })
  return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false
}

function caret(view: EditorView, offset: number) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, posAt(view.state.doc, offset, helpers))))
}

const BOX = '• a\n    ○ b\n    ○ c\n• d'

describe('folds in the box editor (YAZ-4306, YAZ-4308)', () => {
  it('opens with the box folds in the note fold state, and reports nothing for them', async () => {
    const { view, onFoldsChange } = await mountBox(BOX, undefined, { anchor: 0, head: 0 }, [0])
    expect(folds(view)).toEqual([0])
    expect(onFoldsChange).not.toHaveBeenCalled()
  })

  it('⌘↑ folds and ⌘↓ unfolds the bullet at the caret, reported as no text change', async () => {
    const { view, onFoldsChange, onChange } = await mountBox(BOX)
    caret(view, 1)
    expect(press(view, 'ArrowUp', { mod: true })).toBe(true)
    expect(onFoldsChange).toHaveBeenLastCalledWith([0])
    press(view, 'ArrowDown', { mod: true })
    expect(onFoldsChange).toHaveBeenLastCalledWith([])
    expect(onChange).not.toHaveBeenCalled()
  })

  it("⌘↑ takes the user's key from Settings › Hotkeys", async () => {
    const { storage } = await import('../lib/storage')
    const spy = vi.spyOn(storage, 'getSettings').mockReturnValue({ ...storage.getSettings(), hotkeys: { 'note.foldHere': 'CmdOrCtrl+Alt+K' } } as ReturnType<typeof storage.getSettings>)
    try {
      const { view, onFoldsChange } = await mountBox(BOX)
      caret(view, 1)
      press(view, 'k', { mod: true, alt: true })
      expect(onFoldsChange).toHaveBeenLastCalledWith([0])
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps a fold on its bullet when a line is added above it', async () => {
    const { view, onChange, onFoldsChange } = await mountBox(`Title\n${BOX}`, undefined, { anchor: 0, head: 0 }, [1])
    caret(view, 0)
    press(view, 'Enter')
    expect(onChange).toHaveBeenLastCalledWith(`\nTitle\n${BOX}`, undefined, expect.anything())
    expect(onFoldsChange).toHaveBeenLastCalledWith([2])
  })

  it('Enter at the end of a folded bullet makes the new bullet after its hidden lines', async () => {
    const { view } = await mountBox(BOX, undefined, { anchor: 0, head: 0 }, [0])
    caret(view, 3)
    press(view, 'Enter')
    typeText(view, 'x')
    expect(text(view)).toBe('• a\n    ○ b\n    ○ c\n• x\n• d')
    expect(folds(view)).toEqual([0])
  })

  it('takes the folds the engine sends (a fold arrow click), with no report back', async () => {
    const { view, session, onFoldsChange } = await mountBox(BOX)
    session.setFolds([0])
    expect(folds(view)).toEqual([0])
    session.setFolds([])
    expect(folds(view)).toEqual([])
    expect(onFoldsChange).not.toHaveBeenCalled()
  })

  it('⌘Z never undoes a fold (D3)', async () => {
    const { view } = await mountBox(BOX)
    caret(view, 1)
    typeText(view, 'z')
    press(view, 'ArrowUp', { mod: true })
    expect(folds(view)).toEqual([0])
    press(view, 'z', { mod: true })
    // the typing goes back; the fold stays
    expect(text(view)).toBe(BOX)
    expect(folds(view)).toEqual([0])
  })
})
