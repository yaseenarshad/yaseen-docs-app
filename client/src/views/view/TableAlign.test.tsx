/**
 * Left, Center or Right per column (YAZ-3746 13Y): ViewsPane mounted in jsdom. `view.columnAlign[<canonical key>]`
 * puts `view-table__cell--align-<align>` on the column's header, body cells and summary cell; no entry is Auto, with
 * no class. The header menu's Text › Align items and the column editor's Align row each write it in one write.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import viewsCss from '../views.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: vi.fn(() => []), setViewGroups: vi.fn() } }))

const table = (extra = '') => `views:
  - type: table
    name: T
    order:
      - file.name
      - note.tags
      - note.status
    sort:
      - property: file.name
        direction: ASC
${extra}`

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const records = props.records ?? TEST_RECORDS
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = () =>
    act(() =>
      root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={records} folder={testFolderHost({ vaultRecords: records })} onOpenFile={vi.fn()} {...props} />),
    )
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
    draw()
  })
  draw()
  return { el: container, yaml: () => serializeViews(parsed), onChange }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

const th = (el: ParentNode, index: number): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')][index]
const items = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
const item = (el: ParentNode, label: string) => {
  const found = items(el).find((b) => b.textContent === label)
  if (found === undefined) throw new Error(`no item ${label}: ${items(el).map((b) => b.textContent).join(', ')}`)
  return found
}
function rightClick(target: Element): void {
  act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 20 })))
}
/** Right-click a header and open its Text › flyout: the ALIGN group's rows (the second group), the ✓ read from `data-hint`. */
function alignMenu(target: Element): string[] {
  rightClick(target)
  act(() => item(document.body, 'Text').click())
  const groups = document.querySelectorAll<HTMLElement>('.ctx-menu__sub [role="group"]')
  return [...groups[1].querySelectorAll<HTMLElement>('[role="menuitem"]')].map((b) => `${b.getAttribute('data-hint') === '✓' ? '✓ ' : ''}${b.textContent}`)
}
/** The body cells of column `c`, in row order. */
const column = (el: ParentNode, c: number) => [...el.querySelectorAll<HTMLElement>(`.view-table tbody td[data-cell$=":${c}"]`)]
const summary = (el: ParentNode, c: number): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table tfoot td.view-table__summary:not(.view-table__gutter)')][c]
const CENTER = 'view-table__cell--align-center'
const RIGHT = 'view-table__cell--align-right'
const LEFT = 'view-table__cell--align-left'
const hasAlign = (el: Element) => [...el.classList].some((k) => k.startsWith('view-table__cell--align-'))

describe('the Text › Align items in the column header menu (13Y)', () => {
  it('Auto is ✓ with no entry; Align center writes columnAlign[canonical key] = center, and Auto alignment deletes it and the empty map', () => {
    const { el, yaml, onChange } = mount(table())
    expect(alignMenu(th(el, 2))).toEqual(['✓ Auto alignment', 'Align left', 'Align center', 'Align right'])
    const writes = onChange.mock.calls.length
    act(() => item(document.body, 'Align center').click())
    expect(onChange.mock.calls.length).toBe(writes + 1)
    expect(yaml()).toContain('columnAlign:\n      note.status: center')
    expect(el.querySelector('.ctx-menu')).toBeNull()

    expect(alignMenu(th(el, 2))).toEqual(['Auto alignment', 'Align left', '✓ Align center', 'Align right'])
    act(() => item(document.body, 'Auto alignment').click())
    expect(yaml()).not.toContain('columnAlign')
  })

  it('the Wrap / Clip items stay, the first group of the same flyout', () => {
    const { el } = mount(table())
    rightClick(th(el, 1))
    act(() => item(document.body, 'Text').click())
    const groups = document.querySelectorAll<HTMLElement>('.ctx-menu__sub [role="group"]')
    expect([...groups[0].querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Wrap text', 'Clip text'])
  })
})

describe('the cells of an aligned column (13Y)', () => {
  it('Align center: the column header, every body cell and the summary cell carry the centered class; the other columns carry none', () => {
    const { el } = mount(table('    columnAlign:\n      note.status: center\n'))
    expect(th(el, 2).classList.contains(CENTER)).toBe(true)
    const status = column(el, 2)
    expect(status.length).toBeGreaterThan(0)
    expect(status.every((td) => td.classList.contains(CENTER))).toBe(true)
    expect(summary(el, 2).classList.contains(CENTER)).toBe(true)
    expect(hasAlign(th(el, 0))).toBe(false)
    expect(column(el, 0).some(hasAlign)).toBe(false)
    expect(column(el, 1).some(hasAlign)).toBe(false)
  })

  it('reads a key in any spelling, and the Name column aligns too', () => {
    const { el } = mount(table('    columnAlign:\n      tags: right\n      file.name: left\n'))
    expect(th(el, 1).classList.contains(RIGHT)).toBe(true)
    expect(column(el, 1).every((td) => td.classList.contains(RIGHT))).toBe(true)
    expect(th(el, 0).classList.contains(LEFT)).toBe(true)
    expect(column(el, 0).every((td) => td.classList.contains(LEFT))).toBe(true)
  })

  it('a value that is not left / center / right is Auto: no class', () => {
    const { el } = mount(table('    columnAlign:\n      note.status: middle\n'))
    expect(hasAlign(th(el, 2))).toBe(false)
    expect(column(el, 2).some(hasAlign)).toBe(false)
  })

  it('the CSS: the three classes set text-align on th and td, after (and so over) the number cell rule; the summary button follows with justify-content', () => {
    const at = (selector: string) => viewsCss.indexOf(selector)
    expect(at('.view-table td.view-table__cell--align-left {')).toBeGreaterThan(at('.view-table td.view-table__cell--num {'))
    const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(viewsCss)?.[1] ?? ''
    expect(rule('.view-table th.view-table__cell--align-left,\n.view-table td.view-table__cell--align-left')).toMatch(/text-align:\s*left/)
    expect(rule('.view-table th.view-table__cell--align-center,\n.view-table td.view-table__cell--align-center')).toMatch(/text-align:\s*center/)
    expect(rule('.view-table th.view-table__cell--align-right,\n.view-table td.view-table__cell--align-right')).toMatch(/text-align:\s*right/)
    expect(rule('.view-table tfoot td.view-table__cell--align-center .view-table__summary-btn')).toMatch(/justify-content:\s*center/)
    expect(rule('.view-table tfoot td.view-table__cell--align-right .view-table__summary-btn')).toMatch(/justify-content:\s*flex-end/)
  })
})

describe('the column editor\'s Align row (13Y)', () => {
  it('Edit column… shows Auto · Left · Center · Right with the current one pressed; a pick is one columnAlign write', () => {
    const { el, yaml, onChange } = mount(table())
    rightClick(th(el, 2))
    act(() => item(document.body, 'Edit column…').click())
    const seg = document.body.querySelector<HTMLElement>('.column-detail [role="group"][aria-label="Align Status"]')
    if (seg === null) throw new Error('no Align row')
    const opts = [...seg.querySelectorAll<HTMLButtonElement>('button')]
    expect(opts.map((b) => `${b.getAttribute('aria-pressed') === 'true' ? '✓ ' : ''}${b.textContent}`)).toEqual(['✓ Auto', 'Left', 'Center', 'Right'])
    const writes = onChange.mock.calls.length
    act(() => opts[3].click())
    expect(onChange.mock.calls.length).toBe(writes + 1)
    expect(yaml()).toContain('columnAlign:\n      note.status: right')
    expect(column(el, 2).every((td) => td.classList.contains(RIGHT))).toBe(true)
    const again = [...document.body.querySelectorAll<HTMLButtonElement>('.column-detail [role="group"][aria-label="Align Status"] button')]
    expect(again.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true'])
  })
})
