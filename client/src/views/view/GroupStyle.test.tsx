/**
 * Group header style (YAZ-3742 D5): each `groupBy` level's `highlight` and `large` style that
 * level's headers, in every view that draws `GroupHeader` — Table, Board, List and Cards.
 * S18: a Large highlighted header must fit the table's row height, or windowing breaks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import viewsCss from '../views.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: vi.fn(() => []), setViewGroups: vi.fn() } }))

let root: Root | null = null
let container: HTMLElement | null = null

function mount(type: string, groupBy: string) {
  const parsed = parseViews(`views:\n  - type: ${type}\n    name: V\n    order:\n      - file.name\n      - note.priority\n    groupBy:\n${groupBy}`)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<ViewsPane parsed={parsed} onChange={vi.fn()} root="/vault" folderPath="/vault/pillars.md" records={TEST_RECORDS} folder={testFolderHost()} onOpenFile={vi.fn()} />))
  return container
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const TWO_LEVELS = `      - property: note.status
        highlight: yellow
        large: true
      - property: note.pillar
        highlight: blue
`
const styleOf = (value: HTMLElement) => [value.classList.contains('view-group__value--highlight'), value.style.getPropertyValue('--view-group-hl'), value.classList.contains('view-group__value--large')]

describe('each level styles its own headers (YAZ-3742)', () => {
  it.each(['table', 'board'])('%s: the outer headers are yellow and Large, the inner headers blue and normal', (type) => {
    const el = mount(type, TWO_LEVELS)
    const outer = [...el.querySelectorAll<HTMLElement>('.view-group__value')].find(v => v.textContent === 'idea')!
    const inner = [...el.querySelectorAll<HTMLElement>('.view-group__value')].find(v => v.textContent === 'Agentic Agency')!
    expect(styleOf(outer)).toEqual([true, '#ffd500', true])
    expect(styleOf(inner)).toEqual([true, '#50a0ff', false])
  })

  it.each(['list', 'cards'])('%s: the headers it draws take the outer level\'s style', (type) => {
    const el = mount(type, TWO_LEVELS)
    const outer = [...el.querySelectorAll<HTMLElement>('.view-group__value')].find(v => v.textContent === 'idea')!
    expect(styleOf(outer)).toEqual([true, '#ffd500', true])
  })

  it('a groupBy entry with no property is no level: the next entry styles the outer headers (YAZ-4544)', () => {
    const el = mount('table', `      - highlight: red\n${TWO_LEVELS}`)
    const outer = [...el.querySelectorAll<HTMLElement>('.view-group__value')].find(v => v.textContent === 'idea')!
    const inner = [...el.querySelectorAll<HTMLElement>('.view-group__value')].find(v => v.textContent === 'Agentic Agency')!
    expect(styleOf(outer)).toEqual([true, '#ffd500', true])
    expect(styleOf(inner)).toEqual([true, '#50a0ff', false])
  })

  it('no style, or an unknown colour name, leaves the header as it was', () => {
    const el = mount('table', '      property: note.status\n      highlight: chartreuse\n')
    const value = [...el.querySelectorAll<HTMLElement>('.view-group__value')].find(v => v.textContent === 'idea')!
    expect(styleOf(value)).toEqual([false, '', false])
    expect(value.className).toBe('view-group__value')
  })

  it('the CSS contract: the wash is the colour at 40%; Large is 14px, weight 700', () => {
    expect(viewsCss).toMatch(/\.view-group__value--highlight \{[^}]*background: color-mix\(in srgb, var\(--view-group-hl\) 40%, transparent\)/s)
    expect(viewsCss).toMatch(/\.view-group__value--large \{[^}]*font-size: 14px;[^}]*font-weight: 700/s)
  })
})

/** The declarations of the one rule `selector` in views.css. */
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(viewsCss)?.[1]
  expect(body, selector).toBeDefined()
  return Object.fromEntries(body!.split(';').map(d => d.split(':').map(p => p.trim())).filter(([k, v]) => k && v).map(([k, v]) => [k, v]))
}
const px = (value: string | undefined) => Number(/^(\d+(?:\.\d+)?)px$/.exec(value ?? '')?.[1] ?? NaN)
const verticalPadding = (padding: string | undefined) => {
  const parts = (padding ?? '0').split(/\s+/).map(p => (p === '0' ? 0 : px(p)))
  return parts[0] + (parts.length > 2 ? parts[2] : parts[0])
}

describe('S18: a Large highlighted header fits the row height (YAZ-3742)', () => {
  // jsdom has no layout, so this checks the CSS contract. The real measurement is on screen in the demo.
  it.each([28, 44, 68])('row height %ipx: the Large highlighted value fits inside the group cell', (rowH) => {
    const large = rule('.view-group__value--large')
    const highlight = rule('.view-group__value--highlight')
    expect(large['font-size']).toBe('14px')
    const lineHeight = px(large['line-height'])
    expect(lineHeight).toBeGreaterThanOrEqual(14)
    const valueBox = lineHeight + verticalPadding(highlight.padding)
    // The group cell is a table cell: 3px padding top and bottom (`--view-table-cell-pad-y`) and a 1px bottom border.
    expect(rule('.view-table')['--view-table-cell-pad-y']).toBe('3px')
    const content = rowH - 2 * 3 - 1
    expect(valueBox).toBeLessThanOrEqual(content)
    // The toggle (14px icon + 2px padding) is the header's other tall item, and it fits as well.
    expect(14 + verticalPadding(rule('.view-group__toggle').padding)).toBeLessThanOrEqual(content)
  })
})
