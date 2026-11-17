/**
 * Right-click a pill › "Pill style ›" (YAZ-4924 round 5, `pillStyle.ts`): ONE link's own style, written into the page
 * as the marks the page toolbar writes around the whole link — bold `**`, italic `*`, underline `<u>`, highlight `==`
 * or `<mark class="highlight-<name>">` — and "↺ Back to the vault's look", which takes them off that link only. A
 * real editor, real right-clicks; the flyout stays open after a pick (as "Header row style ›"); one undo each; a
 * read-only page shows the row disabled. A Markdown link pill has the same row.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { WIKILINK_CLASS, createWikilinkResolveSource } from './wikilinkPlugin'

const resolve = (target: string) => (target === 'Known' ? '/vault/Known.md' : target === 'Other' ? '/vault/Other.md' : null)
const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const source = createWikilinkResolveSource()
  source.update(resolve, undefined, undefined, false)
  const nav = { root: '/vault', createFolder: () => '', openCurrent: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn() }
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks: source, wikilinkNav: nav })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, source, view: crepe.editor.action((ctx) => ctx.get(editorViewCtx)) }
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true, writable: true })
})
afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const span = (root: HTMLElement, text: string) => Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).find((el) => el.textContent === text) as Element
const rightClick = (target: Element) => {
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 }))
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 }))
}
const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor:not(.ctx-menu__sub)')
const topRows = (view: EditorView) => Array.from(popupOf(view)!.querySelectorAll<HTMLButtonElement>(':scope > .ctx-menu__item, :scope > .ctx-menu__parent > .ctx-menu__item')).map((b) => b.textContent)
/** Opens "Pill style ›" and returns its flyout. */
const flyout = (view: EditorView): HTMLElement => {
  const parent = Array.from(popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item--parent')).find((b) => b.textContent === 'Pill style')!
  parent.click()
  return popupOf(view)!.querySelector<HTMLElement>('.ctx-menu__sub')!
}
const subRows = (sub: HTMLElement) => Array.from(sub.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')).map((b) => `${b.textContent}${b.dataset.hint === '✓' ? ' ✓' : ''}${b.disabled ? ' (off)' : ''}`)
const pick = (view: EditorView, label: string) => {
  const sub = popupOf(view)!.querySelector<HTMLElement>('.ctx-menu__sub')!
  Array.from(sub.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')).find((b) => b.textContent === label)!.click()
}

describe('right-click a [[link]] › Pill style (YAZ-4924 round 5)', () => {
  it('is a flyout in the link menu, before Edit link: Text (B I U), Highlight (None, yellow, the named colours), Back to the vault\'s look', async () => {
    const { root, view } = await mount('pad [[Known]] tail\n')
    rightClick(span(root, 'Known'))
    expect(topRows(view)).toEqual(['Open', 'Open in new tab', 'Copy name', 'Copy path', 'Pill style', 'Edit link', 'Remove link'])
    const sub = flyout(view)
    expect(Array.from(sub.querySelectorAll('.ctx-menu__heading')).map((h) => h.textContent)).toEqual(['Text', 'Highlight'])
    expect(subRows(sub)).toEqual(['Bold', 'Italic', 'Underline', 'None ✓', 'Yellow', 'Green', 'Blue', 'Pink', 'Orange', 'Purple', 'Red', 'Gray', "↺ Back to the vault's look (off)"])
  })

  it('Bold, Italic, Underline wrap the WHOLE link in the toolbar\'s marks, a second pick takes it off; the flyout stays open and shows the ✓', async () => {
    const { crepe, root, view } = await mount('pad [[Known]] tail\n')
    rightClick(span(root, 'Known'))
    flyout(view)
    pick(view, 'Bold')
    expect(getMarkdownForSave(crepe)).toBe('pad **[[Known]]** tail\n')
    expect(subRows(popupOf(view)!.querySelector('.ctx-menu__sub')!).slice(0, 3)).toEqual(['Bold ✓', 'Italic', 'Underline'])
    pick(view, 'Italic')
    pick(view, 'Underline')
    expect(getMarkdownForSave(crepe)).toBe('pad ***<u>[[Known]]</u>*** tail\n')
    pick(view, 'Bold')
    expect(getMarkdownForSave(crepe)).toBe('pad *<u>[[Known]]</u>* tail\n')
    // Still one pill: the link is drawn as before, its text unchanged.
    expect(span(root, 'Known')).toBeDefined()
  })

  it('a highlight colour is the toolbar\'s highlight around the link: yellow `==`, a named colour `<mark class>`, None takes it off', async () => {
    const { crepe, root, view } = await mount('pad [[Known]] tail\n')
    rightClick(span(root, 'Known'))
    flyout(view)
    pick(view, 'Green')
    expect(getMarkdownForSave(crepe)).toBe('pad <mark class="highlight-green">[[Known]]</mark> tail\n')
    expect(subRows(popupOf(view)!.querySelector('.ctx-menu__sub')!)).toContain('Green ✓')
    pick(view, 'Yellow')
    expect(getMarkdownForSave(crepe)).toBe('pad ==[[Known]]== tail\n')
    pick(view, 'None')
    expect(getMarkdownForSave(crepe)).toBe('pad [[Known]] tail\n')
  })

  it("Back to the vault's look takes this link's marks off, and only this link's; each pick is one undo", async () => {
    const { crepe, root, view } = await mount('pad **[[Other]]** and *==[[Known]]==* tail\n')
    rightClick(span(root, 'Known'))
    const sub = flyout(view)
    expect(subRows(sub)).toEqual(['Bold', 'Italic ✓', 'Underline', 'None', 'Yellow ✓', 'Green', 'Blue', 'Pink', 'Orange', 'Purple', 'Red', 'Gray', "↺ Back to the vault's look"])
    pick(view, "↺ Back to the vault's look")
    expect(getMarkdownForSave(crepe)).toBe('pad **[[Other]]** and [[Known]] tail\n')
    undo(view.state, view.dispatch)
    expect(getMarkdownForSave(crepe)).toBe('pad **[[Other]]** and *==[[Known]]==* tail\n')
  })

  it('a read-only page shows the row disabled, with the read-only reason: styling changes the page', async () => {
    const { crepe, root, view } = await mount('pad [[Known]] tail\n')
    crepe.setReadonly(true)
    rightClick(span(root, 'Known'))
    const row = Array.from(popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')).find((b) => b.textContent === 'Pill style')!
    expect([row.disabled, row.dataset.hint, row.classList.contains('ctx-menu__item--parent')]).toEqual([true, 'This page is read only', false])
  })
})

describe('right-click a Markdown link pill › Pill style (YAZ-4924 round 5)', () => {
  it('styles the whole link the same way; a web link has no Pill style', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const nav = { open: vi.fn().mockResolvedValue(undefined), copy: vi.fn().mockResolvedValue(undefined), onNotice: vi.fn(), vaultPath: (href: string) => (href.startsWith('../') ? `/v/${href.slice(3)}` : null) }
    const crepe = createCrepe({ root, defaultValue: 'see [Plan](../plan.md) and [Web](https://example.com)\n', markdownLinkNav: nav })
    await crepe.create()
    mounted.push({ crepe, root })
    const view = crepe.editor.ctx.get(editorViewCtx)
    const anchors = root.querySelectorAll('a')
    rightClick(anchors[0]!)
    expect(topRows(view)).toContain('Pill style')
    flyout(view)
    pick(view, 'Bold')
    expect(getMarkdownForSave(crepe)).toBe('see **[Plan](../plan.md)** and [Web](https://example.com)\n')
    pick(view, 'Blue')
    // The link mark holds the highlight, as the toolbar's highlight on the link's words does.
    expect(getMarkdownForSave(crepe)).toBe('see **[<mark class="highlight-blue">Plan</mark>](../plan.md)** and [Web](https://example.com)\n')
    rightClick(root.querySelectorAll('a')[1]!)
    expect(topRows(view)).not.toContain('Pill style')
  })
})

describe("a link's own style wins over the vault's look (YAZ-4924 round 5)", () => {
  it("the pill's head and tail wear the link's marks, so the whole pill is bold or highlighted; Back takes them off the ends too", async () => {
    const { root, source, view } = await mount('pad **[[Known]]** and <mark class="highlight-green">[[Other]]</mark> tail\n')
    source.setLook({ format: '({icon}{name})', parts: { name: { color: 'red' } } }, 'Mine')
    const ends = () => Array.from(root.querySelectorAll<HTMLElement>('.link-pill__head, .link-pill__tail')).map((el) => `${el.textContent}:${el.closest('strong') !== null ? 'bold' : ''}${el.closest('mark.highlight-green') !== null ? 'green' : ''}`)
    expect(ends()).toEqual(['(:bold', '):bold', '(:green', '):green'])
    rightClick(span(root, 'Known'))
    flyout(view)
    pick(view, "↺ Back to the vault's look")
    expect(ends()).toEqual(['(:', '):', '(:green', '):green'])
  })

  it("CSS: the page's highlight shows through the vault's box; bold and italic follow the page unless the vault adds them; the vault can never take them away", () => {
    const css = readFileSync(join(__dirname, 'wikilink.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.milkdown \.ProseMirror mark \.wikilink:not\(\.wikilink--unresolved\)\s*\{\s*background:\s*transparent;/)
    expect(css).toMatch(/\.wikilink \{[^}]*font-weight: var\(--pill-name-weight, inherit\);[^}]*font-style: var\(--pill-name-style, inherit\);/)
  })
})
