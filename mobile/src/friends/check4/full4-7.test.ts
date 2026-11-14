import { expect, it } from 'vitest'
import { noRealWaits, report, runPlans } from './run4.testing'

noRealWaits()

// The round 4 checker's own 10,000 orders, part 7 of 8 (seeds 7208751..7210000). Full runs only (`CHECK3_FULL=1`).
it('check4 checker orders, part 7', async () => {
  const r = await runPlans(7208751, 1250)
  report('check4-checker-7', r)
  expect(r.bad).toEqual([])
}, 3_600_000)
