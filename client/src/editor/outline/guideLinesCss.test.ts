import { describe, expect, it } from 'vitest'
import guideCss from './guideLines.css?inline'
import threadCss from './bulletThreading.css?inline'

/** Every rule of a sheet, comments gone: each selector of its list (split at the commas outside `:is(…)`), and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(/,(?![^(]*\))/).map((s) => s.trim()), body }))

const STRIP = '.milkdown .milkdown-list-item-block li.list-item > .children > .content-dom > :is(ul, ol)::before'

describe('guide lines CSS contract (YAZ-4094 D2–D4, G2, G3)', () => {
  const rules = rulesOf(guideCss)
  const bodyOf = (selector: string) => rules.find((rule) => rule.selectors.includes(selector))?.body ?? ''

  it('G3: the line and its hover take Settings › Outline › "Guide line darkness", 15% and 35% when absent', () => {
    expect(bodyOf(`.editor-instance ${STRIP}`)).toContain('color-mix(in srgb, currentColor var(--guide-line-darkness, 15%), transparent)')
    expect(bodyOf(`.editor-instance .milkdown .milkdown-list-item-block li.list-item > .children > .content-dom > :is(ul, ol).outline-guide-hover::before`)).toContain('var(--guide-line-darkness-hover, 35%)')
  })

  it('D2, D3: Off removes the strip itself — the page’s own choice, or the app default where the page made none — so no line, no hover and no click', () => {
    const off = rules.find((rule) => rule.body.includes('content: none'))
    expect(off?.selectors).toEqual([
      `.editor-host[data-guide-lines='off'] .editor-instance ${STRIP}`,
      `.app[data-guide-lines='off'] .editor-instance:not(.editor-host[data-guide-lines='on'] .editor-instance) ${STRIP}`,
    ])
  })

  it('G2: "Only near the mouse" hides the line, not the strip, while the mouse is off the note', () => {
    const near = rules.find((rule) => rule.selectors.some((s) => s.includes("data-guide-lines-show='near'")))
    expect(near?.selectors).toEqual([".app[data-guide-lines-show='near'] .editor-instance .milkdown > .ProseMirror:not(:hover) .milkdown-list-item-block li.list-item > .children > .content-dom > :is(ul, ol)::before"])
    expect(near?.body.trim()).toBe('background-image: none;')
  })

  it('D4: the thread draws its own path and does not depend on the guide lines', () => {
    expect(threadCss).not.toContain('data-guide-lines')
  })
})
