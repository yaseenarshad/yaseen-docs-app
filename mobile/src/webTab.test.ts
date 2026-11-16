import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * YAZ-5644: the web version. A browser tab (phone, tablet, computer) starts the same app as the Home Screen app: the
 * sign-in, the storage, the worker. No install wall (YAZ-5564's is gone) and no test switch for one.
 */
describe('a browser tab starts the whole app', () => {
  const main = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8')

  it('the start never asks where it runs', () => {
    expect(main).not.toMatch(/standalone|whereAmI|browserFacts|hintKind|InstallGate|installGate|gateOf|as-installed/)
  })

  it('it opens the storage, the worker and the app for everyone', () => {
    expect(main).toMatch(/await openPhoneStorage\(/)
    expect(main).toMatch(/updates=\{startUpdates\(\)\}/)
    expect(main).toMatch(/else void boot\(root\)/)
  })
})
