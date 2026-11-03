import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'
import tableCss from './editor/table/table.css?inline'

/** Every rule of a sheet, comments gone: its selector and its body. */
const rulesOf = (css: string): { selector: string; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))

const zIndex = (body: string): number => Number(/z-index:\s*(\d+)/.exec(body)?.[1] ?? 0)

describe('the note stays under its bar (YAZ-4271)', () => {
  it('`.editor-host` is its own stacking level, so a frozen table row never rises over the page cog menu', () => {
    const host = rulesOf(appCss).filter(({ selector }) => selector === '.editor-host')
    expect(host.some(({ body }) => /isolation:\s*isolate;/.test(body))).toBe(true)
    // The case that broke: the frozen row's z-index was as high as the bar's, and the row comes later in the page.
    const bar = rulesOf(appCss).find(({ selector }) => selector === '.status-chips')!
    const frozen = rulesOf(tableCss).find(({ selector }) => selector.endsWith('.table-frozen-row'))
    expect(zIndex(bar.body)).toBeGreaterThan(0)
    expect(frozen === undefined || zIndex(frozen.body) >= zIndex(bar.body)).toBe(true)
  })
})
