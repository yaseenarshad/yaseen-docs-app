/**
 * ⌘F inside cards (YAZ-5378 part 1), against a real page (`createCrepe`): the page's one find matches the text a card
 * in the page SHOWS — its title band and its sides, hidden words too — and the text of a card embed (`![[ID]]`); it
 * counts them in page order with the page's own text, steps through them, paints them, and the raw Markdown of a card
 * (`{{`, `---`, `**`) matches nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { IndexRecord } from '@shared/types'
import { createCrepe, type CreateCrepeOptions } from '../createCrepe'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { loadCardEmbed } from '../card/embedCard'
import { setCardEditorKind } from '../card/cardBlockView'
import { createFindChannel } from './findChannel'
import { cardMatches, paintedFindRanges } from './cardFind'
import { FIND_MATCH_CLASS } from './findInPage'

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('../../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api')>()
  return {
    ...real,
    api: {
      ...real.api,
      readFile: async (path: string) => {
        const content = files.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', `no ${path}`)
        return { path, content, mtime: 1 }
      },
    },
  }
})

const CARD_FILE = '/v/cards/capital-wiki-140.md'
files.set(CARD_FILE, '---\nkind: card\n---\n```card\nThe capital of **Peru** is {{Lima}}\n---\nLima sits on the coast\n```\n<!-- card: WIKI-140, title "Capital of Peru" -->\n')

const rec = (path: string, over: Partial<IndexRecord>): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), title: name, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
}

function vault() {
  const source = createWikilinkResolveSource()
  const list = [rec(CARD_FILE, { kind: 'card', cards: [{ id: 'WIKI-140', off: false, next: false, reviews: [], title: 'Capital of Peru' }] })]
  source.update((t) => (t.toLowerCase() === 'wiki-140' ? CARD_FILE : null), list, [], true, ['WIKI'])
  return source
}

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  setCardEditorKind('page')
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

async function mountFind(markdown: string, extra: Partial<CreateCrepeOptions> = {}): Promise<{ view: EditorView; root: HTMLElement; channel: ReturnType<typeof createFindChannel> }> {
  const channel = createFindChannel()
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, find: channel, wikilinks: vault(), cards: { path: '/v/Page.md' }, image: { root: '/v', pagePath: '/v/Page.md' }, ...extra })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.hasFocus = () => true
  return { view, root, channel }
}

const PAGE = [
  'A sentence about Lima before the card.',
  '',
  '```card',
  'What is the capital of {{Peru}}? **Lima**',
  '---',
  'Lima, by the sea',
  '```',
  '<!-- card: WIKI-7, title "Lima quiz" -->',
  '',
  'After the card, Lima again.',
  '',
].join('\n')

describe('⌘F finds the text a card in the page shows (YAZ-5378 part 1)', () => {
  it('counts the title band and both sides with the page text, in page order, and steps through them', async () => {
    const { channel } = await mountFind(PAGE)
    channel.open()
    channel.setQuery('lima')
    // Page text 1, the title "Lima quiz", side 1 "**Lima**", side 2 "Lima, by the sea", page text 2.
    expect(channel.getState().total).toBe(5)
    const painted = paintedFindRanges()
    expect(painted.map((p) => p.text.toLowerCase())).toEqual(['lima', 'lima', 'lima'])
    // The first active match is the first in the page (the caret is at the start): page text, a decoration.
    expect(channel.getState().activeIndex).toBe(0)
    channel.next()
    expect(channel.getState().activeIndex).toBe(1)
    // The active one is now the title's.
    expect(paintedFindRanges().find((p) => p.active)?.text).toBe('Lima')
    channel.next()
    channel.next()
    channel.next()
    expect(channel.getState().activeIndex).toBe(4)
    expect(paintedFindRanges().some((p) => p.active)).toBe(false)
  })

  it('the card\'s Markdown is not its text: `**`, `{{`, `---` and the card line match nothing; a hidden word does', async () => {
    const { channel } = await mountFind(PAGE)
    channel.open()
    for (const raw of ['**', '{{', '---', 'card:', 'WIKI-7']) {
      channel.setQuery(raw)
      expect([raw, channel.getState().total]).toEqual([raw, 0])
    }
    channel.setQuery('peru')
    expect(channel.getState().total).toBe(1)
    // A match crosses marks, as in the page: "capital of Peru" spans the text and the hidden word.
    channel.setQuery('capital of peru')
    expect(channel.getState().total).toBe(1)
  })

  it('closing on a card match selects the card and clears the paint', async () => {
    const { view, channel } = await mountFind(PAGE)
    channel.open()
    channel.setQuery('by the sea')
    expect(channel.getState().total).toBe(1)
    channel.close()
    expect(paintedFindRanges()).toEqual([])
    expect(view.state.selection).toBeInstanceOf(NodeSelection)
    expect((view.state.selection as NodeSelection).node.attrs.language).toBe('card')
  })

  it('an edit to the card counts again', async () => {
    const { view, channel } = await mountFind(PAGE)
    channel.open()
    channel.setQuery('coast')
    expect(channel.getState().total).toBe(0)
    let at = -1
    view.state.doc.descendants((node, pos) => {
      if (at === -1 && node.attrs.language === 'card') at = pos
      return at === -1
    })
    const card = view.state.doc.nodeAt(at)!
    view.dispatch(view.state.tr.insertText(' on the coast', at + card.nodeSize - 1))
    await vi.waitFor(() => expect(channel.getState().total).toBe(1))
  })

  it('a code block keeps its own find: the page still paints its matches as decorations', async () => {
    const { root, channel } = await mountFind('Lima\n')
    channel.open()
    channel.setQuery('lima')
    expect(channel.getState().total).toBe(1)
    expect(root.querySelectorAll(`.${FIND_MATCH_CLASS}`).length).toBe(1)
  })
})

describe('⌘F finds the text of a card embed (YAZ-5378 part 1)', () => {
  it('`![[WIKI-140]]`: its sides count, after the text before it; its raw `**` does not', async () => {
    const { channel } = await mountFind('Lima first.\n\n![[WIKI-140]]\n', { boardEmbeds: { root: '/v' } })
    await loadCardEmbed()
    channel.open()
    channel.setQuery('lima')
    // The box reads its card when find asks (it may be far from the screen); the count follows.
    await vi.waitFor(() => expect(channel.getState().total).toBe(3))
    channel.setQuery('**')
    expect(channel.getState().total).toBe(0)
    channel.setQuery('capital of peru')
    expect(channel.getState().total).toBe(1)
  })
})

describe('cardMatches', () => {
  it('matches within a block, never across two; skips buttons', () => {
    const el = document.createElement('div')
    el.className = 'card'
    el.innerHTML = '<div class="card__body"><p>one <b>tw</b>o</p><p>two</p><button>two</button></div>'
    expect(cardMatches(el, 'two').map((r) => r.toString())).toEqual(['two', 'two'])
    expect(cardMatches(el, 'twotwo')).toHaveLength(0)
  })
})
