/**
 * The Inbox zoom's CSS, read as text (jsdom lays nothing out). YAZ-5372 Decision (Yaseen: "Yes, do it"): the Inbox zoom
 * scales the whole card as page zoom scales a page — the SAME rule (app.css, `--document-zoom` and CSS `zoom`), on the
 * card's frame: its text, title band, sides, pictures and spacing; and the card's width grows with it, capped by the
 * window. The Inbox bar, the row above the card and the buttons stay their size.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(path.join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const cards = read('cardScreens.css')
const app = read('../app.css')

/** Every rule of `css`: its selectors and its declarations. */
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((s) => s.trim()),
    decls: Object.fromEntries(
      m[2]!
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
    ),
  }))

describe('the Inbox zoom on the whole card (YAZ-5372)', () => {
  it("the card's frame is zoomed by page zoom's own rule in app.css, and there is no second zoom", () => {
    const pageRule = rules(app).find((r) => r.selectors.includes('.editor-instance .milkdown > .ProseMirror') && r.decls['zoom'] !== undefined)!
    expect(pageRule.decls['zoom']).toBe('var(--document-zoom, 1)')
    expect(pageRule.selectors).toContain('.card-inbox__panel')
    expect(cards).not.toContain('--inbox-zoom')
    expect(rules(cards).filter((r) => r.decls['zoom'] !== undefined)).toEqual([])
  })

  it("the card's width grows with the zoom, capped by the window", () => {
    const column = rules(cards).find((r) => r.selectors.includes('.card-inbox__column') && r.decls['width'] !== undefined)!
    expect(column.decls['width']).toBe('min(calc((var(--card-text-width) + 2 * var(--inbox-card-pad, 28px)) * var(--document-zoom, 1)), 100%)')
  })
})

/** The declarations of the rule whose selector list is exactly `selector` (the last such rule wins, as in CSS). */
const decls = (css: string, selector: string) =>
  rules(css)
    .filter((r) => r.selectors.length === 1 && r.selectors[0] === selector)
    .reduce<Record<string, string>>((all, r) => ({ ...all, ...r.decls }), {})

describe('the block under the card stays at the bottom of the screen (YAZ-5431, as Mochi)', () => {
  it('the column fills the Inbox\'s height and the dock (buttons, last line, keys) sits at its bottom: a short card leaves the room above it', () => {
    expect(decls(cards, '.card-inbox__column')['flex']).toBe('1 0 auto')
    expect(decls(cards, '.card-inbox__dock')['margin-top']).toBe('auto')
  })

  it('a long card: the same dock is sticky at the very same bottom edge, so it never moves between a short and a long card', () => {
    const dock = decls(cards, '.card-inbox__dock')
    expect(dock['position']).toBe('sticky')
    // The view has no bottom padding: the short card's dock (end of the filled column) and the long card's (stuck) share the view's bottom edge.
    expect(dock['bottom']).toBe('0')
    expect(decls(cards, '.card-inbox')['padding']).toBe('0 16px')
  })
})

describe('the last answer\'s line is quiet for every answer (YAZ-5433)', () => {
  it('a Forgot line is the same grey as a Remembered one: only its small ✕ mark is red, as the ✓ is green; its Undo too stays grey', () => {
    const all = rules(cards)
    // Nothing colours the line itself (its text, its Undo) by the answer.
    const byRating = all.filter((r) => r.selectors.some((s) => /^\.card-inbox__last\[data-rating='[a-z]+'\]$/.test(s)) && r.decls['color'] !== undefined)
    expect(byRating).toEqual([])
    expect(all.some((r) => r.selectors.some((s) => /\.card-inbox__last\[data-rating='again'\] \.card-inbox__last-(text|undo)/.test(s)))).toBe(false)
    // The mark keeps its colour: red for Forgot / Again.
    const mark = all.find((r) => r.selectors.includes(".card-inbox__last[data-rating='again'] .card-inbox__last-mark"))
    expect(mark?.decls['color']).toBe('var(--danger)')
  })
})

/**
 * YAZ-5686 (Yaseen: "maybe just completely make them fade unless u mouse over to that area"): the Review top bar's
 * zoom (− 100% +) and full-screen button are invisible until the mouse enters THEIR area (not the whole bar), then fade
 * in (150 ms); keyboard focus in them, or the zoom's menu open, shows them. Opacity only: they keep their room, so
 * nothing jumps. Reduce motion: no fade. The ✕ and done / total count is never faded.
 */
describe('the zoom and full-screen controls fade in only on hover (YAZ-5686)', () => {
  const all = rules(cards)
  const opacityOne = all.filter((r) => r.decls['opacity'] === '1').flatMap((r) => r.selectors)

  it('invisible by default, keeping their room; a 150 ms fade', () => {
    // Outside the media queries (Reduce motion's own rule is its own test).
    const tools = decls(cards.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, ''), '.card-inbox__tools')
    expect(tools['opacity']).toBe('0')
    expect(tools['transition']).toBe('opacity 150ms ease-out')
    for (const r of all.filter((r) => r.selectors.some((s) => s.includes('.card-inbox__tools')))) {
      expect(r.decls['display']).not.toBe('none')
      expect(r.decls['visibility']).toBeUndefined()
    }
  })

  it('shown on the pointer over their own area, a keyboard focus inside, or the zoom menu open; not on the whole bar', () => {
    expect(opacityOne).toEqual(expect.arrayContaining(['.card-inbox__tools:hover', '.card-inbox__tools:focus-within', ".card-inbox__tools:has(.document-zoom__trigger[aria-expanded='true'])"]))
    expect(opacityOne.filter((s) => s.includes('.card-inbox__bar:hover'))).toEqual([])
    expect(all.filter((r) => r.selectors.some((s) => s.startsWith('.card-inbox__bar:hover') && s.includes('.card-inbox__tools')))).toEqual([])
  })

  it('Reduce motion: shown and hidden at once', () => {
    const raw = readFileSync(path.join(__dirname, 'cardScreens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(raw).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.card-inbox__tools \{\s*transition: none;\s*\}/)
  })

  it('the ✕ and done / total count is never faded', () => {
    for (const r of all.filter((r) => r.selectors.some((s) => /\.card-inbox__place\b/.test(s) && !s.includes('__tools')))) expect(r.decls['opacity']).toBeUndefined()
  })
})
