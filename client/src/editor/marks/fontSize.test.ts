/**
 * Inline font size mark (`marks/fontSize.ts`, YAZ-6694 D3), hotkeys (`shared/keys/page.ts`),
 * and `[16 ▾]` popover (`fontSizePanel.ts`, YAZ-6695 D5).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { PAGE_KEYS } from '@shared/keys/page'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { setEnterKeepsStyle } from '../enterKeepsStyle'
import { clearFormatting } from './clearFormatting'
import {
  applyFontSize,
  DEFAULT_FONT_SIZE,
  FONT_SIZE_PRESETS,
  fontSizeSchema,
  removeFontSize,
  selectionFontSize,
  stepFontSize,
} from './fontSize'
import { mount as mountToolbar, must, press, select, settle, unmountAll } from '../toolbarTestKit'

const mounted: Array<{ crepe: ReturnType<typeof createCrepe>; root: HTMLElement }> = []

async function mountDoc(markdown: string, hotkeys?: Record<string, string | null>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, hotkeys })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, view: crepe.editor.ctx.get(editorViewCtx) }
}

afterEach(async () => {
  setEnterKeepsStyle(false, true)
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  await unmountAll()
  document.querySelectorAll('.highlight-panel, .font-size-panel').forEach((el) => el.remove())
})

function selectWord(view: EditorView, word: string) {
  let pos = -1
  view.state.doc.descendants((node, at) => {
    if (pos < 0 && node.isText && node.text?.includes(word)) pos = at + node.text.indexOf(word)
    return pos < 0
  })
  if (pos < 0) throw new Error(`word not found: ${word}`)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos, pos + word.length)))
}

describe('font_size mark round-trip, commands, and hotkeys (YAZ-6694 D3, #8)', () => {
  it('round-trips <span style="font-size: Npx"> for 8–96 and leaves out-of-range sizes as HTML', async () => {
    const src = 'a <span style="font-size: 8px">tiny</span> <span style="font-size: 24px">big</span> <span style="font-size: 96px">huge</span> <span style="font-size: 7px">too-small</span> <span style="font-size: 100px">too-big</span>\n'
    const { crepe, root } = await mountDoc(src)
    expect(getMarkdownForSave(crepe)).toBe(src)
    const sized = [...root.querySelectorAll<HTMLElement>('.ProseMirror span[data-font-size]')]
    expect(sized.map((el) => [el.textContent, el.getAttribute('data-font-size'), el.style.fontSize])).toEqual([
      ['tiny', '8', '8px'],
      ['big', '24', '24px'],
      ['huge', '96', '96px'],
    ])
  })

  it('applyFontSize clamps 8–96, treats Default/null and 16 as mark removal, and stepFontSize steps cleanly', async () => {
    const { crepe, view } = await mountDoc('hello world\n')
    const type = fontSizeSchema.type(crepe.editor.ctx)
    selectWord(view, 'world')
    expect(selectionFontSize(view.state, type)).toBe(null)
    expect(removeFontSize(type)(view.state, view.dispatch)).toBe(false)

    expect(applyFontSize(type, 24)(view.state, view.dispatch)).toBe(true)
    expect(selectionFontSize(view.state, type)).toBe(24)
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="font-size: 24px">world</span>\n')

    expect(stepFontSize(type, 1)(view.state, view.dispatch)).toBe(true)
    expect(selectionFontSize(view.state, type)).toBe(25)
    expect(stepFontSize(type, -1)(view.state, view.dispatch)).toBe(true)
    expect(selectionFontSize(view.state, type)).toBe(24)

    // Setting 16 (DEFAULT_FONT_SIZE) or null removes the mark cleanly.
    expect(applyFontSize(type, DEFAULT_FONT_SIZE)(view.state, view.dispatch)).toBe(true)
    expect(selectionFontSize(view.state, type)).toBe(null)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')

    // Clamps to 8 and 96.
    expect(applyFontSize(type, 200)(view.state, view.dispatch)).toBe(true)
    expect(selectionFontSize(view.state, type)).toBe(96)
    expect(applyFontSize(type, 2)(view.state, view.dispatch)).toBe(true)
    expect(selectionFontSize(view.state, type)).toBe(8)

    // ⌘\ clears font_size.
    clearFormatting(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })

  it('Enter carries font_size to a new line when enterKeepsStyle is enabled (#8)', async () => {
    setEnterKeepsStyle(true, true)
    const { view } = await mountDoc('<span style="font-size: 24px">hello</span>\n')
    const end = 1 + view.state.doc.firstChild!.content.size
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    view.dispatch(view.state.tr.split(end))
    const carried = (view.state.storedMarks ?? []).map((m) => [m.type.name, m.attrs.size])
    expect(carried).toContainEqual(['font_size', 24])
  })

  it('page.fontSizeUp and page.fontSizeDown are unbound by default (protecting page.zoomOut on CmdOrCtrl+Shift+.) and work when bound', async () => {
    const up = PAGE_KEYS.find((r) => r.id === 'page.fontSizeUp')
    const down = PAGE_KEYS.find((r) => r.id === 'page.fontSizeDown')
    const zoomOut = PAGE_KEYS.find((r) => r.id === 'page.zoomOut')
    expect(up?.keys).toEqual([])
    expect(down?.keys).toEqual([])
    expect(zoomOut?.keys).toEqual(['CmdOrCtrl+Shift+.'])

    const { crepe, view } = await mountDoc('hello world\n', {
      'page.fontSizeUp': 'CmdOrCtrl+Alt+.',
      'page.fontSizeDown': 'CmdOrCtrl+Alt+,',
    })
    selectWord(view, 'world')
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: '.', metaKey: true, altKey: true, bubbles: true, cancelable: true }))
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="font-size: 17px">world</span>\n')
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true, altKey: true, bubbles: true, cancelable: true }))
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
  })
})

describe('[16 ▾] font size toolbar button and popover (YAZ-6695 D5)', () => {
  const panel = () => document.querySelector<HTMLElement>('body > .font-size-panel')

  it('shows live size, opens popover with −, numeric input, +, Default, and all presets, keeps selection intact, and undoes in 1 step', async () => {
    const { crepe, view } = await mountToolbar('hello world\n')
    await select(view, 'world')
    expect(must('font-size').querySelector('.toolbar-size__value')?.textContent).toBe('16')
    expect(must('font-size').classList.contains('active')).toBe(false)

    const before = view.state.selection
    await press('font-size')
    expect(panel()).not.toBeNull()
    expect(panel()!.hidden).toBe(false)
    expect(view.state.selection.eq(before)).toBe(true)

    const presets = [...panel()!.querySelectorAll<HTMLButtonElement>('.font-size-panel__preset')].map((b) => Number(b.dataset.size))
    expect(presets).toEqual([...FONT_SIZE_PRESETS])

    const clickBtn = async (selector: string) => {
      const btn = panel()!.querySelector<HTMLButtonElement>(selector)!
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      btn.dispatchEvent(down)
      expect(down.defaultPrevented).toBe(true)
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
      await settle()
    }

    // Click preset 24.
    await clickBtn('.font-size-panel__preset[data-size="24"]')
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="font-size: 24px">world</span>\n')
    expect(must('font-size').querySelector('.toolbar-size__value')?.textContent).toBe('24')
    expect(must('font-size').classList.contains('active')).toBe(true)
    expect(view.state.selection.eq(before)).toBe(true)

    // Step + and −.
    await clickBtn('button[aria-label="Increase text size"]')
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="font-size: 25px">world</span>\n')
    await clickBtn('button[aria-label="Decrease text size"]')
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="font-size: 24px">world</span>\n')

    // Editable numeric input + Enter.
    const input = panel()!.querySelector<HTMLInputElement>('.font-size-panel__input')!
    input.focus()
    input.value = '30'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await settle()
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="font-size: 30px">world</span>\n')
    expect(view.hasFocus()).toBe(true)

    // Single undo step reverts 30 → 24.
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="font-size: 24px">world</span>\n')

    // Default removes mark.
    await clickBtn('button[aria-label="Default text size"]')
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    expect(must('font-size').querySelector('.toolbar-size__value')?.textContent).toBe('16')
    expect(must('font-size').classList.contains('active')).toBe(false)

    // Escape closes popover.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(panel()!.hidden).toBe(true)
  })
})
