import { describe, expect, it } from 'vitest'
import { lazySync } from './lazySync'
import { signOutAndErase, forgetVaultAndToken } from '../auth/signIn'
import { createSyncEngine } from '../sync/engine'
import { BRANCH, REPO, VAULT, pageText, syncSetup } from '../sync/testing'
import { PHONE, VaultClosedError, memoryBackend, openVaultStore, saveVaultList, loadVaultList } from '../store'

/** YAZ-5175 (4A1): an erase while a download runs must leave nothing of the vault on the phone. */
const FILES: Record<string, string> = { '.yaseendocs/review.json': '{}' }
for (let i = 0; i < 20; i++) FILES[`p${i}.md`] = pageText(`P${i}`, `P-${i}`)
const vault = { repo: REPO, branch: BRANCH, addedAt: 0 }
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

async function setup() {
  const s = await syncSetup(FILES)
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r)) // holds every blob download
  const remote = { ...s.remote, blob: async (sha: string) => { await gate; return s.remote.blob(sha) } }
  const sync = lazySync(s.store, s.tokens, async () => ({
    createSyncEngine: (o) => createSyncEngine({ ...o, makeRemote: () => remote, lock: (_n, fn) => fn(), yieldToUi: async () => {} }),
    followPage: () => () => undefined,
  }))
  await saveVaultList(s.store, { vaults: [vault], open: VAULT })
  return { s, sync, release }
}

describe('erase while the first download runs', () => {
  it('"Sign out and erase this phone" leaves no file and no checkpoint, also when a pass was running', async () => {
    const t = await setup()
    await t.sync.open(vault)
    await tick()
    await t.sync.open(null) // as AppState.eraseAll
    await signOutAndErase(t.s.store, t.s.tokens)
    t.release()
    await tick(200)
    expect(await t.s.store.checkpoint(VAULT)).toBeNull()
    expect(await t.s.store.read(VAULT, 'p0.md')).toBeNull()
  })

  it('"Remove from this phone" on the open vault leaves no file and no checkpoint, also when a pass was running', async () => {
    const t = await setup()
    await t.sync.open(vault)
    await tick()
    await t.sync.open(null) // as AppState.removeVault
    await forgetVaultAndToken(t.s.store, t.s.tokens, await loadVaultList(t.s.store), VAULT)
    t.release()
    await tick(200)
    expect(await t.s.store.checkpoint(VAULT)).toBeNull()
    expect(await t.s.store.read(VAULT, 'p0.md')).toBeNull()
  })
})

describe('the store refuses the rows of a vault that left the phone (YAZ-5175)', () => {
  it('after removeVault: files, checkpoint and state of that vault are refused; other vaults and the phone write', async () => {
    const store = await openVaultStore(memoryBackend())
    await store.removeVault('a@main')
    await expect(store.write('a@main', 'x.md', '#')).rejects.toBeInstanceOf(VaultClosedError)
    await expect(store.setCheckpoint('a@main', { commit: 'c', etag: '', shas: {} })).rejects.toBeInstanceOf(VaultClosedError)
    await expect(store.setState('a@main', 'answers', [])).rejects.toBeInstanceOf(VaultClosedError)
    await store.write('b@main', 'x.md', '#')
    await store.setState(PHONE, 'vaults', { vaults: [], open: null })
    expect(await store.read('a@main', 'x.md')).toBeNull()
  })

  it('after eraseAll every vault is refused until a sign-in admits it again', async () => {
    const store = await openVaultStore(memoryBackend())
    await store.eraseAll()
    await expect(store.write('b@main', 'x.md', '#')).rejects.toBeInstanceOf(VaultClosedError)
    store.admit('b@main')
    await store.write('b@main', 'x.md', '#')
    expect(await store.read('b@main', 'x.md')).not.toBeNull()
    await expect(store.write('c@main', 'x.md', '#')).rejects.toBeInstanceOf(VaultClosedError)
  })
})

