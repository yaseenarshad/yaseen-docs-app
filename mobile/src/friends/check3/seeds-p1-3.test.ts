import { expect, it } from 'vitest'
import { range, runSeeds } from './run'

// The round 3 checker's own seeds: profile 1, part 3 of 5 (500 seeds). Full runs only (`CHECK3_FULL=1`).
// YAZ-5083: each seed ASSERTS (I1 to I5, I7 and wrong deletes are 0), with the strict fake GitHub.
it('check3 checker seeds, profile 1 part 3', async () => {
  const r = await runSeeds(range((1 - 1) * 100000 + 3 * 500 + 1, 500), 1)
  console.log(JSON.stringify({ set: 'check3 checker', profile: 1, part: 3, runs: r.runs, count: r.count, listWrites: r.listWrites, bad: r.bad.slice(0, 5) }))
  expect(r.bad).toEqual([])
}, 1_200_000)
