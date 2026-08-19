/**
 * Outline folding (GRO-2011). Ported from yaseen-excalidraw `milkdownAdapter.test.ts`
 * (fold-related cases) and extended with the save-path guard: a fold toggle must never
 * reach `markdownUpdated` / Autosave, and must leave `getMarkdownForSave()` unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { Autosave } from '../../lib/autosave'
import { OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS } from './outlineFolding'
import { getOutlineFoldKey } from './outlineFoldKeys'

const OUTLINE = `* Parent
  * Child
    * Grandchild
* Leaf

1. Ordered parent
   1. Ordered child

* [ ] Task parent
  * Task child
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(opts: Omit<CreateCrepeOptions, 'root'>): Promise<{ crepe: Crepe; root: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const toggles = (root: HTMLElement): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)]
const toggleFor = (root: HTMLElement, label: string): HTMLButtonElement => {
  const btn = toggles(root).find((b) => b.getAttribute('aria-label')?.endsWith(` ${label}`))
  if (!btn) throw new Error(`no toggle for "${label}"`)
  return btn
}
const folded = (root: HTMLElement) => root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('outline folding', () => {
  it('renders a toggle only on list items that own a nested list', async () => {
    const { root } = await mount({ defaultValue: OUTLINE })
    const labels = toggles(root).map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Collapse Parent', 'Collapse Child', 'Collapse Ordered parent', 'Collapse Task parent'])
    for (const b of toggles(root)) {
      expect(b.getAttribute('aria-expanded')).toBe('true')
      expect(b.closest('li')?.querySelector('ul, ol')).not.toBeNull()
    }
    expect(labels.some((l) => l?.includes('Leaf'))).toBe(false)
  })

  it("folds only the parent's subtree, flips aria state, and leaves the markdown untouched", async () => {
    const { crepe, root } = await mount({ defaultValue: OUTLINE })
    const before = getMarkdownForSave(crepe)

    toggleFor(root, 'Parent').click()

    const btn = toggleFor(root, 'Parent')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-label')).toBe('Expand Parent')
    expect(folded(root)).toHaveLength(1)
    expect(folded(root)[0].textContent).toContain('Grandchild')
    expect(folded(root)[0].textContent).not.toContain('Leaf')
    expect(getMarkdownForSave(crepe)).toBe(before)

    toggleFor(root, 'Parent').click()
    expect(folded(root)).toHaveLength(0)
    expect(toggleFor(root, 'Parent').getAttribute('aria-expanded')).toBe('true')
  })

  it('folds every sibling nested list of a mixed-marker parent (GRO-2031)', async () => {
    // Obsidian vaults mix `*` and `-` markers at one indent level; remark parses them
    // as sibling lists inside the same list_item, and folding must hide them all.
    const MIXED = `* Parent\n  * Star child\n  - Dash child one\n  - Dash child two\n* Leaf\n`
    const { crepe, root } = await mount({ defaultValue: MIXED })
    const before = getMarkdownForSave(crepe)

    toggleFor(root, 'Parent').click()

    const hidden = folded(root)
    expect(hidden).toHaveLength(2)
    const hiddenText = [...hidden].map((el) => el.textContent).join(' ')
    expect(hiddenText).toContain('Star child')
    expect(hiddenText).toContain('Dash child one')
    expect(hiddenText).toContain('Dash child two')
    expect(hiddenText).not.toContain('Leaf')
    expect(getMarkdownForSave(crepe)).toBe(before)

    toggleFor(root, 'Parent').click()
    expect(folded(root)).toHaveLength(0)
  })

  it('is keyboard-operable: Enter and Space toggle and keep focus on the toggle', async () => {
    const { crepe, root } = await mount({ defaultValue: OUTLINE })
    const before = getMarkdownForSave(crepe)
    toggleFor(root, 'Parent').focus()
    toggleFor(root, 'Parent').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(toggleFor(root, 'Parent').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggleFor(root, 'Parent'))
    toggleFor(root, 'Parent').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(toggleFor(root, 'Parent').getAttribute('aria-expanded')).toBe('true')
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('reports stable keys and restores folds from them in a fresh instance', async () => {
    const onCollapsedKeysChange = vi.fn<(keys: readonly string[]) => void>()
    const first = await mount({ defaultValue: OUTLINE, folding: { onCollapsedKeysChange } })
    // Mount reports the live (resolved) set once, so stale persisted keys get pruned.
    expect(onCollapsedKeysChange).toHaveBeenLastCalledWith([])
    const key = toggleFor(first.root, 'Parent').dataset.outlineFoldKey
    expect(key).toBe(getOutlineFoldKey('Parent', 0))

    toggleFor(first.root, 'Parent').click()
    expect(onCollapsedKeysChange).toHaveBeenLastCalledWith([key])
    const firstMarkdown = getMarkdownForSave(first.crepe)
    await first.crepe.destroy()
    first.root.remove()
    mounted.pop()

    const onSecond = vi.fn<(keys: readonly string[]) => void>()
    const second = await mount({
      defaultValue: OUTLINE,
      folding: { initialCollapsedKeys: new Set([key!, 'stale:9']), onCollapsedKeysChange: onSecond },
    })
    expect(toggleFor(second.root, 'Parent').getAttribute('aria-expanded')).toBe('false')
    expect(folded(second.root)).toHaveLength(1)
    expect(onSecond).toHaveBeenLastCalledWith([key])
    expect(getMarkdownForSave(second.crepe)).toBe(firstMarkdown)
  })

  it('fold toggles never reach markdownUpdated or Autosave; a real edit still saves', async () => {
    const updates: string[] = []
    const save = vi.fn(async () => ({ mtime: 2 }))
    let autosave: Autosave | null = null
    const { crepe, root } = await mount({ defaultValue: OUTLINE, onMarkdownUpdated: (md) => void (updates.push(md), autosave?.update(md)) })
    // Crepe's own start-up transaction fires one markdownUpdated (~200ms after create) with the
    // normalised document; in the app that equals the Autosave baseline and is ignored. Let it pass.
    await sleep(400)
    updates.length = 0
    autosave = new Autosave({ markdown: getMarkdownForSave(crepe), mtime: 1, delayMs: 20, save, onStatus: () => {}, onConflict: () => {} })

    toggleFor(root, 'Parent').click()
    toggleFor(root, 'Ordered parent').click()
    toggleFor(root, 'Parent').click()
    // Listener debounce is 200ms; autosave delay 20ms — well past both.
    await sleep(400)
    expect(updates).toEqual([])
    expect(autosave.dirty).toBe(false)
    expect(save).not.toHaveBeenCalled()

    // Control: a document change goes through the same wiring and does save.
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText(' edited', 1 + 1 + 1 + 'Parent'.length))
    })
    await sleep(400)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toContain('* Parent edited')
    expect(save).toHaveBeenCalledTimes(1)
    // The surviving fold is still in place after the edit (positions re-mapped).
    expect(toggleFor(root, 'Ordered parent').getAttribute('aria-expanded')).toBe('false')
  })
})
