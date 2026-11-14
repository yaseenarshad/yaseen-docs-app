/**
 * The builder's driver for the model checker (YAZ-5083 round 3): runs seeds and returns the violations.
 *
 * The checker's own files (`model.ts`, `orders`, `seeds-*`, `skew`, `show`, `summary`) came from the review. The
 * fast set (`fast.test.ts`) runs in the normal suite. The full runs are slow, so `mobile/vitest.config.ts` keeps them
 * out unless `CHECK3_FULL=1`:
 *
 *   CHECK3_FULL=1 OUT=<folder> npx vitest run --maxWorkers=4 -c mobile/vitest.config.ts mobile/src/friends/check3
 *
 * That runs the checker's 5,000 seeds (`seeds-*`, a summary per part in OUT) and the builder's 5,000 new seeds
 * (`mine-*`, which fail on any violation). One seed: `SEED=<n> PROFILE=<1|2> CHECK3_FULL=1 npx vitest run ... check3/show`.
 */
import { runSeed } from './model.testing'

export interface SeedResult {
  runs: number
  bad: string[]
  doneButListed: number
  lostRemoveSeeds: number
}

/** Runs `seeds` with `profile`; a seed with any I1 to I4 or wrong delete goes in `bad` with its first finding. */
export async function runSeeds(seeds: number[], profile: number): Promise<SeedResult> {
  const out: SeedResult = { runs: 0, bad: [], doneButListed: 0, lostRemoveSeeds: 0 }
  for (const s of seeds) {
    const m = await runSeed(s, profile)
    out.runs++
    out.doneButListed += m.st.doneButListed
    if (m.st.lostRemove > 0) out.lostRemoveSeeds++
    const first = [...m.st.i1, ...m.st.i2, ...m.st.i3, ...m.st.i4, ...m.st.wrongDeletes][0]
    if (first !== undefined) out.bad.push(`seed ${s} profile ${profile}: ${first}`)
  }
  return out
}

export const range = (from: number, count: number, step = 1): number[] => Array.from({ length: count }, (_, i) => from + i * step)
