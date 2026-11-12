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
