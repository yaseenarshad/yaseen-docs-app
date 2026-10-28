import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'

/** Every rule of a sheet, comments gone: each selector of its list, and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))

describe('sidebar level lines CSS contract (YAZ-3309 D1, D3, D5, D7–D11)', () => {
  const rules = rulesOf(appCss)
  const LINE = ".tree[role='group']::before"
  /** The reduced-motion block of the lines and the thread, and the sheet without it. */
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
  /** A rule's number in px, for example `top: 8.75px`. */
  const px = (b: string, prop: string) => Number(new RegExp(`(?:^|[;\\s])${prop}:\\s*(-?[\\d.]+)px`).exec(b)?.[1])
  // The row and the chevron, read from the sheet: the copy and the elbow follow them (audit item 12).
  const rowBody = body('.tree__row')[0]
  const rowHeight = px(rowBody, 'font-size') * Number(/line-height:\s*([\d.]+);/.exec(rowBody)?.[1]) + 2 * Number(/padding:\s*([\d.]+)px/.exec(rowBody)?.[1])
  const chevronTop = (rowHeight - px(body('.tree__chevron')[0], 'height')) / 2

  it('one 1px grey line on each nested level of the tree, below the chevron of its folder, hidden until a gate shows it, and no target for the mouse', () => {
    const line = body(LINE).filter((b) => /content:/.test(b))
    expect(line).toHaveLength(1)
    const [lineBody] = line
    expect(lineBody).toMatch(/content:\s*'';/)
    expect(lineBody).toMatch(/position:\s*absolute;/)
    expect(lineBody).toMatch(/top:\s*0;/)
    expect(lineBody).toMatch(/bottom:\s*0;/)
    // A row's indent is 8 + depth * 14 px and its chevron 14 px wide: depth * 14 + 1 is the chevron's centre.
    expect(lineBody).toMatch(/left:\s*calc\(var\(--tree-depth\) \* 14px \+ 1px\);/)
    expect(lineBody).toMatch(/width:\s*1px;/)
    expect(lineBody).toMatch(/background:\s*var\(--border\);/)
    expect(lineBody).toMatch(/opacity:\s*0;/)
    expect(lineBody).toMatch(/transition:\s*opacity 160ms ease;/)
    expect(lineBody).toMatch(/pointer-events:\s*none;/)
    expect(rules.find((rule) => rule.selectors.includes(".tree[role='group']"))?.body).toMatch(/position:\s*relative;/)
  })

  it('`data-sidebar-lines` on `.app` gates it: always; while the mouse is over the list or a row has keyboard focus (the attributes `data-mouse-in` and `data-key-focus` on the list); `off` has no rule', () => {
    // The thread's rules (below) read it too, only to turn off with "Never".
    const gated = rules.filter((rule) => rule.selectors.some((s) => s.includes('data-sidebar-lines') && !s.includes('data-sidebar-line-style')))
    expect(gated).toHaveLength(1)
    expect(gated[0].selectors).toEqual([
      `.app[data-sidebar-lines='always'] ${LINE}`,
      // The two attributes that `levelLinesHover.ts` writes on the list (bug YAZ-3329).
      `.app[data-sidebar-lines='hover'] .sidebar__body[data-mouse-in] ${LINE}`,
      `.app[data-sidebar-lines='hover'] .sidebar__body[data-key-focus] ${LINE}`,
    ])
    expect(gated[0].body.trim()).toBe('opacity: 1;')
    expect(appCss).not.toMatch(/(?<!:not\()\[data-sidebar-lines='off'\]/)
  })

  describe('Thread to the row (YAZ-3309 D7–D11)', () => {
    const STYLE = ".app[data-sidebar-line-style='thread']"
    const ON = `${STYLE}:not([data-sidebar-lines='off'])`
    const PIECE = `${ON} .sidebar__body .tree[role='group'] > li::before`
    const PIECE_HOVER = `${ON} .sidebar__body .tree[role='group'] > li:hover::before`
    const CHEVRON_REST = `${ON} .sidebar__body .tree > li[aria-expanded]:not([data-renaming])::after`
    const CHEVRON_OPEN = `${ON} .sidebar__body .tree > li[aria-expanded='true']:not([data-renaming])::after`
    const CHEVRON = `${ON} .sidebar__body .tree > li[aria-expanded]:not([data-renaming]):hover::after`
    // "Smooth" (YAZ-3440 D6): the 0.12s turn of before, by choice only.
    const SMOOTH = `${ON}[data-sidebar-arrow='smooth']`
    const CHEVRON_SMOOTH_REST = `${SMOOTH} .sidebar__body .tree > li[aria-expanded]:not([data-renaming])::after`
    const CHEVRON_SMOOTH = `${SMOOTH} .sidebar__body .tree > li[aria-expanded]:not([data-renaming]):hover::after`
    const GREY_SMOOTH = ".app[data-sidebar-arrow='smooth'] .tree__chevron::before"
    // One custom property holds the colour chain of D9: its own, else Bullet threading's, else the accent.
    const THREAD = /var\(--sidebar-thread\)/
    const threadRules = media.rest.filter((rule) => rule.selectors.some((s) => s.includes('data-sidebar-line-style')))

    it('each nested level clips what pokes above its top and is its own stacking context; the grey line is z 1, the thread z 2; every rule waits for the style `thread`', () => {
      expect(threadRules.length).toBeGreaterThan(0)
      for (const { selectors } of threadRules) for (const s of selectors) expect(s, s).toMatch(/^\.app\[data-sidebar-line-style='thread'\]/)
      const [group] = body(`${STYLE} .tree[role='group']`)
      // z 3 in its parent's (YAZ-3440 D1): a row stuck inside it stays over the parent's line (z 1) and thread (z 2).
      expect(group).toMatch(/z-index:\s*3;/)
      expect(group).toMatch(/overflow-y:\s*clip;/)
      expect(body(`${STYLE} .tree[role='group']::before`)[0]).toMatch(/z-index:\s*1;/)
      // One rule makes each li of the tree hold its pieces; Recents and Sessions have no `role='tree'`.
      expect(body(`${STYLE} .tree[role='tree'] li`)[0]).toMatch(/position:\s*relative;/)
      expect(body(STYLE)[0]).toMatch(/--sidebar-thread:\s*var\(--sidebar-thread-color, var\(--thread-color, var\(--accent\)\)\);/)
    })

    it('one piece for each li on the hover path: z 2 over the grey line, no target, the thread colour, the editor\'s width, a 6px elbow at the middle of its row; "Never" turns it off', () => {
      const [piece] = body(PIECE)
      expect(piece).toMatch(/z-index:\s*2;/)
      expect(piece).toMatch(/pointer-events:\s*none;/)
      expect(piece).toMatch(/opacity:\s*0;/)
      expect(piece).toMatch(/position:\s*absolute;/)
      expect(piece).toMatch(/left:\s*calc\(var\(--tree-depth\) \* 14px \+ 1px - var\(--thread-width\) \/ 2\);/)
      // The elbow is at the middle of its own row (audit item 12): the height reaches down to it.
      expect(piece).toMatch(new RegExp(`height:\\s*calc\\(100000px \\+ ${rowHeight / 2}px \\+ var\\(--thread-width\\) / 2\\);`))
      expect(piece).toMatch(/top:\s*-100000px;/)
      expect(piece).toMatch(/border-bottom-left-radius:\s*6px;/)
      for (const side of ['border-left', 'border-bottom']) expect(piece).toMatch(new RegExp(`${side}:\\s*var\\(--thread-width\\) solid ${THREAD.source}`))
      // No fallback for the width: App always sets `--thread-width` on `.app` (audit item 5).
      expect(appCss).not.toMatch(/var\(--thread-width,/)
      expect(body(PIECE_HOVER)[0]).toMatch(/opacity:\s*1;/)
      for (const side of ['border-right', 'border-bottom']) expect(body(CHEVRON_REST)[0]).toMatch(new RegExp(`${side}:\\s*1\\.75px solid ${THREAD.source}`))
      expect(body(CHEVRON_REST)[0]).toMatch(/opacity:\s*0;/)
      expect(body(CHEVRON_REST)[0]).toMatch(/pointer-events:\s*none;/)
      expect(body(CHEVRON)[0]).toMatch(/opacity:\s*1;/)
      // Each rule that draws (it sets a look, not only a width) is off with "Show: Never".
      for (const { selectors } of threadRules.filter((rule) => /content:|opacity:\s*1/.test(rule.body))) for (const s of selectors) expect(s, s).toContain(ON)
    })

    it('calm (D10): it shows after an 80ms rest and fades in over 140ms, fades out over 180ms with no wait; the wait is on `:hover` alone; the arrow turns at once unless "Smooth" (YAZ-3440 D6)', () => {
      expect(body(PIECE)[0]).toMatch(/transition:\s*opacity 180ms ease;/)
      expect(body(PIECE_HOVER)[0]).toMatch(/transition:\s*opacity 140ms ease 80ms;/)
      expect(body(CHEVRON_REST)[0]).not.toMatch(/transition:/)
      expect(body(CHEVRON)[0]).toMatch(/transition:\s*opacity 140ms ease 80ms;/)
      expect(rules.find((rule) => rule.selectors.includes('.tree__chevron::before'))?.body).not.toMatch(/transition:/)
      expect(body(GREY_SMOOTH)[0]).toMatch(/transition:\s*transform 0\.12s;/)
      expect(body(CHEVRON_SMOOTH_REST)[0]).toMatch(/transition:\s*transform 0\.12s;/)
      expect(body(CHEVRON_SMOOTH)[0]).toMatch(/transition:\s*transform 0\.12s, opacity 140ms ease 80ms;/)
      for (const { selectors } of threadRules.filter((rule) => /\b80ms\b/.test(rule.body))) for (const s of selectors) expect(s, s).toContain(':hover')
    })

    it('Reduce motion (D10): the block names every selector of a rule that fades, the grey line\'s too (as toc.css does), so it wins by coming last, and it fades nothing; the arrows turn at once even with "Smooth" (YAZ-3440 D6)', () => {
      const fades = [...threadRules, ...media.rest.filter((rule) => rule.selectors.includes(LINE))].filter((rule) => /transition:[^;]*\d+ms/.test(rule.body))
      // The four of before, "Smooth" (YAZ-3440 D6), and the open row's elbow and arrow copies at rest and on hover (D1).
      expect(fades.length).toBe(9)
      const inBlock = media.block.flatMap((rule) => rule.selectors)
      for (const { selectors } of fades) for (const s of selectors) expect(inBlock, s).toContain(s)
      for (const rule of media.block) expect(rule.body, rule.selectors.join()).not.toMatch(/\d+ms/)
      expect(media.block.find((rule) => rule.selectors.includes(PIECE))?.body).toMatch(/transition:\s*none;/)
      expect(media.block.find((rule) => rule.selectors.includes(LINE))?.body).toMatch(/transition:\s*none;/)
      for (const s of [CHEVRON, CHEVRON_SMOOTH_REST, CHEVRON_SMOOTH, GREY_SMOOTH]) expect(media.block.find((rule) => rule.selectors.includes(s))?.body, s).toMatch(/transition:\s*none;/)
      // The block comes after each rule it must beat (their first place in the sheet).
      for (const s of [LINE, PIECE, PIECE_HOVER, CHEVRON, CHEVRON_SMOOTH_REST, CHEVRON_SMOOTH, GREY_SMOOTH]) expect(appCss.indexOf(s), s).toBeLessThan(media.start)
    })

    it('the coloured chevron is a copy of the grey one, laid exactly on it: the same box, border and turn, at the chevron\'s place in its row (D7, bug YAZ-3329)', () => {
      const grey = rules.find((rule) => rule.selectors.includes('.tree__chevron::before'))!.body
      const greyOpen = rules.find((rule) => rule.selectors.includes('.tree__chevron--open::before'))!.body
      const rest = body(CHEVRON_REST)[0]
      const open = body(CHEVRON_OPEN)[0]
      for (const prop of ['width', 'height']) expect(px(rest, prop), prop).toBe(px(grey, prop))
      expect(grey).toMatch(/border-right:\s*1\.75px solid/)
      expect(grey).toMatch(/transform:\s*rotate\(-45deg\);/)
      expect(rest).toMatch(/transform:\s*rotate\(-45deg\);/)
      expect(greyOpen).toMatch(/transform:\s*rotate\(45deg\);/)
      expect(open).toMatch(/transform:\s*rotate\(45deg\);/)
      // The chevron is centred in its row (both read from the sheet), 8 + depth * 14 px in.
      expect([rowHeight, chevronTop]).toEqual([25.5, 5.75])
      expect(rest).toMatch(new RegExp(`left:\\s*calc\\(var\\(--tree-depth, 0\\) \\* 14px \\+ ${8 + px(grey, 'left')}px\\);`))
      expect(px(rest, 'top')).toBe(chevronTop + px(grey, 'top'))
      expect(px(open, 'top')).toBe(chevronTop + px(greyOpen, 'top'))
    })

    it('bug YAZ-3342: a folder in inline rename (`li[data-renaming]`, its row is the input) draws no coloured chevron, and its elbow stops 2px short of the input, as a folder\'s stops short of its chevron', () => {
      const afters = threadRules.filter((rule) => rule.selectors.some((s) => s.endsWith('::after')))
      // The rest, open and hover copies, the rest and hover copies of "Smooth" (YAZ-3440 D6), and the open row's own (D1).
      expect(afters.length).toBe(7)
      for (const { selectors } of [...afters, ...media.block.filter((rule) => rule.selectors.some((s) => s.endsWith('::after')))]) for (const s of selectors) expect(s, s).toContain(':not([data-renaming])')
      // The input starts where the chevron did, 8 + depth * 14 px in; the piece starts at depth * 14 + 1 - width / 2.
      const folder = body(`${STYLE} .sidebar__body .tree[role='group'] > li[aria-expanded]::before`)[0]
      const renaming = body(`${STYLE} .sidebar__body .tree[role='group'] > li[data-renaming]::before`)[0]
      const reach = (b: string) => 1 + Number(/width:\s*calc\(([\d.]+)px \+ var\(--thread-width\) \/ 2\);/.exec(b)?.[1])
      expect(reach(folder)).toBe(8 + px(body('.tree__chevron::before')[0], 'left') - 2)
      expect(reach(renaming)).toBe(8 - 2)
      // It comes after the folder's rule, so it wins on the same li.
      expect(appCss.indexOf("li[data-renaming]::before")).toBeGreaterThan(appCss.indexOf("li[aria-expanded]::before"))
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

  it('bug YAZ-3329: no level-line or thread rule puts a state on an ancestor of the rows: no `.sidebar__body:hover`, no `:has(`, and each `:hover` is on the element the rule styles', () => {
    const ours = rules.flatMap((rule) => rule.selectors).filter((s) => s.includes("[role='group']") || s.includes('data-sidebar-line'))
    expect(ours.length).toBeGreaterThan(10)
    for (const s of ours) {
      expect(s, s).not.toMatch(/\.sidebar__body:/)
      expect(s, s).not.toContain(':has(')
      // A state pseudo-class on an ancestor compound makes Chromium restyle, or search, all of that ancestor's subtree.
      const ancestors = s.replace(/:not\([^)]*\)/g, '').split(/\s*[\s>+~]\s*/).slice(0, -1)
      for (const compound of ancestors) expect(compound, s).not.toMatch(/:(hover|focus|focus-visible|focus-within|active)\b/)
    }
    // The "On hover" gates read the attributes that the sidebar writes.
    expect(ours.filter((s) => s.includes("[data-sidebar-lines='hover']"))).toEqual([
      `.app[data-sidebar-lines='hover'] .sidebar__body[data-mouse-in] ${LINE}`,
      `.app[data-sidebar-lines='hover'] .sidebar__body[data-key-focus] ${LINE}`,
    ])
  })

  it('Recents and Sessions nest a `.tree` with no role: no rule draws on a `.tree` inside a `.tree` (D4)', () => {
    for (const { selectors } of rules) for (const selector of selectors) expect(selector, selector).not.toMatch(/\.tree\s+\.tree/)
  })

  describe('sticky folders (YAZ-3440 D1, demo round 1)', () => {
    const STICKY = ".tree > li[aria-expanded='true'] > .tree__row--sticky"
    const sticky = rules.find((rule) => rule.selectors.includes(STICKY))?.body ?? ''
    /** The rules inside the stuck query, and the rest of the sheet. */
    const stuck = (() => {
      const at = appCss.indexOf('@container scroll-state(stuck: top) {')
      expect(at).toBeGreaterThan(-1)
      let depth = 0
      for (let i = appCss.indexOf('{', at); i < appCss.length; i++) {
        if (appCss[i] === '{') depth++
        if (appCss[i] === '}' && --depth === 0) return rulesOf(appCss.slice(appCss.indexOf('{', at) + 1, i))
      }
      return []
    })()
    const block = stuck.find((rule) => rule.selectors.includes('.tree__row--sticky::before'))?.body ?? ''
    const fill = stuck.find((rule) => rule.selectors.includes('.tree__row--sticky::after'))?.body ?? ''

    it('1a: an open folder row sticks flush at the top edge: its `top` takes back the list\'s top padding, which is one property', () => {
      expect(sticky).toMatch(/position:\s*sticky;/)
      expect(sticky).toMatch(/top:\s*calc\(var\(--tree-depth, 0\) \* 25\.5px - var\(--sidebar-pad-top, 0px\)\);/)
      const list = body('.sidebar__body').find((b) => /padding:/.test(b)) ?? ''
      expect(list).toMatch(/--sidebar-pad-top:\s*6px;/)
      expect(list).toMatch(/padding:\s*var\(--sidebar-pad-top\) 0 24px;/)
      // The stack is one row per level, and a row scrolled into view lands below it: the same 25.5px.
      expect(rules.find((rule) => rule.selectors.includes('.tree > li') && rule.selectors.includes('.tree__row'))?.body).toMatch(/scroll-margin-top:\s*calc\(min\(var\(--tree-depth, 0\), var\(--sticky-levels, 7\)\) \* 25\.5px\);/)
      expect(rowHeight).toBe(25.5)
    })

    it('1b: a row that can stick is z 4 and up, over every line and thread piece in its level, and each nested level of the thread is z 3, over its parent\'s', () => {
      expect(sticky).toMatch(/z-index:\s*calc\(10 - var\(--tree-depth, 0\)\);/)
      // Never more than 7 levels stick (D2), so the deepest row that can stick is z 10 - 6 = 4.
      expect(rules.find((rule) => rule.selectors.some((s) => s.split(".tree[role='group']").length - 1 === 7 && s.endsWith('.tree__row--sticky')))?.body).toMatch(/position:\s*static;/)
      const lineZ = [...appCss.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, sel, b]) => /data-sidebar-line-style|\[role='group'\]/.test(sel) && !sel.includes('tree__row') && /z-index/.test(b))
        .map(([, , b]) => Number(/z-index:\s*(-?\d+)/.exec(b)?.[1]))
      expect(lineZ.length).toBeGreaterThan(0)
      for (const z of lineZ) expect(z).toBeLessThan(4)
      // An unstuck row has no fill of its own, so the lines show through it.
      expect(sticky).not.toMatch(/background/)
    })

    it('1c, 1d: a stuck row is a square block of the side colour with its own fill, edge and rounded corners copied over it, and the thin line under it', () => {
      expect(block).toMatch(/background:\s*var\(--bg-side\);/)
      expect(block).toMatch(/z-index:\s*-1;/)
      expect(block).not.toMatch(/border-radius/)
      expect(block).toMatch(/box-shadow:\s*0 1px 0 var\(--border\);/)
      for (const prop of ['border-radius', 'background-color', 'box-shadow']) expect(fill).toMatch(new RegExp(`${prop}:\\s*inherit;`))
      expect(fill).toMatch(/z-index:\s*-1;/)
      // The block comes first, so the fill paints over it, and the row's content over both.
      expect(appCss.indexOf('.tree__row--sticky::before {')).toBeLessThan(appCss.indexOf('.tree__row--sticky::after {'))
    })
  })
})
