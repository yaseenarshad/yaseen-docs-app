import { describe, expect, it } from 'vitest'
import { lazySync } from '../../app/lazySync'
import { createSyncEngine, type SyncEngine } from '../../sync/engine'
import { BRANCH, REPO, pageText, syncSetup } from '../../sync/testing'
import { lazyMedia } from './vaultMedia'

/**
 * YAZ-5079 follow-up: 3D's media is made with 3B's engine, ONE time, once the engine has loaded (a vault opened); it is
 * not loaded for the sign-in. The real engine and the real `createMediaAhead` on the fake GitHub (no network).
 */
describe('3D is wired to the engine (YAZ-5079)', () => {
  it('loaded() resolves with the engine only after a vault opens; the media then reads a stored picture', async () => {
    const s = await syncSetup({ '.yaseendocs/review.json': '{}', 'a.md': pageText('A', 'P-1'), 'assets/pic.png': new Uint8Array([1, 2, 3]) })
    const sync = lazySync(s.store, s.tokens, async () => ({
      createSyncEngine: (o) => createSyncEngine({ ...o, makeRemote: () => s.remote, lock: (_n, fn) => fn(), yieldToUi: async () => {} }),
      followPage: () => () => undefined,
    }))
    let engine: SyncEngine | null = null
    void sync.loaded().then((e) => (engine = e))
    await sync.open(null)
    await new Promise((r) => setTimeout(r, 10))
    expect(engine).toBeNull()
    const urls: string[] = []
    const media = lazyMedia(sync.loaded, s.store, async () => {
      const real = await import('../ahead')
      return { createMediaAhead: (o) => real.createMediaAhead({ ...o, makeUrl: () => (urls.push(`blob:${urls.length}`), urls.at(-1)!), revokeUrl: () => undefined }) }
    })
    await sync.open({ repo: REPO, branch: BRANCH, addedAt: 0 })
    for (let i = 0; i < 100 && sync.state().status !== 'synced'; i++) await new Promise((r) => setTimeout(r, 5))
    expect(engine).not.toBeNull()
    const shown = await media.show('assets/pic.png')
    expect(shown).toMatchObject({ status: 'ready', url: 'blob:0', type: 'image/png' })
    expect(media.urlNow?.('assets/pic.png')).toBe('blob:0')
  })
})
