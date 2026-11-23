/**
 * The app's version order (YAZ-2976), one rule for main and the renderer: the updater asks it whether a
 * tag is an update, and the "What's new" sheet whether its **Latest** row is newer than the running app
 * (YAZ-4371). Pure, no dependency.
 */

const parts = (v: string): number[] => v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0)

/** `x.y.z` order, a leading `v` ignored: > 0 when `a` is the newer one. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export const newer = (a: string, b: string): boolean => compareVersions(a, b) > 0

/**
 * The version a person sees: two numbers when the third is 0 (`2.1.0` → `2.1`), else as is
 * (`2.0.2`). Releases are `2.1`, `2.2`, … from 2.1 on, tagged `v2.1`; package.json keeps `2.1.0`
 * because npm and electron-builder need three numbers. Every version the updater holds — the
 * app's own (`host.version`, made short at its source in index.ts), each tag, the markers — goes
 * through this, so an equality check never sets `2.1` against `2.1.0`.
 */
export const shortVersion = (v: string): string => v.replace(/^v/, '').replace(/^(\d+\.\d+)\.0$/, '$1')
