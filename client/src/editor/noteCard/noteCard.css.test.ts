/**
 * The card's CSS against Crepe's reset, read as text (YAZ-4973): `.milkdown * { margin: 0; padding: 0 }` loads after
 * `noteCard.css` at the weight of one class, so a card rule that sets a margin or a padding must weigh more, or the
 * card's text touches its edge in the page (the Inbox and the card window are outside `.milkdown`).
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { beats, rules, specificity } from '../cssRules'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const cardCss = read('./noteCard.css')
const reset = read('../../../../node_modules/@milkdown/crepe/lib/theme/common/reset.css')

it('every card rule that sets a margin or a padding beats `.milkdown *`, with no !important', () => {
  const crepe = rules(reset, '.milkdown *').find((r) => /padding:\s*0/.test(r.body))!
  expect(specificity(crepe.selector)).toEqual([0, 1, 0])
  const spacing = rules(cardCss, '.note-card').filter((r) => /(^|[\s;])(margin|padding)(-[a-z]+)?\s*:/.test(r.body))
  expect(spacing.length).toBeGreaterThan(8)
  for (const rule of spacing)
    for (const selector of rule.selector.split(/,(?![^(]*\))/)) {
      expect(beats(specificity(selector.trim()), specificity(crepe.selector)), selector).toBe(true)
      expect(rule.body).not.toContain('!important')
    }
  // The page gives a card room above and below, so two cards never touch.
  expect(rules(cardCss, '.milkdown .note-card').some((r) => /margin:\s*12px 0/.test(r.body))).toBe(true)
})

it('a side has no blank line under its text in the page: the body sets `white-space: normal` over ProseMirror`s `break-spaces` (YAZ-4964)', () => {
  const prosemirror = read('../../../../node_modules/prosemirror-view/style/prosemirror.css')
  // The page's editor keeps every space and newline; a card's body inherits that unless it sets its own.
  expect(rules(prosemirror, '.ProseMirror').some((r) => r.selector === '.ProseMirror' && /white-space:\s*break-spaces/.test(r.body))).toBe(true)
  const body = rules(cardCss, '.note-card__body').filter((r) => /white-space:\s*normal/.test(r.body))
  expect(body.map((r) => r.selector)).toEqual(['.note-card .note-card__body'])
  // The sides' outer margins stay 0, and the rule between two sides keeps its gap.
  expect(rules(cardCss, '.note-card__side > :last-child').some((r) => /margin-bottom:\s*0/.test(r.body))).toBe(true)
  expect(rules(cardCss, '.note-card .note-card__rule').some((r) => /margin:\s*16px -16px/.test(r.body))).toBe(true)
})

it('YAZ-5005: Underline on `.app` takes the highlight off a shown hidden word and draws a line under it; the blank keeps its own look', () => {
  const underline = rules(cardCss, "[data-shown-hidden-words='underline'] .note-card .note-card__hidden")
  expect(underline).toHaveLength(1)
  expect(underline[0].body).toMatch(/background:\s*none/)
  expect(underline[0].body).toMatch(/text-decoration:\s*underline/)
  expect(underline[0].body).toMatch(/text-decoration-color:\s*var\(--accent\)/)
  // It beats the highlight rule it replaces.
  expect(beats(specificity(underline[0].selector), specificity('.note-card .note-card__hidden'))).toBe(true)
  // Underline leaves the blank as it is (Box, YAZ-5053, is the one look that draws the blank too).
  expect(rules(cardCss, '.note-card__blank').every((r) => !r.selector.includes("data-shown-hidden-words='underline'"))).toBe(true)
})

it('YAZ-5013: a blank and a shown word have ONE box model — inline, the same horizontal padding in both looks — and the word in a blank is invisible and not selectable', () => {
  const both = rules(cardCss, '.note-card .note-card__blank').filter((r) => r.selector.includes('.note-card .note-card__hidden'))
  expect(both).toHaveLength(1)
  expect(both[0].body).toMatch(/display:\s*inline;/)
  expect(both[0].body).toMatch(/padding:\s*0 2px/)
  // No other rule changes the padding, the width or the display of either one (Underline keeps the padding too), but
  // Box's (YAZ-5053), which sets the SAME padding on both at once, so a show still moves nothing.
  // (Round 2's word inside it gets the text's size back; that rule sets only the font size.)
  const box = rules(cardCss, "[data-shown-hidden-words='box'] .note-card :is(.note-card__hidden, .note-card__blank)").filter((r) => r.selector === "[data-shown-hidden-words='box'] .note-card :is(.note-card__hidden, .note-card__blank)")
  expect(box).toHaveLength(1)
  for (const rule of [...rules(cardCss, '.note-card__hidden'), ...rules(cardCss, '.note-card__blank')].filter((r) => r.selector !== both[0].selector && r.selector !== box[0].selector))
    expect(rule.body, rule.selector).not.toMatch(/(^|[\s;])(padding|width|display|margin)(-[a-z]+)?\s*:/)
  expect(rules(cardCss, '.note-card__blank > .note-card__word').some((r) => /visibility:\s*hidden/.test(r.body))).toBe(true)
  expect(rules(cardCss, '.note-card__blank').some((r) => /user-select:\s*none/.test(r.body))).toBe(true)
})

it("YAZ-5008: Edit card's selection shows — the code look's current-line band (opaque `--bg-hover`, drawn over CodeMirror's selection layer) is off in a card's editor", () => {
  const theme = read('../codeTheme.ts')
  // The code look marks the focused editor's current line with an opaque colour; the selection layer is under the line.
  expect(theme).toMatch(/'&\.cm-focused \.cm-activeLine, &\.cm-focused \.cm-activeLineGutter': \{ backgroundColor: 'var\(--bg-hover\)' \}/)
  const focusedLine: [number, number, number] = [0, 3, 0] // `.ͼo.cm-focused .cm-activeLine`, as CodeMirror's theme scopes it
  const off = rules(cardCss, '.note-card .note-card__code').filter((r) => r.selector.includes('.cm-activeLine') && /background(-color)?:\s*transparent/.test(r.body))
  expect(off).toHaveLength(1)
  expect(beats(specificity(off[0].selector), focusedLine)).toBe(true)
  expect(off[0].body).not.toContain('!important')
})

it('YAZ-5026 round 2: a card`s lists, read (the page, the card window, the Inbox), follow Settings › Editor › Outline › Bullet indent and Bullet gap, with the page`s dots', () => {
  const bullets = read('../outline/bullets.css')
  // The page: the two settings, and the dot's fixed column.
  expect(bullets).toMatch(/--list-label-gap:\s*var\(--note-bullet-gap, 10px\)/)
  expect(bullets).toMatch(/--list-indent:\s*var\(--note-bullet-indent, 2\.15em\)/)
  expect(bullets).toMatch(/--list-gutter:\s*calc\(2\.15em - 10px\)/)
  // The card's read lists: the same three values, from the same settings.
  const vars = rules(cardCss, '.note-card__side').find((r) => r.body.includes('--card-list-gap'))!
  // YAZ-5050: Card spacing, Custom, comes first; Same as pages sets no card variable, so the pages' settings hold.
  expect(vars.body).toMatch(/--card-list-gap:\s*var\(--card-bullet-gap, var\(--note-bullet-gap, 10px\)\)/)
  expect(vars.body).toMatch(/--card-list-indent:\s*var\(--card-bullet-indent, var\(--note-bullet-indent, 2\.15em\)\)/)
  expect(vars.body).toMatch(/--card-list-gutter:\s*calc\(2\.15em - 10px\)/)
  // The text starts after the dot's column and the gap; a child level steps in by the indent from its parent's dot.
  const li = rules(cardCss, '.note-card .note-card__side li').find((r) => /padding:/.test(r.body))!
  expect(li.body).toMatch(/padding-left:\s*calc\(var\(--card-list-gutter\) \+ var\(--card-list-gap\)\)/)
  // YAZ-5133: the gutter is its own declaration, so a bad row value (an invalid variable empties the whole shorthand)
  // can never put the markers on the text.
  expect(li.body).toMatch(/padding:\s*var\(--card-list-row\) 0;/)
  const child = rules(cardCss, '.note-card .note-card__side li > :is(ul, ol)')[0]!
  expect(child.body).toMatch(/margin-left:\s*calc\(var\(--card-list-indent\) - var\(--card-list-gutter\) - var\(--card-list-gap\)\)/)
  // No browser bullets: the page's ● ○ ■ by level.
  expect(rules(cardCss, '.note-card .note-card__side :is(ul, ol)').some((r) => /list-style:\s*none/.test(r.body))).toBe(true)
  const dots = rules(cardCss, 'ul > li::before')
  expect(dots.length).toBeGreaterThanOrEqual(3)
})

it('YAZ-5026 round 2: Edit card`s key row has its own look in the page (explore.css loads only with the card window or the Inbox)', () => {
  const row = rules(cardCss, '.note-card .note-card__keys').find((r) => /display:\s*flex/.test(r.body))!
  expect(row.body).toMatch(/gap:\s*14px/)
  expect(rules(cardCss, '.note-card .note-card__keys kbd').some((r) => /font-family:\s*inherit/.test(r.body) && /border:/.test(r.body))).toBe(true)
})

it('YAZ-5051: the line between two sides is clear — dashed, across the card, darker than its borders, unlike a rule in the text; the Inbox gives it more room, edge to edge', () => {
  const rule = rules(cardCss, '.note-card .note-card__rule').find((r) => r.selector === '.note-card .note-card__rule')!
  expect(rule.body).toMatch(/border-top:\s*1px dashed color-mix\(in srgb, var\(--fg\) 30%, transparent\)/)
  expect(rule.body).toMatch(/height:\s*0/)
  expect(rule.body).not.toMatch(/background:\s*var\(--border\)/)
  const screens = read('../../review/noteCardScreens.css')
  expect(rules(screens, '.note-card-inbox__card .note-card__rule').some((r) => /margin:\s*22px -28px/.test(r.body))).toBe(true)
  // The Inbox card's own padding is what the rule reaches past.
  expect(rules(screens, '.note-card-inbox__body').some((r) => /padding:\s*24px 28px 28px/.test(r.body))).toBe(true)
})

it("YAZ-5050: a card's text reads with the pages' Line spacing and Space between blocks (or Card spacing's Custom values), in the page, the card window and the Inbox, over the page's own paragraph rule", () => {
  const vars = rules(cardCss, '.note-card__side').find((r) => r.body.includes('--card-gap:'))!
  expect(vars.body).toMatch(/--card-gap:\s*var\(--card-block-gap, var\(--edit-block-gap, 4px\)\)/)
  expect(vars.body).toMatch(/--card-line:\s*var\(--card-line-height, var\(--edit-line-height, 1\.5\)\)/)
  // Round 3: Custom's own Space between bullets (Mochi's: none), else the space between blocks, as the page's.
  expect(vars.body).toMatch(/--card-list-row:\s*var\(--card-bullet-space, var\(--card-gap\)\)/)
  // A paragraph: the page's look (its padding is the space between blocks), and it beats the page's own rule, which
  // reaches a card's paragraphs in the page.
  const app = read('../../app.css')
  const pageP = rules(app, '.editor-instance .milkdown .ProseMirror p').find((r) => /padding:/.test(r.body))!
  const p = rules(cardCss, '.note-card__side p').find((r) => /padding:\s*var\(--card-gap\) 0/.test(r.body))!
  expect(p.body).toMatch(/line-height:\s*var\(--card-line\)/)
  expect(p.body).toMatch(/margin:\s*0/)
  expect(beats(specificity(p.selector), specificity(pageP.selector))).toBe(true)
  // Headings: the page's three gaps above, one below.
  const h = rules(cardCss, '.note-card__side :is(h1, h2, h3, h4, h5, h6)')[0]!
  expect(h.body).toMatch(/margin:\s*calc\(var\(--card-gap\) \* 3\) 0 var\(--card-gap\)/)
  expect(beats(specificity(h.selector), specificity('.editor-instance .milkdown .ProseMirror h1'))).toBe(true)
  // A list item's paragraph has no padding of its own: the item's row is the gap.
  expect(rules(cardCss, '.note-card__side li > p').some((r) => /padding:\s*0/.test(r.body) && beats(specificity(r.selector), specificity(p.selector)))).toBe(true)
})

it('YAZ-5053: Box, as Mochi — a hidden word is a plain grey box, a shown one sits in a lighter grey box with round corners; one padding for both, so the line keeps its place; light and dark from the text colour', () => {
  const both = rules(cardCss, "[data-shown-hidden-words='box'] .note-card :is(.note-card__hidden, .note-card__blank)")[0]!
  expect(both.body).toMatch(/padding:\s*var\(--nc-box-above\) 6px var\(--nc-box-below\)/)
  expect(both.body).toMatch(/border-radius:\s*4px/)
  expect(both.body).toMatch(/border-bottom:\s*0/)
  const blank = rules(cardCss, "[data-shown-hidden-words='box'] .note-card .note-card__blank")[0]!
  const shown = rules(cardCss, "[data-shown-hidden-words='box'] .note-card .note-card__hidden")[0]!
  expect(blank.body).toMatch(/background:\s*color-mix\(in srgb, var\(--fg\) 10%, transparent\)/)
  expect(shown.body).toMatch(/background:\s*color-mix\(in srgb, var\(--fg\) 5%, transparent\)/)
  // They beat the highlight and the blank's line under it.
  expect(beats(specificity(shown.selector), specificity('.note-card .note-card__hidden'))).toBe(true)
  expect(beats(specificity(both.selector), specificity('.note-card .note-card__blank'))).toBe(true)
  // Edit card's hidden word has the shown look.
  expect(rules(cardCss, "[data-shown-hidden-words='box'] .note-card .note-card__cloze").some((r) => /color-mix\(in srgb, var\(--fg\) 5%, transparent\)/.test(r.body))).toBe(true)
})

it('YAZ-5053 round 2: Box never reaches into the next line, at any line spacing — the box is drawn by padding from the line (the span has no font size), capped by the line less a gap; the word keeps its size; Edit card`s grey is a band of the same height', () => {
  const both = rules(cardCss, "[data-shown-hidden-words='box'] .note-card :is(.note-card__hidden, .note-card__blank)")[0]!
  // The span's own font line (about 1.2em, whatever the spacing) is what overlapped at 1.0 and 1.15: it is 0 now.
  expect(both.body).toMatch(/font-size:\s*0;/)
  // The height: the 1.5 look at most, and never more than the line less a gap.
  expect(both.body).toMatch(/--nc-box-height:\s*min\(calc\(var\(--nc-box-em\) \* 1\.15 \+ 4px\), calc\(var\(--nc-box-line\) - var\(--nc-box-em\) \* 0\.2\)\)/)
  expect(both.body).toMatch(/box-decoration-break:\s*clone/)
  // The text's size and line come from the span's parent, as lengths (registered, so the span's 0 does not change them).
  for (const name of ['--nc-box-em', '--nc-box-line']) expect(cardCss).toMatch(new RegExp(`@property ${name} \\{\\s*syntax: '<length>';\\s*inherits: true;`))
  const parent = rules(cardCss, "[data-shown-hidden-words='box'] .note-card :has(> :is(.note-card__hidden, .note-card__blank, .note-card__cloze))")[0]!
  expect(parent.body).toMatch(/--nc-box-em:\s*1em;/)
  expect(parent.body).toMatch(/--nc-box-line:\s*1lh;/)
  // The word gets the text's size back, so the line and the letters do not move.
  expect(rules(cardCss, "[data-shown-hidden-words='box'] .note-card :is(.note-card__hidden, .note-card__blank) > .note-card__word")[0]!.body).toMatch(/font-size:\s*var\(--nc-box-em\)/)
  // Edit card: a band in the middle of the line, at most the line less the same gap.
  const edit = rules(cardCss, "[data-shown-hidden-words='box'] .note-card .note-card__editor .note-card__cloze")[0]!
  expect(edit.body).toMatch(/0 50% \/ 100%\s+min\(100%, calc\(var\(--nc-box-line\) - var\(--nc-box-em\) \* 0\.2\)\) no-repeat/)
})

it('YAZ-5049 round 2: the Inbox card is one long page, as Mochi — no scroll bar of its own (the Inbox view scrolls), the top row stays on top, the buttons stay at the bottom', () => {
  const screens = read('../../review/noteCardScreens.css')
  const body = rules(screens, '.note-card-inbox__body').find((r) => r.selector === '.note-card-inbox__body')!
  expect(body.body).not.toMatch(/overflow/)
  const column = rules(screens, '.note-card-inbox__column').find((r) => r.selector === '.note-card-inbox__column')!
  expect(column.body).toMatch(/flex:\s*none/)
  expect(column.body).not.toMatch(/min-height:\s*0/)
  expect(rules(screens, '.note-card-inbox').find((r) => r.selector === '.note-card-inbox')!.body).toMatch(/overflow:\s*auto/)
  expect(rules(screens, '.note-card-inbox__top').find((r) => r.selector === '.note-card-inbox__top')!.body).toMatch(/position:\s*sticky;\s*top:\s*0/)
  const dock = rules(screens, '.note-card-inbox__dock').find((r) => r.selector === '.note-card-inbox__dock')!
  expect(dock.body).toMatch(/position:\s*sticky/)
  expect(dock.body).toMatch(/bottom:/)
})
