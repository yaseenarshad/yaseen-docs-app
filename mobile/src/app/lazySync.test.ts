import { describe, expect, it } from 'vitest'
import { signOutAndErase } from '../auth/signIn'
import { createSyncEngine } from '../sync/engine'
import { BRANCH, REPO, VAULT, pageText, syncSetup } from '../sync/testing'
import { lazySync } from './lazySync'
import type { ShellSyncState } from './syncPort'

const VAULT_FILES = { '.yaseendocs/review.json': '{}', 'a.md': pageText('A', 'P-1'), 'b.md': pageText('B', 'P-2') }
const vault = { repo: REPO, branch: BRANCH, addedAt: 0 }

async function setup() {
  const s = await syncSetup(VAULT_FILES)
  let loads = 0
  const states: ShellSyncState[] = []
  const sync = lazySync(s.store, s.tokens, async () => {
    loads++
    return {
      // The real engine (3B) on the fake GitHub; no Web Lock and no wait for the UI in Node.
      createSyncEngine: (o) => createSyncEngine({ ...o, makeRemote: () => s.remote, lock: (_n, fn) => fn(), yieldToUi: async () => {} }),
      followPage: () => () => undefined,
    }
  })
  sync.subscribe((e) => void (e.type === 'state' && states.push(e.state)))
  const settled = async () => {
    for (let i = 0; i < 50 && sync.state().status === 'syncing'; i++) await new Promise((r) => setTimeout(r, 5))
  }
  return { s, sync, states, settled, loads: () => loads }
}

describe('lazySync: 3B engine, loaded when a vault opens', () => {
  it('does not load the engine for the sign-in (no vault)', async () => {
    const t = await setup()
    await t.sync.open(null)
    expect(t.loads()).toBe(0)
    expect(t.sync.state().status).toBe('idle')
  })

  it('a first open: not ready, with progress, then ready when the download ends (row F2)', async () => {
    const t = await setup()
    await t.sync.open(vault)
    await t.settled()
    expect(t.loads()).toBe(1)
    expect(t.states[0]).toMatchObject({ vault: VAULT, ready: false })
    expect(t.states.some((st) => st.progress !== null && st.progress.total > 0)).toBe(true)
    expect(t.sync.state()).toMatchObject({ status: 'synced', ready: true, vault: VAULT })
    expect(await t.s.store.read(VAULT, 'a.md')).not.toBeNull()
  })

  it('a whole copy on the phone is ready at once, also while the engine reads its stored index', async () => {
    const first = await setup()
    await first.sync.open(vault)
    await first.settled()
    const again = lazySync(first.s.store, first.s.tokens, async () => ({
      createSyncEngine: (o) => createSyncEngine({ ...o, makeRemote: () => first.s.remote, lock: (_n, fn) => fn(), yieldToUi: async () => {} }),
      followPage: () => () => undefined,
    }))
    const seen: boolean[] = []
    again.subscribe((e) => void (e.type === 'state' && e.state.vault === VAULT && seen.push(e.state.ready)))
    await again.open(vault)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every(Boolean)).toBe(true)
  })

  it('a refused token is red with UNAUTHORIZED (row N6); the stored files stay', async () => {
    const t = await setup()
    await t.sync.open(vault)
    await t.settled()
    t.s.github.revoke((await t.s.tokens.read(VAULT))!)
    await t.sync.syncNow()
    expect(t.sync.state()).toMatchObject({ status: 'attention', problem: 'UNAUTHORIZED' })
    expect(await t.s.store.read(VAULT, 'a.md')).not.toBeNull()
  })

  it('a sign-out while the engine chunk still loads does not open the engine on the erased vault', async () => {
    const s = await syncSetup(VAULT_FILES)
    let loadNow!: () => void
    const loaded = new Promise<void>((r) => (loadNow = r))
    const opened: (string | null)[] = []
    const sync = lazySync(s.store, s.tokens, async () => {
      await loaded
      return {
        createSyncEngine: (o) => {
          const e = createSyncEngine({ ...o, makeRemote: () => s.remote, lock: (_n, fn) => fn(), yieldToUi: async () => {} })
          const open = e.open.bind(e)
          e.open = async (v) => {
            opened.push(v === null ? null : v.repo)
            return open(v)
          }
          return e
        },
        followPage: () => () => undefined,
      }
    })
    const first = sync.open(vault)
    await new Promise((r) => setTimeout(r, 20))
    await sync.open(null)
    await signOutAndErase(s.store, s.tokens)
    loadNow()
    await first
    await new Promise((r) => setTimeout(r, 100))
    expect(opened.at(-1) ?? null).toBeNull()
    expect(sync.state().vault).toBeNull()
  })
})
