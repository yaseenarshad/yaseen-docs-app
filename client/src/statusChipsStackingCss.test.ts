import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'
import tableCss from './editor/table/table.css?inline'
import calendarCss from './editor/table/tableCalendar.css?inline'
import tocCss from './editor/toc/toc.css?inline'

/** Every rule of a sheet, comments gone: its selector and its body. */
const rulesOf = (css: string): { selector: string; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))

/** The z-index of the first rule whose selector ends with `end`. */
const zOf = (css: string, end: string): number => {
  const rule = rulesOf(css).find(({ selector }) => selector.endsWith(end))
  expect(rule, end).toBeDefined()
  return Number(/z-index:\s*(\d+)/.exec(rule!.body)?.[1] ?? 0)
}

describe('the bar\'s menus stay above the page (YAZ-4271)', () => {
  it('`.status-chips` is above every layer in the page: a frozen table row, the Now chip, the cell note card and its grips', () => {
    const bar = zOf(appCss, '.status-chips')
    const layers = {
      frozenRow: zOf(tableCss, '.table-frozen-row'),
      nowChip: zOf(calendarCss, '.table-now-chip-anchor'),
      card: zOf(tableCss, '.cell-note.cell-note--open'),
      grips: zOf(tableCss, '.cell-note-card-grips'),
    }
    for (const [name, z] of Object.entries(layers)) expect(bar, name).toBeGreaterThan(z)
  })

  it('the page is no stacking level of its own: the table of contents (z 1) and the card (z 5) keep their order', () => {
    const host = rulesOf(appCss).filter(({ selector }) => selector === '.editor-host')
    expect(host.some(({ body }) => /isolation:\s*isolate/.test(body))).toBe(false)
    expect(zOf(tocCss, '.toc')).toBeLessThan(zOf(tableCss, '.cell-note.cell-note--open'))
  })
})
