/**
 * Settings › Review › Weights (YAZ-4964), read as text (jsdom lays out no CSS): the box grows to its text, so all 21
 * numbers show with no scroll, and its width stays the row's, so it never runs past the panel's side.
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { rules } from '../editor/cssRules'

// Through a helper: a `new URL('./x.css', import.meta.url)` literal is an asset URL to Vite, not a file URL.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const css = read('./settings.css')
const body = (selector: string): string => rules(css, selector).find((r) => r.selector === selector)?.body ?? ''

it('the weights box grows to its text and keeps the row`s width', () => {
  const list = body('.settings__input--list')
  expect(list).toMatch(/field-sizing:\s*content/)
  expect(list).toMatch(/max-width:\s*100%/)
  // No fixed height and no width of its own: the field's 100% (`.settings__input`) holds it to the panel.
  expect(list).not.toMatch(/(^|[\s;])(height|width):/)
  expect(body('.settings__input')).toMatch(/width:\s*100%/)
})

// YAZ-5972 nit: with the colour box open, the row is tall, and the "Colour" label sat in its middle, beside the box.
// It lines up with the row's first line of buttons instead: the row aligns to the top, the label one button high.
it('a pill colour row with its colour box open keeps its label at the top, on the buttons` line', () => {
  const open = '.pill-toolbar__row:has(.pill-toolbar__custom-box:not([hidden]))'
  expect(body(open)).toMatch(/align-items:\s*flex-start/)
  const label = body(`${open} > .pill-toolbar__label`)
  expect(label).toMatch(/display:\s*flex/)
  expect(label).toMatch(/align-items:\s*center/)
  expect(label).toMatch(/min-height:\s*28px/)
})

// YAZ-6575: Menu icons Off must hide both SVG glyphs and .file-icon rows inside .ctx-menu and scope gutter collapse
// to .ctx-menu.ctx-menu--glyphs so swatch/style dropdowns (.view-style__panel, .cal-line__panel) stay aligned.
it('YAZ-6575: [data-menu-icons=off] hides svg and file-icon inside .ctx-menu and scopes gutter reset to .ctx-menu.ctx-menu--glyphs', () => {
  const appCss = read('../app.css')
  const offHideRules = rules(appCss, "[data-menu-icons='off']").filter((r) => /display:\s*none/.test(r.body))
  expect(offHideRules.some((r) => r.selector.includes('.ctx-menu .ctx-menu__label > svg'))).toBe(true)
  expect(offHideRules.some((r) => r.selector.includes('.ctx-menu .ctx-menu__label > .file-icon'))).toBe(true)

  const offPadRules = rules(appCss, "[data-menu-icons='off']").filter((r) => /padding-left:\s*10px/.test(r.body))
  expect(offPadRules.length).toBeGreaterThan(0)
  for (const r of offPadRules) {
    for (const part of r.selector.split(',')) {
      expect(part.trim()).toMatch(/\.ctx-menu(\.ctx-menu--editor)?\.ctx-menu--glyphs/)
    }
  }
})
