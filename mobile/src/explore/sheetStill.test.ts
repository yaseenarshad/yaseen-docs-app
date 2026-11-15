import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * YAZ-5540: a sheet stays STILL when a sheet opens over it or closes off it (no iOS step back: no scale, no move). Only
 * the top sheet's box slides (`sheetMotion.ts`, Web Animations on `.explore-sheet__box`), so the stylesheet gives the
 * sheet itself, in any place in the stack, no transform, transition or animation.
 */
const css = readFileSync(new URL('./explore.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }))

describe('the sheet under the top one stays still (YAZ-5540)', () => {
  it('no rule for `.explore-sheet` (or its --under, --deep places) moves it', () => {
    const sheetRules = rules.filter((r) => r.sel.split(',').some((s) => /\.explore-sheet(?![_\w])/.test(s) && !s.includes('__')))
    expect(sheetRules.map((r) => r.sel)).toContain('.explore-sheet')
    for (const r of sheetRules) expect(`${r.sel} {${r.body}}`).not.toMatch(/\b(transform|transition|animation|scale|translate)\b/)
  })

  it('each sheet sits a fixed step lower than the one under it, so its top edge shows behind, still', () => {
    const sheet = rules.find((r) => r.sel === '.explore-sheet')!
    expect(sheet.body).toMatch(/top:\s*calc\([^;]*var\(--sheet-step, 0\) \* 8px\)/)
  })

  it('the first sheet rests just under the status bar: the safe-area inset, then a 12 px strip of the dimmed screen', () => {
    // YAZ-5540 (taller): from 52 px under the inset to 12 px. The inset keeps the head and its grab handle out from
    // under the notch in the Home Screen app; in a Safari tab (inset 0) the 12 px still shows the dim above the sheet.
    const sheet = rules.find((r) => r.sel === '.explore-sheet')!
    const top = /top:\s*calc\(([^;]*)\);/.exec(sheet.body)?.[1]
    expect(top).toBe('env(safe-area-inset-top, 0px) + 12px + var(--sheet-step, 0) * 8px')
  })
})
