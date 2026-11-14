/**
 * A page with 50 cards (YAZ-4961, idea 25). A card draws its own render and makes NO CodeMirror until "Edit
 * card"; a code block makes one (with its Vue app) as soon as it comes into view. The comparison in the log is the same
 * page with each card a ```` ```markdown ```` block, every block in view: what Crepe's preview would cost, since its
 * preview is part of the block's CodeMirror app. A keystroke in a paragraph of the page must not draw a card again.
 * Runs in the `perf` project; each budget holds the median (`test-perf.ts`).
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { afterEach, describe, expect, it } from 'vitest'
import { budgetMs, median } from '../../test-perf'
import { createCrepe, cardLook } from '../createCrepe'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { renderCard } from './cardRender'
import { cardBlockViewAt, cardEditorKind } from './cardBlockView'

const CARD = (i: number) => `\`\`\`card\nWhat is the capital of {{Country ${i}}}? See [[Atlas]] and **the map**.\n---\nCity ${i}, on the river.\n\`\`\`\n<!-- card: WIKI-${100 + i}, 2026-11-01T09:00Z good, 2026-11-05T09:00Z good -->\n`
const page = (block: (i: number) => string) => `# Cards\n\n${Array.from({ length: 50 }, (_, i) => `Paragraph ${i} before the card.\n\n${block(i)}`).join('\n')}\nThe end.\n`
const CARDS = page(CARD)
const CODE = page((i) => CARD(i).replace('```card', '```markdown').replace(/<!--.*-->\n/, ''))

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  while (mounted.length > 0) {
    const m = mounted.pop()!
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Every observed block is in view at once: the worst page for a code block's lazy CodeMirror. */
class AllInView {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

async function mountTimed(markdown: string, wikilinks?: ReturnType<typeof createWikilinkResolveSource>): Promise<{ ms: number; crepe: Crepe }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const start = performance.now()
  const crepe = createCrepe({ root, defaultValue: markdown, image: { root: '/v', pagePath: '/v/Cards.md' }, ...(wikilinks !== undefined && { wikilinks }) })
  await crepe.create()
  const ms = performance.now() - start
  mounted.push({ crepe, root })
  return { ms, crepe }
}

describe('a page with 50 cards (idea 25)', () => {
  it('perf smoke: opens with no CodeMirror in any card, in under 400 ms; a keystroke in a paragraph draws no card again (under 4 ms)', async () => {
    const saved = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = AllInView as unknown as typeof IntersectionObserver
    try {
      const cards: number[] = []
      const code: number[] = []
      // Warm-up, then 5 of each, one after the other.
      await mountTimed(CARDS)
      await mountTimed(CODE)
      for (let i = 0; i < 5; i++) {
        cards.push((await mountTimed(CARDS)).ms)
        code.push((await mountTimed(CODE)).ms)
      }
      const { crepe } = await mountTimed(CARDS)
      const view = crepe.editor.ctx.get(editorViewCtx)
      expect(view.dom.querySelectorAll('.card')).toHaveLength(50)
      expect(view.dom.querySelectorAll('.card .cm-editor')).toHaveLength(0)
      // A keystroke at the end of the first paragraph: no card's body is drawn again.
      const bodies = [...view.dom.querySelectorAll('.card__sides')]
      const at = view.state.doc.child(1).nodeSize + view.state.doc.child(0).nodeSize - 1
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)))
      const keys: number[] = []
      for (let i = 0; i < 60; i++) {
        const start = performance.now()
        view.dispatch(view.state.tr.insertText('x'))
        if (i >= 10) keys.push(performance.now() - start)
      }
      expect([...view.dom.querySelectorAll('.card__sides')]).toEqual(bodies)
      console.log(
        `cards perf: open a page of 50 cards: median ${median(cards).toFixed(1)} ms (no CodeMirror); the same page as 50 code blocks, all in view: median ${median(code).toFixed(1)} ms (50 CodeMirrors); a keystroke in a paragraph: median ${median(keys).toFixed(2)} ms`,
      )
      expect(median(cards)).toBeLessThan(budgetMs(400))
      expect(median(keys)).toBeLessThan(budgetMs(4))
    } finally {
      globalThis.IntersectionObserver = saved
    }
  }, 120_000)

  it('perf smoke: an index change (any save in the vault) redraws only the pills of the 50 cards, not their Markdown (audit 1)', async () => {
    const source = createWikilinkResolveSource()
    source.update((t) => (t === 'Atlas' ? '/v/Atlas.md' : null), [], [], true, ['WIKI'])
    const { crepe } = await mountTimed(CARDS, source)
    const view = crepe.editor.ctx.get(editorViewCtx)
    const sides = [...view.dom.querySelectorAll('.card__sides')]
    expect(sides).toHaveLength(50)
    const changes: number[] = []
    for (let i = 0; i < 25; i++) {
      const start = performance.now()
      source.update((t) => (t === 'Atlas' && i % 2 === 0 ? '/v/Atlas.md' : null), [], [], true, ['WIKI'])
      if (i >= 5) changes.push(performance.now() - start)
    }
    // The sides are the same elements: no render ran; the pill follows the index.
    source.update(() => null, [], [], true, ['WIKI'])
    expect([...view.dom.querySelectorAll('.card__sides')]).toEqual(sides)
    expect(view.dom.querySelector('[data-card-link]')?.classList.contains('wikilink--unresolved')).toBe(true)
    // What it cost before (each card rendered again: marked + DOMPurify), for the log.
    const look = cardLook(source, undefined)
    const text = CARD(0).split('\n').slice(1, 4).join('\n')
    const full: number[] = []
    for (let i = 0; i < 10; i++) {
      const start = performance.now()
      for (let c = 0; c < 50; c++) renderCard(text, {}, look)
      full.push(performance.now() - start)
    }
    console.log(`cards perf: an index change with 50 link cards: median ${median(changes).toFixed(2)} ms (pills only); a full render of the 50: median ${median(full).toFixed(2)} ms (before)`)
    expect(median(changes)).toBeLessThan(budgetMs(15))
  }, 120_000)

  it('perf smoke: Edit card (YAZ-5026, the page`s editor in the card) shows the card`s text in under 150 ms on a page of 50 cards; one inner editor at a time', async () => {
    expect(cardEditorKind()).toBe('page')
    const source = createWikilinkResolveSource()
    source.update((t) => (t === 'Atlas' ? '/v/Atlas.md' : null), [], [], true, ['WIKI'])
    const { crepe } = await mountTimed(CARDS, source)
    const view = crepe.editor.ctx.get(editorViewCtx)
    const cards: number[] = []
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'code_block' && node.attrs.language === 'card') cards.push(pos)
      return !node.isTextblock
    })
    expect(cards).toHaveLength(50)
    const opens: number[] = []
    // A warm-up, then ten cards across the page, one after the other.
    for (const i of [0, 1, 5, 10, 15, 20, 25, 30, 35, 40, 49]) {
      const card = cardBlockViewAt(view, cards[i])!
      const start = performance.now()
      card.edit()
      await card.cardEditor!.ready
      const ms = performance.now() - start
      expect(card.cardEditor!.view()!.dom.textContent).toContain(`City ${i}`)
      if (i !== 0) opens.push(ms)
      expect(view.dom.querySelectorAll('.card__editor')).toHaveLength(1)
      card.done()
    }
    console.log(`cards perf: Edit card with the page's editor on a page of 50 cards: median ${median(opens).toFixed(1)} ms`)
    expect(median(opens)).toBeLessThan(budgetMs(150))
  }, 120_000)
})
