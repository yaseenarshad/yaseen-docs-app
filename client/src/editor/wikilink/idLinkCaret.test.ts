/**
 * An ID link is one unit (YAZ-3744 D1, `idLinkCaret.ts`): a real editor (`createCrepe`) with an ID link that shows
 * its title. Pinned here: the caret steps over it (arrows, a click, Shift), Backspace and Delete remove it whole and
 * ⌘Z puts it back, two side by side are two units (S19), a composition is left alone (S18), "Edit link" is the one way
 * inside, and a name link keeps the reveal rule.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { OPEN_ID_LINK } from './idLinkCaret'
import { WIKILINK_CLASS, createWikilinkResolveSource } from './wikilinkPlugin'

const A = 'k3m9x2pq7abc'
const B = 'p7q2m4x9kzzz'
const PATHS: Record<string, string> = { [A]: '/v/AR v2 plan.md', [B]: '/v/Budget.md', Named: '/v/Named.md' }

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const source = createWikilinkResolveSource()
  source.update((target) => PATHS[target] ?? null)
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks: source })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { crepe, root, view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const links = (root: HTMLElement) => Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).map((el) => el.textContent ?? '')
const select = (view: EditorView, anchor: number, head = anchor) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
const key = (view: EditorView, name: string) => view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key: name })))

// 'pad [[k3m9x2pq7abc]] tail': the link spans 5..21 (paragraph content starts at 1).
const FROM = 5
const TO = 21

describe('the caret steps over an ID link (YAZ-3744 D1)', () => {
  it('an arrow from either edge lands on the other edge; the title stays', async () => {
    const { root, view } = await mount(`pad [[${A}]] tail\n`)
    select(view, TO)
    select(view, TO - 1) // what ArrowLeft asks for
    expect(view.state.selection.head).toBe(FROM)
    select(view, FROM + 1) // ArrowRight
    expect(view.state.selection.head).toBe(TO)
    expect(links(root)).toEqual(['AR v2 plan'])
  })

  it('a click inside it lands on the nearer edge', async () => {
    const { view } = await mount(`pad [[${A}]] tail\n`)
    select(view, 1)
    select(view, FROM + 3)
    expect(view.state.selection.head).toBe(FROM)
    select(view, 1)
    select(view, TO - 2)
    expect(view.state.selection.head).toBe(TO)
  })

  it('Shift moves the head over the whole link and keeps the anchor', async () => {
    const { view } = await mount(`pad [[${A}]] tail\n`)
    select(view, 2, TO)
    select(view, 2, TO - 1)
    expect(view.state.selection.anchor).toBe(2)
    expect(view.state.selection.head).toBe(FROM)
  })

  it('Backspace right after it and Delete right before it remove it whole; ⌘Z puts it back', async () => {
    const md = `pad [[${A}]] tail\n`
    const { crepe, view } = await mount(md)
    select(view, TO)
    expect(key(view, 'Backspace')).toBe(true)
    expect(view.state.doc.textContent).toBe('pad  tail')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe(md)
    select(view, FROM)
    expect(key(view, 'Delete')).toBe(true)
    expect(view.state.doc.textContent).toBe('pad  tail')
  })

  it('S19: two ID links side by side are two units', async () => {
    // 'x [[A]][[B]]': A spans 3..19, B 19..35.
    const { view } = await mount(`x [[${A}]][[${B}]]\n`)
    select(view, 19)
    select(view, 20)
    expect(view.state.selection.head).toBe(35)
    select(view, 19)
    select(view, 18)
    expect(view.state.selection.head).toBe(3)
    select(view, 35)
    key(view, 'Backspace')
    expect(view.state.doc.textContent).toBe(`x [[${A}]]`)
  })

  it('S18: a selection change inside a composition is left alone', async () => {
    const { view } = await mount(`pad [[${A}]] tail\n`)
    select(view, TO)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, TO - 1)).setMeta('composition', 1))
    expect(view.state.selection.head).toBe(TO - 1)
  })

  it('"Edit link" is the one way inside; the caret then moves freely until it leaves', async () => {
    const { root, view } = await mount(`pad [[${A}]] tail\n`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, FROM + 2)).setMeta(OPEN_ID_LINK, true))
    expect(links(root)).toEqual([])
    select(view, FROM + 4)
    expect(view.state.selection.head).toBe(FROM + 4)
    select(view, TO + 2)
    expect(links(root)).toEqual(['AR v2 plan'])
  })

  it('a name link keeps the reveal rule: a caret at its edge shows the raw [[Named]]', async () => {
    const { root, view } = await mount('pad [[Named]] tail\n')
    select(view, 14)
    expect(links(root)).toEqual([])
    expect(view.dom.textContent).toContain('[[Named]]')
  })

  it('the flow: an ID link ends a bullet; a click after it, the arrows, Backspace and ⌘Z', async () => {
    const { root, view } = await mount(`- Ask about [[${A}]]\n`)
    const end = view.state.doc.resolve(view.state.doc.content.size - 3).end() // the end of the bullet's text
    select(view, end) // a click at the end of the line
    expect(links(root)).toEqual(['AR v2 plan'])
    select(view, end - 1) // ArrowLeft
    const from = view.state.selection.head
    expect(view.state.doc.textBetween(from, end)).toBe(`[[${A}]]`)
    select(view, from + 1) // ArrowRight
    expect(view.state.selection.head).toBe(end)
    key(view, 'Backspace')
    expect(view.state.doc.textContent).toBe('Ask about ')
    undo(view.state, view.dispatch)
    expect(view.state.doc.textContent).toBe(`Ask about [[${A}]]`)
    expect(links(root)).toEqual(['AR v2 plan'])
  })
})
