/**
 * YAZ-5512 X1 (Must fix), against REAL git: whatever a page's merge cannot do, the pass goes on. The old settle let a
 * throw out of the page merge, so `syncPass` threw on that page on every pass and the vault never pushed again. Here
 * the merge is made to throw on purpose: both whole pages must be kept (D9), and the pass must land.
 */
import { readdirSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTwoMachines, REAL_GIT_TIMEOUT_MS } from './gitFixture'
import { syncPass } from './sync'

vi.mock('@shared/cardMerge', () => ({
  uniteCardLines: () => {
    throw new Error('made-up merge failure')
  },
}))

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe('YAZ-5512 X1: a page merge that throws never stops the sync', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('both versions are kept (the remote at the path, mine as a copy) and the pass lands', async () => {
    const p = await makeTwoMachines({ 'plan.md': '# Plan\n\nOne.\n' })
    cleanups.push(p.cleanup)
    const { a, b } = p
    await b.write('plan.md', '# Plan\n\nOne, Sam.\n')
    expect((await syncPass(b.root)).state).toBe('synced')
    await a.write('plan.md', '# Plan\n\nOne, me.\n')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const status = await syncPass(a.root)
    expect(status.state).toBe('synced')
    expect(a.read('plan.md')).toBe('# Plan\n\nOne, Sam.\n')
    const copy = readdirSync(a.root).find((f) => f.includes('(conflict,'))
    expect(copy).toBeDefined()
    expect(a.read(copy!)).toBe('# Plan\n\nOne, me.\n')
  })
})
