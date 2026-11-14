import { expect, it } from 'vitest'
import { noRealWaits, report, runPlans } from './run4.testing'

noRealWaits()

// The round 4 checker's own 10,000 orders, part 5 of 8 (seeds 7206251..7207500). Full runs only (`CHECK3_FULL=1`).
it('check4 checker orders, part 5', async () => {
  const r = await runPlans(7206251, 1250)
  report('check4-checker-5', r)
  expect(r.bad).toEqual([])
}, 3_600_000)
