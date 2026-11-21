/**
 * views.css read as text (the YAZ-4820 checker's two asks): a Strong black card is solid black (YAZ-4906: "how come i have
 * black selected but its not black?"), and the shared dropdown list opens OVER the folder ⚙ placed on the page
 * (YAZ-4909: "bug for where it shows up wtf").
 */
import { describe, expect, it } from 'vitest'
import viewsCss from '../views.css?inline'
import appCss from '../../app.css?inline'

const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ selectors: sel.split(/,(?![^(]*\))/).map((s) => s.trim()), body }))
/** The value of `prop` in the last rule that names `selector` and sets it. */
const decl = (css: string, selector: string, prop: string): string | undefined =>
  rules(css)
    .filter(({ selectors }) => selectors.includes(selector))
    .map(({ body }) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+);`))?.[1]?.trim())
    .filter((value) => value !== undefined)
    .at(-1)

describe('a black card (YAZ-4906)', () => {
  it('Strong black is solid black (100 %), Light 30 %, Medium 60 %: five times the strength, as the header row\'s Black', () => {
    const card = (strength: string) => decl(viewsCss, `:is(.view-cal__card, .view-board__card)[data-color='black'][data-color-strength='${strength}']`, '--card-wash')
    expect(card('strong')).toBe('100%')
    expect(card('medium')).toBe('60%')
    expect(card('light')).toBe('30%')
    expect(decl(viewsCss, ":is(.view-cal__card, .view-board__card)[data-color-strength='strong']", '--card-wash')).toBe('50%')
  })
})

describe('the shared dropdown list (YAZ-4909)', () => {
  it('opens over the folder ⚙ placed on the page: its z-index is above the ⚙ menu\'s', () => {
    const list = Number(decl(viewsCss, '.view-dropdown__panel.view-popover', 'z-index'))
    const cog = Number(decl(appCss, '.page-settings__menu.page-settings__menu--placed', 'z-index'))
    expect(cog).toBe(1000)
    expect(list).toBe(1001)
    expect(list).toBeGreaterThan(cog)
  })
})
