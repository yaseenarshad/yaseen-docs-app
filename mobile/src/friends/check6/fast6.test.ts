import { expect, it } from 'vitest'
import { noRealWaits } from '../check4/run4.testing'
import { report6, runPlans6 } from './run6.testing'

noRealWaits()

// YAZ-5444 in the normal suite: 25 orders of the round 6 builder's model, each with the list FILE gone from a home vault
// that answers (deleted, or the vault made again), at 5 % stale reads. Every invariant asserts (I1..I10).
it('check6 orders 6440001..6440025 (the list file gone) at 5 % stale reads: no violation, and the way out runs', async () => {
  const t0 = Date.now()
  const r = await runPlans6(6440001, 25)
  report6('check6-fast', r, Date.now() - t0)
  expect(r.bad).toEqual([])
  expect(r.wayOut).toBe(r.fileGone)
  expect(r.wayOut).toBeGreaterThan(10)
}, 300_000)
