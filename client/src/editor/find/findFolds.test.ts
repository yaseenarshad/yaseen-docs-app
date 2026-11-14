/**
 * ⌘F and folded bullets (YAZ-4787 demo: "choose whether find opens folded bullets"), on real editors through the find
 * channel, as findInPage.test.ts does:
 * - the channel's `folds`, by default `current`: only the fold that hides the ACTIVE match opens, and it folds again on
 *   the next step; `all` opens every fold hiding a match; `keep` opens none and counts only what shows;
 * - a page's own choice is `find-folds:` in its properties (`readFindFolds` / `writeFindFolds`);
 * - matches inside a code block (a CodeMirror editor that draws its own text) are painted there too, the active one
 *   marked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { FIND_FOLDS } from '@shared/types'
import { FIND_FOLDS_KEY, readFindFolds, writeFindFolds } from '@shared/pageSwitches'
import { createCrepe, type CreateCrepeOptions } from '../createCrepe'
import { OUTLINE_FOLDED_ATTR } from '../outline/outlineFolding'
import { getOutlineFoldKey } from '../outline/outlineFoldKeys'
import { createFindChannel } from './findChannel'
import { FIND_ACTIVE_CLASS, FIND_MATCH_CLASS } from './findInPage'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
async function mountFind(markdown: string, opts: Omit<CreateCrepeOptions, 'root' | 'find' | 'defaultValue'> = {}) {
  const channel = createFindChannel()
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, find: channel, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.ctx.get(editorViewCtx)
  return { crepe, root, view, channel }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const TWO_FOLDS = `* Parent
  * apple one
* Fruit
  * apple two
* visible apple three
`
const folded = { folding: { seedCollapsedKeys: () => new Set([getOutlineFoldKey('Parent', 0), getOutlineFoldKey('Fruit', 0)]) } }
/** The text of each folded subtree. */
const foldedText = (root: HTMLElement) => [...root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)].map((el) => el.textContent ?? '')
const isFolded = (root: HTMLElement, text: string) => foldedText(root).some((t) => t.includes(text))

describe('YAZ-4787 demo: the page choice in its properties', () => {
  it('YAZ-4787 demo: the three choices are current, all and keep', () => {
    expect(FIND_FOLDS).toEqual(['current', 'all', 'keep'])
    expect(FIND_FOLDS_KEY).toBe('find-folds')
  })

  it('YAZ-4787 demo: `find-folds:` reads back; no key or a value that is no choice is null (follow Settings)', () => {
    expect(readFindFolds('---\nfind-folds: all\n---\nbody\n')).toBe('all')
    expect(readFindFolds('---\nfind-folds: keep\n---\n')).toBe('keep')
    expect(readFindFolds('---\ntitle: x\n---\n')).toBeNull()
    expect(readFindFolds('---\nfind-folds: sometimes\n---\n')).toBeNull()
    expect(readFindFolds('no frontmatter, find-folds: all\n')).toBeNull()
  })

  it('YAZ-4787 demo: writeFindFolds writes the key; "Use the default" (null) removes it; the same value changes nothing', () => {
    const set = writeFindFolds('---\na: 1\n---\nbody\n', 'keep')
    expect(readFindFolds(set)).toBe('keep')
    expect(set.endsWith('body\n')).toBe(true)
    expect(writeFindFolds(set, 'keep')).toBe(set)
    const back = writeFindFolds(set, null)
    expect(readFindFolds(back)).toBeNull()
    expect(back).not.toContain('find-folds')
  })
})

describe('YAZ-4787 demo: what find opens', () => {
  it('YAZ-4787 demo: the default is current: only the fold hiding the active match opens; the next step folds it again and opens the next', async () => {
    const { root, channel } = await mountFind(TWO_FOLDS, folded)
    expect(channel.getState().folds).toBe('current')
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState()).toMatchObject({ total: 3, activeIndex: 0 })
    expect(isFolded(root, 'apple one')).toBe(false)
    expect(isFolded(root, 'apple two')).toBe(true)
    channel.next()
    expect(isFolded(root, 'apple one')).toBe(true)
    expect(isFolded(root, 'apple two')).toBe(false)
  })

  it('YAZ-4787 demo: all opens every fold that hides a match', async () => {
    const { root, channel } = await mountFind(TWO_FOLDS, folded)
    channel.setFolds('all')
    channel.open()
    channel.setQuery('apple')
    expect(foldedText(root)).toEqual([])
    expect(channel.getState().total).toBe(3)
  })

  it('YAZ-4787 demo: keep opens nothing, and a match a fold hides is no match', async () => {
    const { root, channel } = await mountFind(TWO_FOLDS, folded)
    channel.setFolds('keep')
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState()).toMatchObject({ total: 1, activeIndex: 0 })
    expect(isFolded(root, 'apple one')).toBe(true)
    expect(isFolded(root, 'apple two')).toBe(true)
  })

  it('YAZ-4787 demo: a change of the choice runs the open search again', async () => {
    const { root, channel } = await mountFind(TWO_FOLDS, folded)
    channel.open()
    channel.setQuery('apple')
    expect(channel.getState().total).toBe(3)
    channel.setFolds('keep')
    expect(channel.getState().folds).toBe('keep')
    expect(channel.getState().total).toBe(1)
    channel.setFolds('all')
    expect(foldedText(root)).toEqual([])
  })
})

describe('YAZ-4787 demo: matches inside a code block', () => {
  it('YAZ-4787 demo: a match in a code block is painted in its CodeMirror text, the active one marked', async () => {
    // A code block mounts its CodeMirror editor when it comes into view; jsdom's observer never says so, so this one does.
    const Seen = class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        queueMicrotask(() => this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Seen)
    const { root, channel } = await mountFind('caddy outside\n\n```\nrun caddy here\nand caddy again\n```\n')
    await vi.waitFor(() => expect(root.querySelectorAll('.cm-content')).toHaveLength(1))
    channel.open()
    channel.setQuery('caddy')
    expect(channel.getState()).toMatchObject({ total: 3, activeIndex: 0 })
    const inCode = () => [...root.querySelectorAll<HTMLElement>(`.cm-content .${FIND_MATCH_CLASS}`)]
    expect(inCode().map((el) => el.textContent)).toEqual(['caddy', 'caddy'])
    expect(inCode().some((el) => el.classList.contains(FIND_ACTIVE_CLASS))).toBe(false)
    channel.next()
    expect(inCode()[0].classList.contains(FIND_ACTIVE_CLASS)).toBe(true)
    channel.setQuery('')
    expect(inCode()).toEqual([])
  })
})
