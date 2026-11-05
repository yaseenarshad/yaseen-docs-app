import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'

/** Every rule of a sheet, comments gone: each selector of its list, and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))
const bodyOf = (selector: string): string => rulesOf(appCss).filter((r) => r.selectors.includes(selector)).map((r) => r.body).join(';')

describe('the Focus and Sessions bar stays one line (YAZ-4462)', () => {
  it('its words cut with an ellipsis, and its button never shrinks: "N in focus · workspace list" cannot wrap in a narrow sidebar', () => {
    expect(bodyOf('.sidebar__focus-bar > span')).toMatch(/white-space:\s*nowrap/)
    expect(bodyOf('.sidebar__focus-bar > span')).toMatch(/overflow:\s*hidden/)
    expect(bodyOf('.sidebar__focus-bar > span')).toMatch(/text-overflow:\s*ellipsis/)
    expect(bodyOf('.sidebar__focus-bar > span')).toMatch(/min-width:\s*0/)
    expect(bodyOf('.sidebar__focus-clear')).toMatch(/flex:\s*none/)
  })
})
