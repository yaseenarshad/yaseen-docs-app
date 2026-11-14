/**
 * The answer list and the phone's review host build through the phone's own import wall (`vite.config.ts`,
 * `phoneImportGuard`): no desktop bridge, no app storage wrapper, no Node. 4B bundles them with the Review screen.
 */
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

const CONFIG = fileURLToPath(new URL('../../vite.config.ts', import.meta.url))
const HERE = fileURLToPath(new URL('./', import.meta.url))

async function phoneBuild(entry: string): Promise<string | null> {
  try {
    await build({ configFile: CONFIG, logLevel: 'silent', build: { write: false, rollupOptions: { input: `${HERE}${entry}` } } })
    return null
  } catch (err) {
    return err instanceof Error ? err.message.split('\n')[0] : String(err)
  }
}

describe('3C builds through the phone wall (YAZ-5073)', () => {
  it.each(['reviewHost.ts', 'answers.ts', 'status.ts'])('%s', async (entry) => {
    expect(await phoneBuild(entry)).toBeNull()
  }, 60_000)
})
