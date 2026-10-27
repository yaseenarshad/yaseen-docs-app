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

async function mount(markdown: string, hover?: WikilinkHover) {
  const source = createWikilinkResolveSource()
  source.update((target) => (target === 'Known' ? '/vault/Known.md' : null))
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
    expect(hover.onHover).toHaveBeenCalledExactlyOnceWith('/vault/Known.md', expect.objectContaining({ left: expect.any(Number), bottom: expect.any(Number) }))
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
})
