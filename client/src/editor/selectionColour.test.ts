/**
 * One selection colour (YAZ-5902 D1, YAZ-5941): the text of every Crepe surface shows the Mac's highlight, as a card page does.
 * Read as text: jsdom computes no imported sheet.
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { rules } from './cssRules'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const appCss = read('../app.css')
const reset = read('../../../node_modules/@milkdown/crepe/lib/theme/common/reset.css')
const body = (css: string, selector: string) => rules(css, selector).find((r) => r.selector.trim() === selector)?.body ?? ''

it('selected text in the editor takes the browser`s own colour, as outside it; Crepe`s rule is the one it undoes', () => {
  expect(body(reset, '.milkdown .ProseMirror *::selection')).toContain('var(--crepe-color-selected)')
  expect(body(appCss, '.milkdown .ProseMirror *::selection')).toMatch(/background:\s*revert;/)
})

it('the boxes the editor paints (the lit pill, selected cells) take `Highlight`, and in dark the Mac`s colour at 0.8, as the browser paints selected text', () => {
  expect(body(appCss, '.milkdown .ProseMirror')).toMatch(/--crepe-color-selected:\s*Highlight;/)
  const dark = body(appCss, "[data-theme='dark'] .milkdown .ProseMirror")
  // YAZ-5941: `--mac-selection` (lib/macSelection.ts) at 0.8 alpha; unset, the tint is invalid and the fixed blue applies.
  expect(dark).toMatch(/--mac-selection-tint:\s*rgb\(from var\(--mac-selection\) r g b \/ 0\.8\);/)
  expect(dark).toMatch(/--crepe-color-selected:\s*var\(--mac-selection-tint, #3f5573\);/)
  expect(body(read('./wikilink/wikilink.css'), '.wikilink.wikilink--selected')).toContain('var(--crepe-color-selected)')
  expect(read('./table/table.css').match(/var\(--crepe-color-selected\)/g)?.length).toBeGreaterThanOrEqual(2)
})

it('a quote`s bar keeps the theme`s grey, and the menu strip keeps its own hover token', () => {
  expect(body(appCss, '.milkdown')).toMatch(/--crepe-color-pressed:\s*var\(--crepe-color-selected\)/)
  const bar = rules(appCss, 'blockquote::before').find((r) => r.selector.includes('.milkdown .ProseMirror blockquote::before'))
  expect(bar?.body).toContain('var(--crepe-color-pressed)')
  expect(rules(appCss, '.ctx-menu__strip').some((r) => /--crepe-color-selected:\s*var\(--bg-hover-row\)/.test(r.body))).toBe(true)
})
