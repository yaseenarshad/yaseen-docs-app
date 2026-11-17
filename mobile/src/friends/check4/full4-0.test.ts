import { expect, it } from 'vitest'
import { noRealWaits, report, runPlans } from './run4.testing'

noRealWaits()

// The round 4 checker's own 10,000 orders, part 0 of 8 (seeds 7200001..7201250). Full runs only (`CHECK3_FULL=1`).
it('check4 checker orders, part 0', async () => {
  const r = await runPlans(7200001, 1250)
  report('check4-checker-0', r)
  expect(r.bad).toEqual([])
}, 3_600_000)
