/**
 * The one rule for a timing budget in the `perf` project (YAZ-3328): time a run several times and
 * hold the budget to the MEDIAN. One timed run, or the mean of many, fails on a single GC pause or a
 * stalled CI runner: one save measured 0.5 ms as a median and 29 ms at its worst in the same test,
 * and a 2 ms budget on the mean of 100 failed on `main`. A real regression slows most runs, so the
 * median still catches it. Only a cold first call (nothing cached yet) is timed once, by nature,
 * and it keeps a wide budget.
 */
export const median = (ms: readonly number[]): number => [...ms].sort((a, b) => a - b)[ms.length >> 1]

/**
 * The slack on every time budget: a test fails only past twice its budget. The CI runner's speed
 * swings about 2.5× from run to run (the same suite took 727 s and 1,846 s on 2026-11-05), and the
 * medians it missed by were at most 1.7× the budget. A slow machine moves every time by the same
 * factor; an algorithm gone wrong (a loop inside a loop, a walk per key) moves it far more, so the
 * slack still catches it. Counts (walks, measures, rows) take no slack: they do not depend on the machine.
 */
export const PERF_SLACK = 2

/** A time budget in ms, with the slack (`PERF_SLACK`). Write the real budget: `budgetMs(16)` is one frame. */
export const budgetMs = (ms: number): number => ms * PERF_SLACK

/**
 * Times `run(0)` … `run(runs - 1)` one by one; `worst` is for the log. The caller warms up first when
 * the first call pays the JIT, and builds each run's input before it when a run must not reuse one.
 */
export function timeMedian<T>(runs: number, run: (i: number) => T): { median: number; worst: number; result: T } {
  const ms: number[] = []
  let result!: T
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    result = run(i)
    ms.push(performance.now() - start)
  }
  return { median: median(ms), worst: Math.max(...ms), result }
}
