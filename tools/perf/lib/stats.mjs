/** Numbers for the perf runner (YAZ-2131 1C): run order, per-metric summaries, and the in-page probes. */

/** Nearest-rank percentile of an ascending list. */
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
const round = (n) => Math.round(n * 10) / 10

/** Contender order for round `i`: A B, B A, A B … so over rounds each build runs as often first as second (ABBA). */
export const abba = (i, contenders) => (i % 2 ? [...contenders].reverse() : contenders)

/** One metric over the measured runs: median and p95 are the numbers; `cv` (stdev / mean) is the noise. */
function summarize(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x))
  if (v.length === 0) return null
  const sorted = [...v].sort((a, b) => a - b)
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length)
  return { median: round(pct(sorted, 0.5)), p95: round(pct(sorted, 0.95)), min: round(sorted[0]), max: round(sorted.at(-1)), cv: mean === 0 ? 0 : Math.round((sd / mean) * 100) / 100, runs: values.map((x) => (typeof x === 'number' ? round(x) : x)) }
}

/** Every metric of every run, by name. A run that timed out reports its metric as null and shows in `runs`. */
export function summarizeRuns(runs) {
  const names = [...new Set(runs.flatMap((r) => Object.keys(r)))]
  return Object.fromEntries(names.map((k) => [k, summarize(runs.map((r) => r[k] ?? null)) ?? { median: null, runs: runs.map((r) => r[k] ?? null) }]))
}

/** Time and CPU metrics move with machine load; bytes, counts and fds do not. */
export const loadSensitive = (metric) => /(Ms|Sec|Pct)$/.test(metric)

/** p50 / p95 / max of the per-event samples inside one run (keys, mouse moves, switches). */
export const quantiles = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return { p50: round(pct(s, 0.5) ?? 0), p95: round(pct(s, 0.95) ?? 0), max: round(s.at(-1) ?? 0) }
}

/**
 * Evaluated in the page once per session: `__perf.longTasks` collects every long task from now on,
 * and `__perf.frame()` resolves after the next frame is presented (rAF, then a task).
 */
export const PAGE_PROBES = `window.__perf ??= (() => {
  const p = { longTasks: [] }
  new PerformanceObserver((l) => { for (const e of l.getEntries()) p.longTasks.push({ t: e.startTime, d: e.duration }) }).observe({ type: 'longtask' })
  p.frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r)))
  p.longestSince = (t0) => Math.max(0, ...p.longTasks.filter((e) => e.t >= t0).map((e) => e.d))
  return p
})(), true`
