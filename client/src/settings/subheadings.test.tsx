/**
 * Settings sub-headings (YAZ-5969): a long group's rows under small labels. The registry's shape (each sub-heading names
 * rows of its own group, together and in the group's order, no row twice), every row still found by search, the labels
 * drawn over their rows, and a search hit's arrow landing on the row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { DEFAULT_SETTINGS } from '@shared/types'
import { SETTINGS_SECTIONS, subheadingOf, type SettingsCtx } from './registry'
import { settingCandidates } from './searchSettings'
import { SettingsDialog } from './SettingsDialog'
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const withSubs = SETTINGS_SECTIONS.flatMap((section) => section.groups.filter((g) => g.subheadings !== undefined).map((group) => ({ section, group })))

describe('the registry`s sub-headings', () => {
  it('are in the busy sections', () => {
    const sections = new Set(withSubs.map(({ section }) => section.id))
    for (const id of ['cards', 'folderPages', 'tables', 'sidebar', 'canvas', 'files']) expect(sections).toContain(id)
  })

  it.each(withSubs.map(({ section, group }) => [`${section.id} › ${String(group.title)}`, group] as const))('%s: each names rows of its group, together, in order, none twice', (_, group) => {
    const ids = group.items.map((item) => item.id)
    const named = group.subheadings!.flatMap((sub) => sub.rows)
    expect(new Set(named).size).toBe(named.length)
    for (const id of named) expect(ids).toContain(id)
    for (const sub of group.subheadings!) {
      expect(sub.rows.length).toBeGreaterThan(0)
      const at = sub.rows.map((id) => ids.indexOf(id))
      // Together and in the group's order: consecutive indexes.
      expect(at).toEqual(at.map((_, i) => at[0] + i))
    }
    // A row under no sub-heading only comes before the first one, so it never reads as the one above's.
    const firstSub = ids.findIndex((id) => subheadingOf(group, id) !== undefined)
    ids.forEach((id, i) => {
      if (i > firstSub) expect(subheadingOf(group, id)).toBeDefined()
    })
  })

  it('every row is still a search candidate', () => {
    // Every section showing (Cards needs a vault's review settings).
    const ctx = { settings: { ...DEFAULT_SETTINGS }, onChange: () => undefined, review: { settings: { ...DEFAULT_REVIEW_SETTINGS }, save: () => undefined } } as SettingsCtx
    const candidates = new Set(settingCandidates(ctx).map((c) => c.item.id))
    for (const { group } of withSubs) for (const item of group.items) expect(candidates).toContain(item.id)
  })
})

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const ctx = { settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), review: { settings: { ...DEFAULT_REVIEW_SETTINGS }, save: vi.fn() } }
  act(() => root?.render(<SettingsDialog ctx={ctx} onClose={vi.fn()} />))
  return container
}
const clickNav = (el: HTMLElement, title: string) => act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === title)?.click())
/** The card's children as the reader meets them: a sub-heading's label, or a row's id. */
/** The group's sub-headings and rows in order (YAZ-5969 Q4: each sub-heading sits over its own card). */
const cardShape = (el: HTMLElement, title: string) => {
  const group = [...el.querySelectorAll<HTMLElement>('.settings-group')].find((g) => g.dataset.groupTitle === title)
  return [...(group?.children ?? [])].flatMap((c) =>
    c.matches('.settings-subheading') ? [`# ${c.textContent}`] : c.matches('.settings-group__card') ? [...c.children].map((r) => (r as HTMLElement).dataset.setting) : [],
  )
}
/** Each sub-heading is followed by its own card (Box per sub-group). */
const cardsPerSub = (el: HTMLElement, title: string) => {
  const group = [...el.querySelectorAll<HTMLElement>('.settings-group')].find((g) => g.dataset.groupTitle === title)
  return [...(group?.querySelectorAll('.settings-subheading') ?? [])].every((h) => h.nextElementSibling?.matches('.settings-group__card--sub') === true)
}

describe('drawn', () => {
  it('Drawings › New elements: each label over its own card of rows (Q4: Box per sub-group)', () => {
    const el = mount()
    clickNav(el, 'Drawings and diagrams')
    expect(cardShape(el, 'New elements')).toEqual([
      '# Shapes and lines',
      'canvas.newElementStyle',
      'canvas.newShapesMatchZoom',
      'canvas.fillSetsTextColor',
      'canvas.writingStrokeWidth',
      'canvas.vectorStrokeWidth',
      '# Text',
      'canvas.defaultFontFamily',
      'canvas.newTextScreenSize',
      'canvas.newTextWrapMargin',
      '# Default look',
      'canvas.defaultRoughness',
      'canvas.defaultTextAlign',
    ])
    expect(cardsPerSub(el, 'New elements')).toBe(true)
  })

  it('Cards › Card look: a sub-heading whose rows all hide is not drawn (the Vault row with one vault)', () => {
    const el = mount()
    clickNav(el, 'Cards')
    const shape = cardShape(el, 'Card look')
    expect(shape.filter((x) => x?.startsWith('# '))).toEqual(['# Hidden words', '# Card size', '# Title', '# Tables', '# Card sides', '# Spacing'])
    expect(shape[0]).toBe('# Hidden words')
  })

  it('a search finds a row under a sub-heading, and the hit`s arrow lands on that row', () => {
    const el = mount()
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    act(() => {
      set?.call(input, 'Default text alignment')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(el.querySelector('[data-setting="canvas.defaultTextAlign"]')).not.toBeNull()
    const scrolled = vi.fn()
    const proto = Element.prototype as unknown as { getBoundingClientRect: () => DOMRect }
    const had = proto.getBoundingClientRect
    // jsdom lays nothing out: the hit row is far below the pane, so the arrow must scroll to it.
    proto.getBoundingClientRect = function (this: Element) {
      const at = (this as HTMLElement).dataset?.setting === 'canvas.defaultTextAlign' ? 900 : 0
      return { top: at, bottom: at + 40, left: 0, right: 100, width: 100, height: 40, x: 0, y: at, toJSON: () => ({}) } as DOMRect
    }
    try {
      const pane = el.querySelector<HTMLElement>('.settings-pane')!
      Object.defineProperty(pane, 'scrollTop', { configurable: true, get: () => 0, set: scrolled })
      // The pane is 0–40 tall here (the stub), so a row at 900 is out of it.
      act(() => el.querySelector<HTMLButtonElement>('.settings-search__goto')?.click())
      expect(el.querySelector('[data-setting="canvas.defaultTextAlign"]')).not.toBeNull()
      expect(el.querySelector('.settings-section__title')?.textContent).toBe('Drawings and diagrams')
      expect(scrolled).toHaveBeenCalled()
      expect(scrolled.mock.calls.at(-1)?.[0]).toBeGreaterThan(800)
    } finally {
      proto.getBoundingClientRect = had
    }
  })
})
