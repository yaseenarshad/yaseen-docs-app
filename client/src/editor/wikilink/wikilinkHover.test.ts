/**
 * Hover on wiki links (YAZ-3403 D8): real editor (`createCrepe({ wikilinkHover })`), real mouseover / mouseout on the
 * rendered `.wikilink` spans. A resolved link tells the host its page and its box; an unresolved one says nothing; an
 * editor made without the option — a read-only preview's — has no hover plugin, so a preview never opens a preview.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe } from '../createCrepe'
import { WIKILINK_CLASS, WIKILINK_UNRESOLVED_CLASS, createWikilinkResolveSource } from './wikilinkPlugin'
import type { WikilinkHover } from './wikilinkHover'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, hover?: WikilinkHover, ids = false) {
  const source = createWikilinkResolveSource()
  source.update((target) => (target === 'Known' ? '/vault/Known.md' : null), [], [], ids, ids ? ['WIKI'] : [])
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks: source, wikilinkHover: hover })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

const span = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).find((el) => el.textContent === text)!
const over = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
const out = (el: Element, to: Element | null) => el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }))

beforeEach(() => {
  // Milkdown's clock promises keep 3 s timeout callbacks: run them inside this jsdom's life (as wikilinkClick.test.ts).
  vi.useFakeTimers()
})

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('wikilink hover (YAZ-3403 D8)', () => {
  it('S24, S25: the pointer on a resolved link tells the host its page and its box, and leaving tells it once; an unresolved link says nothing', async () => {
    const hover = { onHover: vi.fn(), onLeave: vi.fn() }
    const { root } = await mount('pad [[Known]] and [[Missing]] tail\n', hover)
    const known = span(root, 'Known')
    over(known)
    expect(hover.onHover).toHaveBeenCalledExactlyOnceWith('/vault/Known.md', expect.objectContaining({ left: expect.any(Number), bottom: expect.any(Number) }), true) // an editable page (the card's open line, YAZ-3935)
    over(known) // a move inside the same link is no new hover
    expect(hover.onHover).toHaveBeenCalledTimes(1)
    out(known, root)
    expect(hover.onLeave).toHaveBeenCalledTimes(1)

    const missing = span(root, 'Missing')
    expect(missing.classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    over(missing)
    out(missing, root)
    expect(hover.onHover).toHaveBeenCalledTimes(1)
    expect(hover.onLeave).toHaveBeenCalledTimes(1)
  })

  it('an editor made without `wikilinkHover` (a read-only preview) registers no hover plugin', async () => {
    const plugins = (crepe: Crepe) => crepe.editor.action((ctx) => ctx.get(editorViewCtx)).state.plugins.map((plugin) => (plugin as unknown as { key: string }).key)
    const without = await mount('pad [[Known]]\n')
    const withIt = await mount('pad [[Known]]\n', { onHover: vi.fn(), onLeave: vi.fn() })
    expect(plugins(withIt.crepe).some((key) => key.startsWith('mdapp-wikilink-hover'))).toBe(true)
    expect(plugins(without.crepe).some((key) => key.startsWith('mdapp-wikilink-hover'))).toBe(false)
  })

  it('YAZ-6051: resolves [data-card-link] pills inside inline/embedded cards and measures child union rect when wrapper is display: contents (0x0)', async () => {
    const hover = { onHover: vi.fn(), onLeave: vi.fn() }
    const { root } = await mount('pad\n', hover)
    const pm = root.querySelector('.ProseMirror')!
    const group = document.createElement('span')
    group.className = 'wikilink-group'
    group.dataset.cardLink = 'Known'
    const name = document.createElement('span')
    name.className = WIKILINK_CLASS
    name.textContent = 'Known'
    const tail = document.createElement('span')
    tail.className = `${WIKILINK_CLASS} link-pill__tail`
    tail.textContent = '(12)'
    group.append(name, tail)
    pm.append(group)

    vi.spyOn(group, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(name, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 200, right: 150, bottom: 220, width: 50, height: 20, x: 100, y: 200, toJSON: () => ({}) } as DOMRect)
    vi.spyOn(tail, 'getBoundingClientRect').mockReturnValue({ left: 150, top: 200, right: 180, bottom: 220, width: 30, height: 20, x: 150, y: 200, toJSON: () => ({}) } as DOMRect)

    over(name)
    expect(hover.onHover).toHaveBeenCalledExactlyOnceWith('/vault/Known.md', { left: 100, top: 200, right: 180, bottom: 220 }, false)
    out(name, root)
    expect(hover.onLeave).toHaveBeenCalledOnce()
  })

  describe('YAZ-6051: links inside cards (listeners on view.dom, not handleDOMEvents)', () => {
    const CARD_PAGE = 'pad\n\n```card\nSee [[Known]] here\n---\nback\n```\n<!-- card: WIKI-1 -->\n'
    const add = (parent: Element, html: string) => {
      const host = document.createElement('div')
      host.innerHTML = html
      const node = host.firstElementChild!
      parent.append(node)
      return node
    }

    it('an inline card (cardBlockView, stopEvent: () => true) still reports a hover on its [data-card-link] pill, and leaving tells once', async () => {
      const hover = { onHover: vi.fn(), onLeave: vi.fn() }
      const { root } = await mount(CARD_PAGE, hover, true) // a vault with IDs: a ```card block draws as a card
      // The real node view (stopEvent: () => true) swallows the event for ProseMirror: handleDOMEvents would never hear it.
      const card = root.querySelector('.card')
      expect(card).not.toBeNull()
      const pill = card!.querySelector('[data-card-link]')
      expect(pill).not.toBeNull()
      over(pill!)
      expect(hover.onHover).toHaveBeenCalledExactlyOnceWith('/vault/Known.md', expect.objectContaining({ left: expect.any(Number) }), false)
      out(pill!, root)
      expect(hover.onLeave).toHaveBeenCalledOnce()
    })

    it('an embedded card (.card.card-embed) previews a [data-card-link] pill and a Markdown link through markdownPath', async () => {
      const hover = { onHover: vi.fn(), onLeave: vi.fn(), markdownPath: (href: string) => (href === 'known.md' ? '/vault/Known.md' : null) }
      const { root } = await mount('pad\n', hover)
      const embed = add(root.querySelector('.ProseMirror')!, '<div class="card card-embed"><div class="card__sides"><span data-card-link="Known"><span class="wikilink">Known</span></span><a href="known.md">md</a><a href="other.md">other</a></div></div>')
      over(embed.querySelector('.wikilink')!)
      expect(hover.onHover).toHaveBeenCalledExactlyOnceWith('/vault/Known.md', expect.anything(), false)
      out(embed.querySelector('.wikilink')!, root)
      expect(hover.onLeave).toHaveBeenCalledOnce()
      over(embed.querySelector('a[href="known.md"]')!)
      expect(hover.onHover).toHaveBeenCalledTimes(2)
      out(embed.querySelector('a[href="known.md"]')!, root)
      over(embed.querySelector('a[href="other.md"]')!) // a link that opens no page says nothing
      expect(hover.onHover).toHaveBeenCalledTimes(2)
    })

    it('an unresolved card pill says nothing', async () => {
      const hover = { onHover: vi.fn(), onLeave: vi.fn() }
      const { root } = await mount('pad\n', hover)
      const embed = add(root.querySelector('.ProseMirror')!, '<div class="card card-embed"><span data-card-link="Missing"><span class="wikilink">Missing</span></span></div>')
      over(embed.querySelector('.wikilink')!)
      expect(hover.onHover).not.toHaveBeenCalled()
    })

    it('still blocked inside a drawing board embed, but a card inside it is allowed', async () => {
      const hover = { onHover: vi.fn(), onLeave: vi.fn() }
      const { root } = await mount('pad\n', hover)
      const board = add(root.querySelector('.ProseMirror')!, '<div class="board-embed"><span data-card-link="Known"><span class="wikilink">Known</span></span></div>')
      over(board.querySelector('.wikilink')!)
      expect(hover.onHover).not.toHaveBeenCalled()
      const withCard = add(root.querySelector('.ProseMirror')!, '<div class="board-embed"><div class="card"><span data-card-link="Known"><span class="wikilink">Known</span></span></div></div>')
      over(withCard.querySelector('.wikilink')!)
      expect(hover.onHover).toHaveBeenCalledTimes(1)
    })

    it('a nested .card__editor does not double-fire: its own editor handles hover', async () => {
      const hover = { onHover: vi.fn(), onLeave: vi.fn() }
      const { root } = await mount('pad\n', hover)
      const card = add(root.querySelector('.ProseMirror')!, '<div class="card"><div class="card__editor"><span data-card-link="Known"><span class="wikilink">Known</span></span></div></div>')
      over(card.querySelector('.wikilink')!)
      expect(hover.onHover).not.toHaveBeenCalled()
    })

    it('destroy removes the listeners and tells the host the hover is over', async () => {
      const hover = { onHover: vi.fn(), onLeave: vi.fn() }
      const { root, crepe } = await mount('pad [[Known]]\n', hover)
      const known = span(root, 'Known')
      over(known)
      expect(hover.onHover).toHaveBeenCalledTimes(1)
      const pm = root.querySelector('.ProseMirror')!
      await crepe.destroy()
      expect(hover.onLeave).toHaveBeenCalledOnce()
      over(known)
      expect(hover.onHover).toHaveBeenCalledTimes(1)
      mounted.splice(mounted.findIndex((m) => m.crepe === crepe), 1)
      pm.remove()
    })
  })
})
