/**
 * List view (4F, GRO-2140): BaseView mounted with react-dom in jsdom; `type: list` renders one
 * item per record. The FIRST property in `order` is the primary line — `file.name` (a link →
 * `onOpenFile`) by default when `order` is empty or absent; a different first property renders
 * its typed value instead and file.name is NOT implicitly added (Obsidian: the primary list item
 * is whatever sits on top of the Properties menu). Remaining properties render indented beneath
 * (`indentProperties: true`, label/value rows) or inline after the primary joined by
 * `propertySeparator` (default `, `; empty values skipped). `markerStyle` bullet | number | none
 * (default bullet; number restarts per group). Grouped results render 4C sections with the same
 * persisted collapse state as the table/board; search narrows items and drops empty groups.
 * The three config keys get controls in the Properties menu, shown only for list views; each
 * writes once through `updateBase` and the default value DELETES the key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type BaseDefinition, type ParsedBase, parseBase, serializeBase } from '../baseFile'
import { BaseView, type BaseViewProps } from '../BaseView'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** In-memory stand-in for the main-owned store: collapse state must go through here, not the file. */
const { groupStore } = vi.hoisted(() => ({ groupStore: new Map<string, string[]>() }))
vi.mock('../../lib/storage', () => ({
  storage: {
    getBaseGroups: vi.fn((root: string, key: string) => groupStore.get(`${root}|${key}`) ?? []),
    setBaseGroups: vi.fn((root: string, key: string, collapsed: readonly string[]) => {
      if (collapsed.length === 0) groupStore.delete(`${root}|${key}`)
      else groupStore.set(`${root}|${key}`, [...collapsed])
    }),
  },
}))

const LIST_BASE = `views:
  - type: list
    name: L
    order:
      - file.name
      - note.status
      - note.priority
`

const GROUPED_BASE = `views:
  - type: list
    name: L
    order:
      - file.name
      - note.priority
    groupBy:
      property: note.status
    summaries:
      note.priority: Sum
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<BaseViewProps> = {}) {
  let parsed = parseBase(text)
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedBase) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <BaseView
          parsed={parsed}
          onChange={onChange}
          root="/vault"
          thisFile="/vault/pillars.base"
          records={TEST_RECORDS}
          indexStatus="ready"
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile, yaml: () => serializeBase(parsed), def: (): BaseDefinition => parsed.def }
}

function unmount(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

afterEach(() => {
  unmount()
  groupStore.clear()
  vi.clearAllMocks()
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  draw()
}

/** Type into a TextField and commit with Enter (one onChange). */
function type(el: HTMLInputElement, text: string): void {
  setValue(el, text)
  press(el, 'Enter')
}

const items = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.base-list__item')]
const titles = (el: ParentNode): string[] => [...el.querySelectorAll('.base-list__title')].map((b) => b.textContent ?? '')
const markers = (el: ParentNode): string[] => [...el.querySelectorAll('.base-list__marker')].map((m) => m.textContent ?? '')
const inlineOf = (item: HTMLElement): string | null => item.querySelector('.base-list__inline')?.textContent ?? null
const sections = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.base-list__group')]
const headerTexts = (el: ParentNode): string[] => sections(el).map((s) => q(s, '.base-group__value').textContent ?? '')
const toggleOf = (el: ParentNode, label: string): HTMLElement => byLabel(el, `Toggle group ${label}`)
const openProperties = (el: ParentNode): HTMLElement => {
  click(byLabel(el, 'Properties'))
  return q(el, '.base-popover')
}

// ---------- tests ----------

describe('primary line', () => {
  it('file.name first in order renders a link that opens the note; the rest sits inline after it', () => {
    const { el, onOpenFile } = mount(LIST_BASE)
    expect(items(el)).toHaveLength(8)
    expect(titles(el)[0]).toBe('Agentic Agency.md')
    expect(inlineOf(items(el)[0])).toBe('idea, 2')
    click(q(el, '.base-list__title'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
  })

  it('no order at all defaults the primary line to the file.name link', () => {
    const { el, onOpenFile } = mount('views:\n  - type: list\n    name: L\n')
    expect(titles(el)).toHaveLength(8)
    expect(titles(el)[0]).toBe('Agentic Agency.md')
    click(q(el, '.base-list__title'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
  })

  it('a different first order property is the primary line (typed value, no link) and file.name is not implicitly added', () => {
    const { el } = mount('views:\n  - type: list\n    name: L\n    order:\n      - note.status\n      - file.name\n')
    expect(el.querySelector('.base-list__title')).toBeNull()
    const primaries = [...el.querySelectorAll('.base-list__primary')].map((s) => s.textContent)
    expect(primaries[0]).toBe('idea')
    // file.name is second in order, so it renders as a plain inline value, not the primary link
    expect(inlineOf(items(el)[0])).toBe('Agentic Agency.md')
  })

  it('empty values are skipped in the inline run — a bare note renders no inline span', () => {
    const { el } = mount(LIST_BASE)
    const attribution = items(el).find((i) => i.querySelector('.base-list__title')?.textContent === 'Attribution.md')
    expect(attribution).toBeDefined()
    expect(inlineOf(attribution!)).toBeNull()
  })
})

describe('indentProperties', () => {
  it('true renders label/value rows beneath the primary line instead of the inline run', () => {
    const { el } = mount(LIST_BASE.replace('name: L', 'name: L\n    indentProperties: true'))
    expect(el.querySelector('.base-list__inline')).toBeNull()
    const first = items(el)[0]
    expect([...first.querySelectorAll('.base-list__prop-name')].map((n) => n.textContent)).toEqual(['status', 'priority'])
    expect([...first.querySelectorAll('.base-list__prop-value')].map((n) => n.textContent)).toEqual(['idea', '2'])
  })

  it('false behaves like absent: inline with the default separator', () => {
    const { el } = mount(LIST_BASE.replace('name: L', 'name: L\n    indentProperties: false'))
    expect(el.querySelector('.base-list__props')).toBeNull()
    expect(inlineOf(items(el)[0])).toBe('idea, 2')
  })

  it('a custom propertySeparator is honored', () => {
    const { el } = mount(LIST_BASE.replace('name: L', "name: L\n    propertySeparator: ' | '"))
    expect(inlineOf(items(el)[0])).toBe('idea | 2')
  })
})

describe('markerStyle', () => {
  it('default is a bullet on every item', () => {
    const { el } = mount(LIST_BASE)
    expect(markers(el)).toEqual(Array(8).fill('•'))
  })

  it('number renders ordinals, none renders no marker at all', () => {
    const numbered = mount(LIST_BASE.replace('name: L', 'name: L\n    markerStyle: number'))
    expect(markers(numbered.el)).toEqual(['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.'])
    unmount()
    const bare = mount(LIST_BASE.replace('name: L', 'name: L\n    markerStyle: none'))
    expect(bare.el.querySelector('.base-list__marker')).toBeNull()
    expect(items(bare.el)).toHaveLength(8)
  })

  it('number restarts at 1 inside every group', () => {
    const { el } = mount(GROUPED_BASE.replace('name: L', 'name: L\n    markerStyle: number'))
    expect(sections(el).map((s) => markers(s))).toEqual([['1.'], ['1.', '2.'], ['1.', '2.'], ['1.', '2.', '3.']])
  })
})

describe('grouped sections', () => {
  it('groupBy renders 4C sections — shared header with value, count, summaries — No value last', () => {
    const { el } = mount(GROUPED_BASE)
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value'])
    expect(sections(el).map((s) => q(s, '.base-group__count').textContent)).toEqual(['1', '2', '2', '3'])
    expect(sections(el).map((s) => s.querySelector('.base-group__summary')?.textContent)).toEqual(['Sum1', 'Sum2', 'Sum3', 'Sum'])
    expect(sections(el).map((s) => items(s).length)).toEqual([1, 2, 2, 3])
  })

  it('the chevron hides a section, persists through storage and never writes the file', async () => {
    const { storage } = await import('../../lib/storage')
    const { el, onChange } = mount(GROUPED_BASE)
    click(toggleOf(el, 'idea'))
    expect(titles(el)).not.toContain('Agentic Agency.md')
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value']) // header stays
    expect(toggleOf(el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(onChange).not.toHaveBeenCalled() // NOT in the .base file, no autosave
    expect(storage.setBaseGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.base::L', ['v:idea'])

    // a fresh mount of the same base + view starts collapsed from the store
    unmount()
    const again = mount(GROUPED_BASE)
    expect(toggleOf(again.el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(titles(again.el)).not.toContain('Agentic Agency.md')

    // expanding removes the entry
    click(toggleOf(again.el, 'idea'))
    expect(titles(again.el)).toContain('Agentic Agency.md')
    expect(storage.setBaseGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.base::L', [])
  })

  it('search narrows items, drops empty sections and recomputes counts and summaries', () => {
    const { el } = mount(GROUPED_BASE)
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'agency')
    expect(headerTexts(el)).toEqual(['drafting', 'idea'])
    expect(titles(el)).toEqual(['The Levels of an Agency.md', 'Agentic Agency.md'])
    expect(sections(el).map((s) => q(s, '.base-group__count').textContent)).toEqual(['1', '1'])
    expect(sections(el)[1].querySelector('.base-group__summary')?.textContent).toBe('Sum2')
    expect(q(el, '.base-toolbar__count').textContent).toBe('2 / 8 items')
  })
})

describe('list settings in the Properties menu', () => {
  it('the List section only exists for list views', () => {
    const { el } = mount(LIST_BASE)
    const pop = openProperties(el)
    expect(pop.querySelector('[aria-label="Indent properties"]')).not.toBeNull()
    expect(pop.querySelector('[aria-label="Marker style"]')).not.toBeNull()
    expect(pop.querySelector('[aria-label="Property separator"]')).not.toBeNull()
    unmount()
    const table = mount('views:\n  - type: table\n    name: T\n')
    const tablePop = openProperties(table.el)
    expect(tablePop.querySelector('[aria-label="Indent properties"]')).toBeNull()
    expect(tablePop.querySelector('[aria-label="Marker style"]')).toBeNull()
  })

  it('Indent properties writes indentProperties: true once and changes the rendering; off deletes the key', () => {
    const { el, onChange, def, yaml } = mount(LIST_BASE)
    const pop = openProperties(el)
    click(byLabel(pop, 'Indent properties'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].indentProperties).toBe(true)
    expect(yaml()).toContain('indentProperties: true')
    expect(el.querySelector('.base-list__props')).not.toBeNull()
    expect(el.querySelector('.base-list__inline')).toBeNull()

    click(byLabel(pop, 'Indent properties'))
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(def().views[0].indentProperties).toBeUndefined()
    expect(yaml()).not.toContain('indentProperties')
    expect(el.querySelector('.base-list__props')).toBeNull()
    expect(el.querySelector('.base-list__inline')).not.toBeNull()
  })

  it('Marker style writes markerStyle once per pick; bullet (the default) deletes the key', () => {
    const { el, onChange, def, yaml } = mount(LIST_BASE)
    const pop = openProperties(el)
    setValue(byLabel(pop, 'Marker style'), 'number')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].markerStyle).toBe('number')
    expect(yaml()).toContain('markerStyle: number')
    expect(markers(el)[0]).toBe('1.')

    setValue(byLabel(pop, 'Marker style'), 'none')
    expect(yaml()).toContain('markerStyle: none')
    expect(el.querySelector('.base-list__marker')).toBeNull()

    setValue(byLabel(pop, 'Marker style'), 'bullet')
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(def().views[0].markerStyle).toBeUndefined()
    expect(yaml()).not.toContain('markerStyle')
    expect(markers(el)[0]).toBe('•')
  })

  it('Property separator commits once; the default ", " deletes the key', () => {
    const { el, onChange, def, yaml } = mount(LIST_BASE)
    const pop = openProperties(el)
    type(byLabel(pop, 'Property separator'), ' | ')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].propertySeparator).toBe(' | ')
    expect(yaml()).toContain('propertySeparator')
    expect(inlineOf(items(el)[0])).toBe('idea | 2')

    type(byLabel(pop, 'Property separator'), ', ')
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(def().views[0].propertySeparator).toBeUndefined()
    expect(yaml()).not.toContain('propertySeparator')
    expect(inlineOf(items(el)[0])).toBe('idea, 2')
  })
})
