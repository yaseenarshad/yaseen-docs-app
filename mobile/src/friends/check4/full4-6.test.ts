import { expect, it } from 'vitest'
import { noRealWaits, report, runPlans } from './run4.testing'

noRealWaits()

// The round 4 checker's own 10,000 orders, part 6 of 8 (seeds 7207501..7208750). Full runs only (`CHECK3_FULL=1`).
it('check4 checker orders, part 6', async () => {
  const r = await runPlans(7207501, 1250)
  report('check4-checker-6', r)
  expect(r.bad).toEqual([])
}, 3_600_000)
