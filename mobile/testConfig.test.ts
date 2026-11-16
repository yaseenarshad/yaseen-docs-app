/**
 * YAZ-5160 (3A4): the build guard belongs to the BUILD (and the dev server), not to the test run. Vitest loads tests and
 * test helpers, which run in Node and are never bundled; with the guard in, it stopped `src/rules.test.ts` from loading,
 * so its tests never ran. The rule for tests is `src/rules.test.ts`, which walks every file the APP reaches.
 */
import type { PluginOption } from 'vite'
import { describe, expect, it } from 'vitest'
import testConfig from './vitest.config'
import buildConfig from './vite.config'

const names = (plugins: PluginOption[] | undefined): string[] =>
  (plugins ?? []).flat(Infinity as 1).flatMap((p) => (p && typeof p === 'object' && 'name' in p ? [String(p.name)] : []))

describe('the import guard: in the build, not in the tests', () => {
  it('the build and the dev server run it', () => {
    expect(names(buildConfig.plugins)).toContain('notecards-import-guard')
  })

  it('the mobile test project does not', () => {
    expect(names(testConfig.plugins)).not.toContain('notecards-import-guard')
  })

  it('the test project keeps the build’s aliases and its one React', () => {
    expect(testConfig.resolve?.alias).toEqual(buildConfig.resolve?.alias)
    expect(testConfig.resolve?.dedupe).toEqual(buildConfig.resolve?.dedupe)
  })
})
