import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'

/** Every rule of a sheet, comments gone: each selector of its list, and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))

describe('sidebar level lines CSS contract (YAZ-3309 D1, D3, D5, D7–D11)', () => {
  const rules = rulesOf(appCss)
  const LINE = ".tree[role='group']::before"

  it('one 1px grey line on each nested level of the tree, below the chevron of its folder, hidden until a gate shows it, and no target for the mouse', () => {
    const line = rules.filter((rule) => rule.selectors.includes(LINE))
    expect(line).toHaveLength(1)
    const [{ body }] = line
    expect(body).toMatch(/content:\s*'';/)
    expect(body).toMatch(/position:\s*absolute;/)
    expect(body).toMatch(/top:\s*0;/)
    expect(body).toMatch(/bottom:\s*0;/)
    // A row's indent is 8 + depth * 14 px and its chevron 14 px wide: depth * 14 + 1 is the chevron's centre.
    expect(body).toMatch(/left:\s*calc\(var\(--tree-depth\) \* 14px \+ 1px\);/)
    expect(body).toMatch(/width:\s*1px;/)
    expect(body).toMatch(/background:\s*var\(--border\);/)
    expect(body).toMatch(/opacity:\s*0;/)
    expect(body).toMatch(/transition:\s*opacity 160ms ease;/)
    expect(body).toMatch(/pointer-events:\s*none;/)
    expect(rules.find((rule) => rule.selectors.includes(".tree[role='group']"))?.body).toMatch(/position:\s*relative;/)
  })

  it('`data-sidebar-lines` on `.app` gates it: always; while the mouse is over the list or a row has keyboard focus; `off` has no rule', () => {
    // The thread's rules (below) read it too, only to turn off with "Never".
    const gated = rules.filter((rule) => rule.selectors.some((s) => s.includes('data-sidebar-lines') && !s.includes('data-sidebar-line-style')))
    expect(gated).toHaveLength(1)
    expect(gated[0].selectors).toEqual([
      `.app[data-sidebar-lines='always'] ${LINE}`,
      `.app[data-sidebar-lines='hover'] .sidebar__body:hover ${LINE}`,
      `.app[data-sidebar-lines='hover'] .sidebar__body:has(.tree__row:focus-visible) ${LINE}`,
    ])
    expect(gated[0].body.trim()).toBe('opacity: 1;')
    expect(appCss).not.toMatch(/(?<!:not\()\[data-sidebar-lines='off'\]/)
  })

  describe('Thread to the row (YAZ-3309 D7–D11)', () => {
    const STYLE = ".app[data-sidebar-line-style='thread']"
    const ON = `${STYLE}:not([data-sidebar-lines='off'])`
    const PIECE = `${ON} .sidebar__body .tree[role='group'] > li::before`
    const PIECE_HOVER = `${ON} .sidebar__body .tree[role='group'] > li:hover::before`
    const CHEVRON = `${ON} .sidebar__body li[aria-expanded]:hover > .tree__row .tree__chevron::before`
    const THREAD = /var\(--sidebar-thread-color, var\(--thread-color, var\(--accent\)\)\)/
    /** The reduced-motion block of the thread, and the sheet without it. */
    const media = (() => {
      const start = [...appCss.matchAll(/@media \(prefers-reduced-motion: reduce\) \{/g)].map((m) => m.index).find((i) => appCss.slice(i, i + 400).includes('data-sidebar-line-style'))
      expect(start).toBeDefined()
      let depth = 0
      let end = start!
      for (let i = appCss.indexOf('{', start); i < appCss.length; i++) {
        if (appCss[i] === '{') depth++
        if (appCss[i] === '}' && --depth === 0) {
          end = i + 1
          break
        }
      }
      return { start: start!, block: rulesOf(appCss.slice(appCss.indexOf('{', start) + 1, end - 1)), rest: rulesOf(appCss.slice(0, start) + appCss.slice(end)) }
    })()
    const body = (selector: string) => media.rest.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body)
    const threadRules = media.rest.filter((rule) => rule.selectors.some((s) => s.includes('data-sidebar-line-style')))

    it('each nested level clips what pokes above its top and is its own stacking context; the grey line is z 1, the thread z 2; every rule waits for the style `thread`', () => {
      expect(threadRules.length).toBeGreaterThan(0)
      for (const { selectors } of threadRules) for (const s of selectors) expect(s, s).toMatch(/^\.app\[data-sidebar-line-style='thread'\]/)
      const [group] = body(`${STYLE} .tree[role='group']`)
      expect(group).toMatch(/z-index:\s*0;/)
      expect(group).toMatch(/overflow-y:\s*clip;/)
      expect(body(`${STYLE} .tree[role='group']::before`)[0]).toMatch(/z-index:\s*1;/)
      expect(body(`${STYLE} .tree[role='group'] > li`)[0]).toMatch(/position:\s*relative;/)
    })

    it('one piece for each li on the hover path: z 2 over the grey line, no target, the thread colour with its two fallbacks, the editor\'s width, a 6px elbow; "Never" turns it off', () => {
      const [piece] = body(PIECE)
      expect(piece).toMatch(/z-index:\s*2;/)
      expect(piece).toMatch(/pointer-events:\s*none;/)
      expect(piece).toMatch(/opacity:\s*0;/)
      expect(piece).toMatch(/position:\s*absolute;/)
      expect(piece).toMatch(/left:\s*calc\(var\(--tree-depth\) \* 14px \+ 1px - var\(--thread-width, 2px\) \/ 2\);/)
      expect(piece).toMatch(/border-bottom-left-radius:\s*6px;/)
      for (const side of ['border-left', 'border-bottom']) expect(piece).toMatch(new RegExp(`${side}:\\s*var\\(--thread-width, 2px\\) solid ${THREAD.source}`))
      expect(body(PIECE_HOVER)[0]).toMatch(/opacity:\s*1;/)
      expect(body(CHEVRON)[0]).toMatch(new RegExp(`border-color:\\s*${THREAD.source}`))
      // Each rule that draws (it sets a look, not only a width) is off with "Show: Never".
      for (const { selectors } of threadRules.filter((rule) => /content:|opacity:\s*1|border-color:/.test(rule.body))) for (const s of selectors) expect(s, s).toContain(ON)
    })

    it('calm (D10): it shows after an 80ms rest and fades in over 140ms, fades out over 180ms with no wait; the wait is on `:hover` alone', () => {
      expect(body(PIECE)[0]).toMatch(/transition:\s*opacity 180ms ease;/)
      expect(body(PIECE_HOVER)[0]).toMatch(/transition:\s*opacity 140ms ease 80ms;/)
      expect(body(CHEVRON)[0]).toMatch(/transition:\s*transform 0\.12s, border-color 140ms ease 80ms;/)
      for (const { selectors } of threadRules.filter((rule) => /\b80ms\b/.test(rule.body))) for (const s of selectors) expect(s, s).toContain(':hover')
    })

    it('Reduce motion (D10): the block names every selector of a rule that fades, so it wins by coming last, and it fades nothing; the chevron keeps its turn', () => {
      const fades = threadRules.filter((rule) => /transition:[^;]*\d+ms/.test(rule.body))
      expect(fades.length).toBe(3)
      const inBlock = media.block.flatMap((rule) => rule.selectors)
      for (const { selectors } of fades) for (const s of selectors) expect(inBlock, s).toContain(s)
      for (const rule of media.block) expect(rule.body, rule.selectors.join()).not.toMatch(/\d+ms/)
      expect(media.block.find((rule) => rule.selectors.includes(PIECE))?.body).toMatch(/transition:\s*none;/)
      expect(media.block.find((rule) => rule.selectors.includes(CHEVRON))?.body).toMatch(/transition:\s*transform 0\.12s;/)
      // The block comes after each rule it must beat (their first place in the sheet).
      for (const s of [PIECE, PIECE_HOVER, CHEVRON]) expect(appCss.indexOf(s), s).toBeLessThan(media.start)
    })

    it('the mouse alone draws it (D11): no thread rule reads keyboard focus, and no hover selector uses `:has(`', () => {
      for (const { selectors } of [...threadRules, ...media.block]) {
        for (const s of selectors) {
          expect(s, s).not.toMatch(/focus/)
          if (s.includes(':hover')) expect(s, s).not.toContain(':has(')
        }
      }
    })
  })

  it('Recents and Sessions nest a `.tree` with no role: no rule draws on a `.tree` inside a `.tree` (D4)', () => {
    for (const { selectors } of rules) for (const selector of selectors) expect(selector, selector).not.toMatch(/\.tree\s+\.tree/)
  })
})
