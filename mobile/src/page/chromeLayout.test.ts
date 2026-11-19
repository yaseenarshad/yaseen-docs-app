import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { budgetMs } from '../../../client/src/test-perf'
import { removeProfile } from './chromeLayout.testing'

/**
 * YAZ-5958. On CI's Linux, Chrome's helper processes still write into the temp profile after Chrome exits, so its
 * removal fails (ENOTEMPTY). `rmSync`'s retries wait 200 + 400 + … + 2,000 ms: 11 s on the test's clock, each time
 * Chrome ran. Two runs of Chrome (light, dark) plus Chrome's own start went past the 30 s timeout of
 * `numberedTasks.test.ts`. The removal must not hold the test, and a removal that fails must still leave no error.
 */
describe('the temp Chrome profile is removed off the test clock (YAZ-5958)', () => {
  it('removeProfile returns at once while a helper keeps writing into the profile, then the profile goes', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'notecards-test-chrome-'))
    mkdirSync(join(profile, 'Default'))
    // A stand-in for Chrome's helpers: it writes into Default/ without a pause, so each rmdir finds a new file.
    const writer = spawn(process.execPath, ['-e', `const fs = require('fs'); const d = ${JSON.stringify(join(profile, 'Default'))}; let i = 0
for (;;) { try { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(d + '/f' + (i++ % 50), 'x') } catch {} }`])
    await new Promise((r) => setTimeout(r, 300))
    try {
      const start = performance.now()
      removeProfile(profile)
      expect(performance.now() - start, 'the removal does not hold the test').toBeLessThan(budgetMs(50))
    } finally {
      writer.kill()
    }
    // With the writer gone (Chrome's helpers end), a later try removes the profile.
    await expect.poll(() => existsSync(profile), { timeout: 15_000, interval: 100 }).toBe(false)
  }, 20_000)
})
