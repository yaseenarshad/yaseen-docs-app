import { expect, it } from 'vitest'
import { noRealWaits, report, runPlans } from './run4.testing'

noRealWaits()

// The round 4 checker's own 10,000 orders, part 2 of 8 (seeds 7202501..7203750). Full runs only (`CHECK3_FULL=1`).
it('check4 checker orders, part 2', async () => {
  const r = await runPlans(7202501, 1250)
  report('check4-checker-2', r)
  expect(r.bad).toEqual([])
}, 3_600_000)
