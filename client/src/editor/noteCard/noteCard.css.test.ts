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
  expect(rules(cardCss, '.note-card .note-card__rule').some((r) => /margin:\s*10px -16px/.test(r.body))).toBe(true)
})

it('YAZ-5005: Underline on `.app` takes the highlight off a shown hidden word and draws a line under it; the blank keeps its own look', () => {
  const underline = rules(cardCss, "[data-shown-hidden-words='underline'] .note-card .note-card__hidden")
  expect(underline).toHaveLength(1)
  expect(underline[0].body).toMatch(/background:\s*none/)
  expect(underline[0].body).toMatch(/text-decoration:\s*underline/)
  expect(underline[0].body).toMatch(/text-decoration-color:\s*var\(--accent\)/)
  // It beats the highlight rule it replaces.
  expect(beats(specificity(underline[0].selector), specificity('.note-card .note-card__hidden'))).toBe(true)
  expect(rules(cardCss, '.note-card__blank').every((r) => !r.selector.includes('data-shown-hidden-words'))).toBe(true)
})

it('YAZ-5013: a blank and a shown word have ONE box model — inline, the same horizontal padding in both looks — and the word in a blank is invisible and not selectable', () => {
  const both = rules(cardCss, '.note-card .note-card__blank').filter((r) => r.selector.includes('.note-card .note-card__hidden'))
  expect(both).toHaveLength(1)
  expect(both[0].body).toMatch(/display:\s*inline;/)
  expect(both[0].body).toMatch(/padding:\s*0 2px/)
  // No other rule changes the padding, the width or the display of either one (Underline keeps the padding too).
  for (const rule of [...rules(cardCss, '.note-card__hidden'), ...rules(cardCss, '.note-card__blank')].filter((r) => r.selector !== both[0].selector))
    expect(rule.body, rule.selector).not.toMatch(/(^|[\s;])(padding|width|display|margin)(-[a-z]+)?\s*:/)
  expect(rules(cardCss, '.note-card__blank > .note-card__word').some((r) => /visibility:\s*hidden/.test(r.body))).toBe(true)
  expect(rules(cardCss, '.note-card__blank').some((r) => /user-select:\s*none/.test(r.body))).toBe(true)
})
