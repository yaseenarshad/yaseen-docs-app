import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'
import tocCss from './editor/toc/toc.css?inline'

/** Every rule of a sheet, comments gone: its selector and its body. */
const rulesOf = (css: string): { selector: string; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }))

describe('scrollbar CSS contract (YAZ-2700 D11)', () => {
  const rules = rulesOf(appCss)
  const blocks = (selector: string): string[] => rules.filter((rule) => rule.selector === selector).map(({ body }) => body)

  it('each theme tells the system which one it is and names its own thumb: black at 40% in the light theme, white at 20% in the dark one, and no track', () => {
    const light = blocks(':root').find((body) => /color-scheme/.test(body))
    const dark = blocks("[data-theme='dark']").find((body) => /color-scheme/.test(body))
    expect(light).toMatch(/color-scheme:\s*light;/)
    expect(light).toMatch(/--scrollbar-thumb:\s*rgba\(0, 0, 0, 0\.4\);/)
    expect(dark).toMatch(/color-scheme:\s*dark;/)
    expect(dark).toMatch(/--scrollbar-thumb:\s*rgba\(255, 255, 255, 0\.2\);/)
    // ONE declaration paints both themes: it is inherited from the root, and the dark block only swaps the token.
    expect(light).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\) transparent;/)
    expect(dark).not.toMatch(/scrollbar-color/)
  })

  it('every scroller is thin, a scroller that hides its bar stays hidden, and the palette blocks are still the first of their kind', () => {
    // `scrollbar-width` is not inherited, hence the `*` — which has no weight, so any class wins over it.
    expect(blocks('*').some((body) => /^\s*scrollbar-width:\s*thin;\s*$/.test(body))).toBe(true)
    const hidden = [...rules, ...rulesOf(tocCss)].filter(({ body }) => /scrollbar-width:\s*none;/.test(body))
    expect(hidden.map(({ selector }) => selector)).toEqual(expect.arrayContaining(['.scroll-strip', '.toc__names']))
    for (const { selector } of hidden) expect(selector, selector).toMatch(/\.[\w-]+/)
    // Chromium drops `::-webkit-scrollbar` on an element that has `scrollbar-width` or `scrollbar-color`: a bar hidden that way would come back.
    expect(appCss).not.toMatch(/::-webkit-scrollbar\s*\{/)
    // codeBlock.test.ts and the palette's other readers take the FIRST `:root` and the FIRST dark block: those stay the palette.
    expect(blocks(':root')[0]).toMatch(/--bg:\s*#ffffff;/)
    expect(blocks(':root')[0]).not.toMatch(/color-scheme/)
    expect(blocks("[data-theme='dark']")[0]).toMatch(/--bg:\s*#1e1e1e;/)
    expect(blocks("[data-theme='dark']")[0]).not.toMatch(/color-scheme/)
  })
})
