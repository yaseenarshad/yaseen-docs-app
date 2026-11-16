import { expect, it } from 'vitest'
import { mergeNeverLower } from '@shared/friendSend'
import { emptyNumbers } from '@shared/friendGists'

// CHECKER round 5 (YAZ-5252, YAZ-5391): with a closed vault in the Mac's count, no total could ever go lower. The
// checker's test (`expected 12 to be +0`) is kept with the decision of YAZ-5401 (builder of the round 5 fixes): "never
// lower" is only for a copy that may be stale. A closed copy that is CURRENT (its HEAD equals its remote-tracking branch)
// sends `totalsNeverLower: false` (macSender), and a real drop reaches the gist; a copy that is not current keeps the rule.
const now = Date.parse('2026-11-14T15:00:00Z')
const base = { ...emptyNumbers(now), login: 'ali', name: 'Ali', avatar: '' }
const before = { ...base, totals: { ...base.totals, cards: 500, inReview: 300, streak: 12, bestStreak: 12, dueLeft: 40, newLeft: 200 } }
// The truth after the change, counted by the Mac (with a closed vault) on each of 30 days.
const truth = { ...base, totals: { ...base.totals, cards: 400, inReview: 250, streak: 0, bestStreak: 12, dueLeft: 0, newLeft: 150 } }
const thirtyDays = (totalsNeverLower: boolean) => {
  let gist: Record<string, unknown> = before
  for (let day = 0; day < 30; day++) gist = mergeNeverLower(gist, truth as never, { totalsNeverLower }).file
  return gist.totals as Record<string, number>
}

it('a real drop (cards archived, a streak broken, due cards finished) reaches the gist from Mac sends while a CURRENT vault stays closed (YAZ-5401)', () => {
  const t = thirtyDays(false)
  console.log('NEVERLOWER after 30 days of Mac sends (current copy):', JSON.stringify({ cards: t.cards, inReview: t.inReview, streak: t.streak, dueLeft: t.dueLeft, newLeft: t.newLeft }))
  expect({ cards: t.cards, inReview: t.inReview, streak: t.streak, dueLeft: t.dueLeft, newLeft: t.newLeft }).toEqual({ cards: 400, inReview: 250, streak: 0, dueLeft: 0, newLeft: 150 })
})

it('a copy that is not current (it may be stale) keeps "never lower" (YAZ-5391)', () => {
  const t = thirtyDays(true)
  expect({ cards: t.cards, streak: t.streak, dueLeft: t.dueLeft }).toEqual({ cards: 500, streak: 12, dueLeft: 40 })
})
