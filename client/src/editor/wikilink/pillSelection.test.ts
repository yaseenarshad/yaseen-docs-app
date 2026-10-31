/**
 * A selected link lights up as one box (YAZ-3747 demo, `pillSelection.ts`): a real editor (`createCrepe`). Pinned
 * here: an ID link's title widget and a name link's text piece get the class when the selection holds the link, lose
 * it when the selection leaves, and a selection that stops before a link leaves it unlit.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from '../createCrepe'
import type { MarkdownLinkNav } from '../markdownLink'
import { PILL_SELECTED_CLASS } from './pillSelection'
import { WIKILINK_CLASS, createWikilinkResolveSource } from './wikilinkPlugin'

const A = 'k3m9x2pq7abc'
const PATHS: Record<string, string> = { [A]: '/v/AR v2 plan.md', Named: '/v/Named.md' }

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
  return { root, view }
}

async function mountMarkdown(markdown: string, nav: Partial<MarkdownLinkNav>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, markdownLinkNav: { open: vi.fn(), copy: vi.fn(), onNotice: vi.fn(), ...nav } })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { root, view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

// The pieces the box shows: a hidden piece (`[[`, the ID) gets the class too, but has no `wikilink` class.
const lit = (root: HTMLElement) => Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}.${PILL_SELECTED_CLASS}`)).map((el) => el.textContent ?? '')
const select = (view: EditorView, anchor: number, head = anchor) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))

// 'pad [[k3m9x2pq7abc]] and [[Named]] tail': the ID link spans 5..21, the name link 26..35.
describe('a selected link is one lit box (YAZ-3747 demo)', () => {
  it('lights the ID link title when the selection holds the link, and unlights it when the selection leaves', async () => {
    const { root, view } = await mount(`pad [[${A}]] and [[Named]] tail\n`)
    expect(lit(root)).toEqual([])
    select(view, 5, 21)
    expect(lit(root)).toEqual(['AR v2 plan'])
    select(view, 3)
    expect(lit(root)).toEqual([])
  })

  it('lights every link a wider selection holds, the name link too', async () => {
    const { root, view } = await mount(`pad [[${A}]] and [[Named]] tail\n`)
    select(view, 1, 38)
    expect(lit(root)).toEqual(['AR v2 plan', 'Named'])
  })

  it('leaves a link unlit when the selection stops at its edge', async () => {
    const { root, view } = await mount(`pad [[${A}]] and [[Named]] tail\n`)
    select(view, 21, 26) // " and ": between the two links
    expect(lit(root)).toEqual([])
    select(view, 1, 5) // "pad ": up to the ID link
    expect(lit(root)).toEqual([])
  })

  it('lights the links of a Select all', async () => {
    const { root, view } = await mount(`pad [[${A}]]\n\nmore [[Named]]\n`)
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
    expect(lit(root)).toEqual(['AR v2 plan', 'Named'])
  })

  it('lights every piece of a Markdown link pill, its vault name too', async () => {
    const vaultPath = (href: string) => (href.startsWith('../') ? `/v/${href.slice(3)}` : null)
    const vaultTag = (path: string) => (path.startsWith('/v/other/') ? 'Other Vault' : null)
    const icon = () => ({ class: 'probe-icon' })
    const { root, view } = await mountMarkdown('[Plan **bold** end](../other/plan.md)\n', { vaultPath, vaultTag, icon })
    select(view, 1, 14)
    expect(lit(root)).toEqual(['Plan ', 'bold', ' end', ' (Other Vault)'])
    select(view, 14)
    expect(lit(root)).toEqual([])
  })
})

describe('the lit box is as tall as the line (YAZ-3747 demo)', () => {
  it('measures a lit pill\'s letters once, as a part of the font size, on the editor\'s root', async () => {
    const { root, view } = await mount(`pad [[Named]] tail\n`)
    const host = view.dom.parentElement!
    // jsdom draws nothing: a pill's letters 19px high at 16px.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 19, width: 40, top: 0, left: 0, right: 40, bottom: 19, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    const style = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ fontSize: '16px', paddingTop: '0px', paddingBottom: '0px' } as CSSStyleDeclaration)
    select(view, 1, 18)
    expect(lit(root)).toEqual(['Named'])
    expect(host.style.getPropertyValue('--pill-letters')).toBe('1.1875')
    const reads = rect.mock.calls.length
    select(view, 1)
    select(view, 1, 18)
    expect(rect.mock.calls.length).toBe(reads) // once per editor
    rect.mockRestore()
    style.mockRestore()
  })
})
