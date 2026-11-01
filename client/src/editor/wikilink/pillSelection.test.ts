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
import css from './wikilink.css?raw'

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

// jsdom draws no `::selection`: the rules are read from the CSS, and each selector is matched against a piece.

/** Each selector of a rule that takes the browser's selection colour away, without its `::selection`. */
function hiddenSelectionSelectors(): string[] {
  const out: string[] = []
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/background:\s*transparent/.test(rule[2]!)) continue
    for (const selector of rule[1]!.split(',').map((s) => s.trim())) if (selector.includes('::selection')) out.push(selector.replace(/::selection/g, ''))
  }
  return out
}

describe('a selection with no lit link costs no search of the note (YAZ-4005)', () => {
  it('in a note with no link, or a selection beside one, nothing searches the note for a lit pill', async () => {
    const { view } = await mount(`plain words here\n\nmore plain words [[Named]] end\n`)
    const search = vi.spyOn(view.dom, 'querySelector')
    select(view, 1, 6)
    select(view, 1, 12)
    select(view, 19, 24) // "more ": beside the link, not over it
    expect(search).not.toHaveBeenCalled()
    search.mockRestore()
  })
})

describe('the browser\'s selection colour (YAZ-4004)', () => {
  function pieceIn(classes: string): HTMLElement {
    const host = document.createElement('div')
    host.className = 'milkdown'
    host.innerHTML = `<div class="ProseMirror"><span class="${classes}">AR v2 plan</span></div>`
    return host.querySelector('span')!
  }
  const hides = (el: HTMLElement) => hiddenSelectionSelectors().some((selector) => el.matches(selector))

  it('a Markdown link pill keeps it on a part selection, and loses it only while its whole box is lit', () => {
    expect(hiddenSelectionSelectors().length).toBeGreaterThan(0)
    expect(hides(pieceIn('wikilink link-pill link-pill--first link-pill--last'))).toBe(false)
    expect(hides(pieceIn(`wikilink link-pill ${PILL_SELECTED_CLASS}`))).toBe(true)
  })

  it('a [[link]] (one unit) never shows it: only the lit box does', () => {
    expect(hides(pieceIn('wikilink'))).toBe(true)
    expect(hides(pieceIn(`wikilink ${PILL_SELECTED_CLASS}`))).toBe(true)
  })
})
