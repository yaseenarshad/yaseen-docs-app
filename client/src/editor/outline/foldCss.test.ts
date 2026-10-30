/**
 * The CSS weight of the two fold rules (YAZ-3696 B1, D11). jsdom applies no cascade, so this holds the
 * selectors to the contract in words: a folded block's `display: none` must outrank Crepe's own
 * `display: block` on a table block and a code block (`.milkdown .milkdown-table-block`, 0,2,0), or
 * the table stays on screen under a folded heading or bullet.
 */
import { describe, expect, it } from 'vitest'
import headingCss from './headingFolding.css?inline'
import outlineCss from './outlineFolding.css?inline'
import crepeTableCss from '@milkdown/crepe/theme/common/table.css?inline'
import crepeCodeCss from '@milkdown/crepe/theme/common/code-mirror.css?inline'

const rules = (css: string) =>
  [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    selectors: sel.split(',').map((s) => s.trim()),
    body,
  }))

/** Classes, attributes and pseudo-classes: the only middle-column parts these selectors use. */
const weight = (selector: string) => (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length

const hidingSelector = (css: string, attr: string) => {
  const rule = rules(css).find(({ selectors, body }) => selectors.some((s) => s.includes(`[${attr}='true']`)) && /display:\s*none/.test(body))
  if (rule === undefined) throw new Error(`no display:none rule for ${attr}`)
  return rule.selectors.find((s) => s.includes(attr)) as string
}

const crepeDisplayWeight = (css: string, cls: string) => {
  const rule = rules(css).find(({ selectors, body }) => selectors.includes(`.milkdown .${cls}`) && /display:\s*block/.test(body))
  if (rule === undefined) throw new Error(`no Crepe display rule for ${cls}`)
  return weight(`.milkdown .${cls}`)
}

describe('fold CSS weight (YAZ-3696 B1, D11)', () => {
  it.each([
    ['B1: a heading fold', headingCss, 'data-heading-folded'],
    ['D11: a bullet fold', outlineCss, 'data-outline-folded'],
  ])('%s outranks Crepe’s table block and code block', (_name, css, attr) => {
    const selector = hidingSelector(css, attr)
    expect(selector).toBe(`.editor-instance .milkdown [${attr}='true']`)
    expect(weight(selector)).toBeGreaterThan(crepeDisplayWeight(crepeTableCss, 'milkdown-table-block'))
    expect(weight(selector)).toBeGreaterThan(crepeDisplayWeight(crepeCodeCss, 'milkdown-code-block'))
  })

  it('the zoom rule that shows a folded ancestor’s children still outranks the bullet fold (GRO-2029)', async () => {
    const zoomCss = (await import('./zoom.css?inline')).default
    const show = rules(zoomCss).find(({ selectors, body }) => selectors.some((s) => s.includes('data-outline-folded')) && /display:\s*block/.test(body))
    expect(weight(show?.selectors[0] ?? '')).toBeGreaterThan(weight(hidingSelector(outlineCss, 'data-outline-folded')))
  })
})
