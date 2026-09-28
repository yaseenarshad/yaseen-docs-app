import { vi } from 'vitest'
import { describeWatchConformance } from './watchConformance'

// The engine's chokidar polling fallback forced on (YAZ-2192): every `fs.watch` throws, as on a
// volume or platform where it cannot serve, so `treeWatcher.ts` polls from the start.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  const watch = (() => {
    throw Object.assign(new Error('fs.watch unavailable'), { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' })
  }) as typeof fs.watch
  return { ...fs, default: { ...fs, watch }, watch }
})

describeWatchConformance('polling fallback', { quietMs: 1500 })
