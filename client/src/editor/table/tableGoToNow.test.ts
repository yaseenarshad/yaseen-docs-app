/**
 * Go to now (YAZ-4164, YAZ-4159 D11 / D12): the caret in the first empty cell of the now row of a calendar table, the
 * request a host makes for a note it opens (the daily-note button, ⌘D), "Go to now" in the six-dot menu, and the
 * "Now ↓" chip.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import { mount, unmountAll } from '../marks/markTestKit'
import { getMarkdownForSave } from '../createCrepe'
import type { MenuChoiceField, MenuItem, MenuRow } from '../blockHandleMenu'
import tableCalendarCss from './tableCalendar.css?raw'
import { goToNow } from './tableCalendar'
import { onGoToNowRequest, requestGoToNow, takeGoToNow } from './goToNowRequest'
import { tableRows } from './tableRows'

afterEach(async () => {
  await unmountAll()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  takeGoToNow('/v/a.md')
})

const calendar = (rows: string[][], part = 'calendar 30m'): string =>
  ['| Time | Plan | Done |', '| --- | --- | --- |', ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n') + `\n\n<!-- table: ${part} -->\n`
const PLAIN = '| a | b |\n| - | - |\n| 1 | 2 |\n\n'

/** The table, row and column of the caret, counted among the note's tables. */
function caretCell(view: EditorView): { table: number; row: number; col: number } | null {
  const { $from } = view.state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'table') continue
    let table = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table' && pos <= $from.before(d)) table++
      return node.type.name !== 'table'
    })
    return { table, row: $from.index(d), col: $from.index(d + 1) }
  }
  return null
}

const tablesOf = (doc: ProseNode): number[] => {
  const out: number[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'table') out.push(pos)
    return node.type.name !== 'table'
  })
  return out
}

async function mountAt(hours: number, minutes: number, markdown: string, options: Parameters<typeof mount>[1] = {}) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 2, hours, minutes, 0))
  return mount(markdown, options)
}

const DAY = [['9:00 am', 'Wake', ''], ['9:30 am', 'Gym', ''], ['10:00 am', 'Write', 'x'], ['10:30 am', '', '']]

describe('goToNow (D11)', () => {
  it('puts the caret in the first empty cell of the now row of the first calendar table', async () => {
    const { view } = await mountAt(9, 40, `${PLAIN}${calendar(DAY)}\n${calendar(DAY)}`)
    expect(goToNow(view)).toBe(true)
    // Table 1 is the first calendar table (table 0 is plain); row 2 is 9:30 am; its first empty cell is "Done".
    expect(caretCell(view)).toEqual({ table: 1, row: 2, col: 2 })
    expect(view.state.selection.empty).toBe(true)
  })

  it('a row with no empty cell: the caret at the end of its first cell after the time', async () => {
    const { view } = await mountAt(10, 5, calendar(DAY))
    expect(goToNow(view)).toBe(true)
    expect(caretCell(view)).toEqual({ table: 0, row: 3, col: 1 })
    expect(view.state.selection.$from.parentOffset).toBe('Write'.length)
  })

  it('a note with no calendar table, or no row at now: no caret move', async () => {
    const plain = await mountAt(9, 40, `${PLAIN}Text\n`)
    const before = plain.view.state.selection
    expect(goToNow(plain.view)).toBe(false)
    expect(plain.view.state.selection.eq(before)).toBe(true)
    const early = await mount(calendar(DAY))
    vi.setSystemTime(new Date(2026, 10, 2, 6, 0, 0))
    const at = early.view.state.selection
    expect(goToNow(early.view)).toBe(false)
    expect(early.view.state.selection.eq(at)).toBe(true)
  })

  it('scrolls the now row to the middle of the screen (the YAZ-4163 demo), not just into view', async () => {
    const seen: Array<[Element, unknown]> = []
    const was = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      seen.push([this, arg])
    }
    try {
      const { view } = await mountAt(9, 40, calendar(DAY))
      expect(goToNow(view)).toBe(true)
      const row = view.dom.querySelectorAll('tr')[2]!
      expect(seen.filter(([el]) => el === row).map(([, arg]) => arg)).toEqual([{ block: 'center' }])
    } finally {
      Element.prototype.scrollIntoView = was
    }
  })

  it('a read-only note: the document does not change; a now row in a folded run scrolls its bar to the middle (YAZ-4176)', async () => {
    const seen: Array<[Element, unknown]> = []
    const was = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      seen.push([this, arg])
    }
    try {
      // Rows 2-4 (9:00 am to 10:00 am) are folded: 9:40 is in the run, and 9:00 am is its bar.
      const { view, crepe } = await mountAt(9, 40, calendar(DAY, 'calendar 30m, fold 2-4'))
      crepe.setReadonly(true)
      const { doc, selection } = view.state
      const saved = getMarkdownForSave(crepe)
      expect(goToNow(view)).toBe(true)
      expect(view.state.doc).toBe(doc)
      expect(view.state.selection.eq(selection)).toBe(true)
      expect(getMarkdownForSave(crepe)).toBe(saved)
      const bar = view.dom.querySelectorAll('tr')[1]!
      expect(bar.classList.contains('table-fold-bar')).toBe(true)
      expect(seen.filter(([el]) => el === bar).map(([, arg]) => arg)).toEqual([{ block: 'center' }])
    } finally {
      Element.prototype.scrollIntoView = was
    }
  })

  it('a given table: its own now row', async () => {
    const { view } = await mountAt(10, 40, `${calendar(DAY)}\n${calendar(DAY)}`)
    expect(goToNow(view, tablesOf(view.state.doc)[1])).toBe(true)
    expect(caretCell(view)).toEqual({ table: 1, row: 4, col: 1 })
  })
})

describe('the go-to-now request (D11)', () => {
  it('is taken once, by the note it names, within 10 seconds', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const heard = vi.fn()
    const off = onGoToNowRequest(heard)
    requestGoToNow('/v/a.md')
    expect(heard).toHaveBeenCalledTimes(1)
    expect(takeGoToNow('/v/b.md')).toBe(false)
    expect(takeGoToNow('/v/a.md')).toBe(true)
    expect(takeGoToNow('/v/a.md')).toBe(false)
    requestGoToNow('/v/a.md')
    vi.advanceTimersByTime(10_001)
    expect(takeGoToNow('/v/a.md')).toBe(false)
    off()
    requestGoToNow('/v/a.md')
    expect(heard).toHaveBeenCalledTimes(2)
  })
})

describe('"Go to now" in the six-dot menu (D11)', () => {
  const menu = (view: EditorView, at: number): MenuItem[] => tableRows(view, { inside: at + 3 } as Parameters<typeof tableRows>[1], undefined as never)
  const row = (items: MenuItem[]) => items.find((item) => 'label' in item && item.label === 'Go to now') as MenuRow | undefined

  it('a calendar table has it; a plain table does not; it goes to that table\'s now row', async () => {
    const { view } = await mountAt(9, 40, `${PLAIN}${calendar(DAY)}`)
    const [plain, cal] = tablesOf(view.state.doc)
    expect(row(menu(view, plain!))).toBeUndefined()
    const item = row(menu(view, cal!))!
    expect(item.disabled).toBe(false)
    item.run()
    expect(caretCell(view)).toEqual({ table: 1, row: 2, col: 2 })
  })

  it('is disabled while no row holds now', async () => {
    const { view } = await mountAt(6, 0, calendar(DAY))
    expect(row(menu(view, tablesOf(view.state.doc)[0]!))?.disabled).toBe(true)
  })
})

describe('the "Now ↓" chip (D12)', () => {
  /** An observer stub: `see(el, visible, above)` reports one element. */
  function stubObserver() {
    const observers: Array<{ cb: IntersectionObserverCallback; els: Set<Element> }> = []
    vi.stubGlobal('IntersectionObserver', class {
      els = new Set<Element>()
      constructor(cb: IntersectionObserverCallback) {
        observers.push({ cb, els: this.els })
      }
      observe(el: Element) {
        this.els.add(el)
      }
      unobserve(el: Element) {
        this.els.delete(el)
      }
      disconnect() {
        this.els.clear()
      }
    })
    return (el: Element, visible: boolean, above = false, rect?: { top: number; bottom: number }) => {
      for (const o of observers) {
        if (!o.els.has(el)) continue
        const entry = { target: el, isIntersecting: visible, boundingClientRect: rect ?? { top: above ? -100 : 900, bottom: above ? -50 : 950 }, rootBounds: { top: 0, bottom: 800 } }
        o.cb([entry as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
      }
    }
  }

  it('shows only while the table is on the screen and its now row is not; its arrow points at the row; a click goes to now', async () => {
    const see = stubObserver()
    const { root, view } = await mountAt(9, 40, calendar(DAY), { calendarClock: true })
    const chip = root.querySelector<HTMLElement>('.table-now-chip')!
    const block = view.dom.querySelector('.milkdown-table-block')!
    const nowRow = view.dom.querySelector('tr.table-now-row')!
    expect(chip).not.toBeNull()
    expect(chip.hidden).toBe(true)
    see(block, true)
    see(nowRow, true)
    expect(chip.hidden).toBe(true)
    see(nowRow, false)
    // The YAZ-4163 demo: a pill with a red dot, "Now" and an arrow icon, which points at the row; its name says where.
    expect([chip.hidden, chip.textContent, chip.dataset.dir, chip.getAttribute('aria-label')]).toEqual([false, 'Now', 'down', 'Go to now, below'])
    expect(chip.querySelector('.table-now-chip__dot')).not.toBeNull()
    expect(chip.querySelector('svg')).not.toBeNull()
    see(nowRow, false, true)
    expect([chip.dataset.dir, chip.getAttribute('aria-label')]).toEqual(['up', 'Go to now, above'])
    // Scrolled out of the note but still under the tab bar (inside the window's top): above, so the arrow points up.
    see(nowRow, false, false, { top: 30, bottom: 70 })
    expect(chip.dataset.dir).toBe('up')
    // Below the note's bottom, still inside the window: down.
    see(nowRow, false, false, { top: 760, bottom: 800 })
    expect(chip.dataset.dir).toBe('down')
    see(nowRow, false, true)
    see(block, false)
    expect(chip.hidden).toBe(true)
    see(block, true)
    chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    chip.click()
    expect(caretCell(view)).toEqual({ table: 0, row: 2, col: 2 })
  })

  it('a table with `nonow` in its comment has no chip, and the part round-trips; the six-dot "Now button" sets it (the YAZ-4163 demo)', async () => {
    stubObserver()
    const off = calendar(DAY, 'calendar 30m, nonow')
    const { root, view, crepe } = await mountAt(9, 40, off, { calendarClock: true })
    expect(root.querySelector('.table-now-chip')).toBeNull()
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: calendar 30m, nonow -->')
    const field = () => tableRows(view, { inside: tablesOf(view.state.doc)[0]! + 3 } as Parameters<typeof tableRows>[1], undefined as never).find((item) => 'label' in item && item.label === 'Now button') as MenuChoiceField
    expect([field().value, field().fallback, field().choices.map((c) => c.label)]).toEqual(['off', 'on', ['On', 'Off']])
    field().run(null)
    expect(getMarkdownForSave(crepe)).toContain('<!-- table: calendar 30m -->')
    expect(root.querySelector('.table-now-chip')).not.toBeNull()
  })

  it('Settings › Calendar tables › Now button Off hides every chip: `data-table-now-button` on the app (the YAZ-4163 demo)', () => {
    const rules = [...tableCalendarCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
    const off = rules.find(({ selector }) => selector.startsWith("[data-table-now-button='off']"))
    expect(off?.selector).toContain('.table-now-chip-anchor')
    expect(off?.body).toMatch(/display:\s*none/)
  })

  it('a read-only note shows no chip, as it shows no zoom pill (YAZ-4176)', () => {
    const rules = [...tableCalendarCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))
    const off = rules.find(({ selector }) => selector.includes(".ProseMirror[contenteditable='false'] .table-now-chip-anchor"))
    expect(off?.body).toMatch(/display:\s*none/)
  })

  it('a preview (no clock) has no chip', async () => {
    stubObserver()
    const { root } = await mountAt(9, 40, calendar(DAY))
    expect(root.querySelector('.table-now-chip')).toBeNull()
  })
})
