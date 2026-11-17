import { configDefaults, defineConfig } from 'vitest/config'
import base from './vitest.config'

/**
 * YAZ-5092 C1: the friends model checkers' RESEARCH tools (the `*.research.ts` files under `src/friends`). They are not
 * tests: they have no assertion, read their settings from the env (`SEED`, `SEEDS`, `KEY`, `FROM`, `COUNT`, `C5_*`),
 * and print, or write to `OUT` (`researchOut`: never the source tree). Run one by name, from the repo root:
 *   SEED=7000001 npm run mobile:friends-research -- one.research
 */
export default defineConfig({ ...base, test: { ...base.test, name: 'mobile-research', include: ['src/friends/**/*.research.ts'], exclude: configDefaults.exclude } })
