/**
 * Unified text colour mark (`marks/textColor.ts`, YAZ-6694 D2) + shared Text Colour `A̲▾` panel (`colourPanel.ts`, YAZ-6695 D4/D6).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { setEnterKeepsStyle } from '../enterKeepsStyle'
import { clearFormatting } from './clearFormatting'
import {
  applyTextColor,
  removeTextColor,
  selectionTextColor,
  TEXT_COLORS,
  textColorsIn,
  textColorSchema,
} from './textColor'
import { fontSizeSchema } from './fontSize'
import { mount as mountToolbar, must, press, select, settle, unmountAll } from '../toolbarTestKit'

const mounted: Array<{ crepe: ReturnType<typeof createCrepe>; root: HTMLElement }> = []

async function mountDoc(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
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

describe('text_color mark round-trip and commands (YAZ-6694 D2)', () => {
  it('round-trips named text colours as <span class="text-color-<name>"> and custom hex as <span style="color: #rrggbb">', async () => {
    const src = 'a <span class="text-color-red">ruby</span> <span class="text-color-teal">lagoon</span> <span style="color: #e03131">custom</span> b\n'
    const { crepe, root } = await mountDoc(src)
    expect(getMarkdownForSave(crepe)).toBe(src)
    const spans = [...root.querySelectorAll<HTMLElement>('.ProseMirror span[data-text-color]')]
    expect(spans.map((s) => [s.textContent, s.getAttribute('data-text-color'), s.className, s.style.color])).toEqual([
      ['ruby', 'red', 'text-color-red', ''],
      ['lagoon', 'teal', 'text-color-teal', ''],
      ['custom', '#e03131', '', 'rgb(224, 49, 49)'],
    ])
  })

  it('round-trips nested text_color and font_size <span> marks in both nesting orders via tag-aware htmlPairs', async () => {
    const a = 'x <span style="color: #e03131"><span style="font-size: 24px">big red</span></span> y\n'
    const b = 'x <span style="font-size: 24px"><span class="text-color-blue">big blue</span></span> y\n'
    for (const src of [a, b]) {
      const { crepe, view } = await mountDoc(src)
      const colorType = textColorSchema.type(crepe.editor.ctx)
      const sizeType = fontSizeSchema.type(crepe.editor.ctx)
      selectWord(view, 'big')
      expect(selectionTextColor(view.state, colorType)).toBe(src === a ? '#e03131' : 'blue')
      expect(view.state.doc.rangeHasMark(view.state.selection.from, view.state.selection.to, sizeType)).toBe(true)
      const saved = getMarkdownForSave(crepe)
      expect(saved).toContain('font-size: 24px')
      expect(saved).toContain(src === a ? 'color: #e03131' : 'text-color-blue')
      // Reloading the saved markdown keeps both marks intact.
      const reloaded = await mountDoc(saved)
      selectWord(reloaded.view, 'big')
      expect(selectionTextColor(reloaded.view.state, textColorSchema.type(reloaded.crepe.editor.ctx))).toBe(src === a ? '#e03131' : 'blue')
      expect(reloaded.view.state.doc.rangeHasMark(reloaded.view.state.selection.from, reloaded.view.state.selection.to, fontSizeSchema.type(reloaded.crepe.editor.ctx))).toBe(true)
    }
  })

  it('works inside table cells, headings, lists, and bold', async () => {
    const src =
      '# <span class="text-color-purple">Heading</span>\n\n' +
      '* **<span style="color: #1971c2">bold blue</span>**\n\n' +
      '| Col                                        |\n' +
      '| ------------------------------------------ |\n' +
      '| <span class="text-color-green">cell</span> |\n'
    const { crepe } = await mountDoc(src)
    expect(getMarkdownForSave(crepe)).toBe(src)
  })

  it('applyTextColor, removeTextColor, textColorsIn, selectionTextColor, and clearFormatting work cleanly', async () => {
    const { crepe, view } = await mountDoc('one two three\n')
    const type = textColorSchema.type(crepe.editor.ctx)
    selectWord(view, 'one')
    expect(selectionTextColor(view.state, type)).toBe(null)
    expect(removeTextColor(type)(view.state, view.dispatch)).toBe(false)
    expect(applyTextColor(type, 'red')(view.state, view.dispatch)).toBe(true)
    expect(selectionTextColor(view.state, type)).toBe('red')
    expect(getMarkdownForSave(crepe)).toBe('<span class="text-color-red">one</span> two three\n')

    selectWord(view, 'two')
    expect(applyTextColor(type, '#123456')(view.state, view.dispatch)).toBe(true)
    // Select across 'one two': mixed.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8)))
    expect(selectionTextColor(view.state, type)).toBe(undefined)
    expect(new Set(textColorsIn(view.state, type))).toEqual(new Set(['red', '#123456']))

    // ⌘\ clears text_color too.
    clearFormatting(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe('one two three\n')
    expect(TEXT_COLORS).toHaveLength(10)
  })

  it('unrecognized <span> styles stay literal HTML', async () => {
    const src = '<span style="color: red">named</span> <span style="color: #FFF">short</span>\n'
    const { crepe } = await mountDoc(src)
    expect(getMarkdownForSave(crepe)).toBe(src)
  })
})

describe('Text colour toolbar button A̲▾ and shared ColourPanel (YAZ-6695 D4, D6)', () => {
  const panel = () => document.querySelector<HTMLElement>('body > .highlight-panel[data-panel="text-color"]')

  it('opens shared ColourPanel under text-color button, applies named & custom colours with 1 undo step, and updates the toolbar colour bar', async () => {
    const { crepe, view } = await mountToolbar('hello world\n')
    await select(view, 'world')
    const before = view.state.selection
    await press('text-color')
    expect(panel()).not.toBeNull()
    expect(panel()!.hidden).toBe(false)
    expect(view.state.selection.eq(before)).toBe(true)

    const clickSwatch = async (label: string) => {
      const btn = panel()!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      btn.dispatchEvent(down)
      expect(down.defaultPrevented).toBe(true)
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
      await settle()
    }

    await clickSwatch('Red')
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="color: #ff0000">world</span>\n')
    expect(must('text-color').classList.contains('active')).toBe(true)
    expect(document.querySelector<HTMLElement>('.milkdown-toolbar')!.style.getPropertyValue('--text-color-colour')).toBe('#ff0000')

    await clickSwatch('Blue')
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="color: #0000ff">world</span>\n')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello <span style="color: #ff0000">world</span>\n')

    await clickSwatch('Default colour')
    expect(getMarkdownForSave(crepe)).toBe('hello world\n')
    expect(must('text-color').classList.contains('active')).toBe(false)

    // Opening Highlight panel closes Text colour panel (mutual exclusion).
    await press('highlight-more')
    expect(panel()!.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('body > .highlight-panel[data-panel="highlight"]')!.hidden).toBe(false)
  })
})
