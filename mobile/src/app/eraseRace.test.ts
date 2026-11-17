import { describe, expect, it } from 'vitest'
import { lazySync } from './lazySync'
import { signOutAndErase, forgetVaultAndToken } from '../auth/signIn'
import { createSyncEngine } from '../sync/engine'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { BRANCH, REPO, VAULT, TOKEN, pageText, syncSetup } from '../sync/testing'
import { INDEX_STATE } from '../sync/phoneIndex'
import { idbBackend } from '../store/idbBackend'
import { PHONE, VaultClosedError, memoryBackend, openVaultStore, saveVaultList, loadVaultList, tokenStoreOn } from '../store'

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

async function setupLocked(freeBlobs: number) {
  const s = await syncSetup(FILES)
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let n = 0
  const remote = { ...s.remote, blob: async (sha: string) => { if (n++ >= freeBlobs) await gate; return s.remote.blob(sha) } }
  // a real per-vault lock, as navigator.locks
  const locks = new Map<string, Promise<unknown>>()
  const lock = <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(name) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    locks.set(name, run.catch(() => undefined))
    return run
  }
  const sync = lazySync(s.store, s.tokens, async () => ({
    createSyncEngine: (o) => createSyncEngine({ ...o, makeRemote: () => remote, lock, yieldToUi: async () => {} }),
    followPage: () => () => undefined,
  }))
  await saveVaultList(s.store, { vaults: [vault], open: VAULT })
  return { s, sync, release }
}

describe('YAZ-5193: a pass of an older generation marks nothing done for the new one', () => {
  it('erase, then sign in again to the SAME vault while the old pass runs: the phone holds every page the index and the checkpoint name', async () => {
    const t = await setupLocked(8)
    await t.sync.open(vault)
    await tick(50)
    const before = (await t.s.store.list(VAULT)).length
    await t.sync.open(null)
    await signOutAndErase(t.s.store, t.s.tokens)
    // sign in again (what signIn does): admit, token, list, open
    t.s.store.admit(VAULT)
    await t.s.tokens.write(VAULT, TOKEN)
    await saveVaultList(t.s.store, { vaults: [vault], open: VAULT })
    void t.sync.open(vault)
    await tick(20)
    t.release()
    await tick(400)
    await t.sync.idle()
    const files = (await t.s.store.list(VAULT)).map((e) => e.path).sort()
    const cp = await t.s.store.checkpoint(VAULT)
    const index = await t.s.store.getState<{ records: Record<string, unknown> }>(VAULT, INDEX_STATE)
    const missing = Object.keys(cp?.shas ?? {}).filter((p) => !files.includes(p))
    expect(missing).toEqual([])
  })
  it('"Reset local copy" while the pass runs past the 3 s wait: every page the checkpoint names is stored', async () => {
    const t = await setupLocked(8)
    await t.sync.open(vault)
    await tick(50)
    await t.sync.open(null)
    await t.s.store.resetCopy(VAULT)
    void t.sync.open(vault)
    await tick(20)
    t.release()
    await tick(400)
    await t.sync.idle()
    await t.sync.syncNow()
    const files = (await t.s.store.list(VAULT)).map((e) => e.path)
    const cp = await t.s.store.checkpoint(VAULT)
    const missing = Object.keys(cp?.shas ?? {}).filter((p) => !files.includes(p))
    expect(missing).toEqual([])
  })
})

async function tab(factory: IDBFactory, remote: unknown) {
  const backend = idbBackend({ factory, keyRange: IDBKeyRange, name: 'checker' })
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  const sync = lazySync(store, tokens, async () => ({
    createSyncEngine: (o) => createSyncEngine({ ...o, makeRemote: () => remote as never, lock: (_n, fn) => fn(), yieldToUi: async () => {} }),
    followPage: () => () => undefined,
  }))
  return { backend, store, tokens, sync }
}

async function dump(backend: ReturnType<typeof idbBackend>) {
  const out: Record<string, number> = {}
  for (const t of ['files', 'entries', 'checkpoints', 'state', 'meta']) {
    try { out[t] = (await backend.keys(t as never)).length } catch (e) { out[t] = -1 }
  }
  return out
}

describe('YAZ-5194: the erase holds in every tab (IndexedDB)', () => {
  it('one tab: erase during the first download, the pass ends after the erase', async () => {
    const s = await syncSetup(FILES)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let n = 0
    const remote = { ...s.remote, blob: async (sha: string) => { if (n++ >= 5) await gate; return s.remote.blob(sha) } }
    const factory = new IDBFactory()
    const a = await tab(factory, remote)
    await a.tokens.write(VAULT, TOKEN)
    await saveVaultList(a.store, { vaults: [vault], open: VAULT })
    await a.sync.open(vault)
    await tick(50)
    await a.sync.open(null)
    await signOutAndErase(a.store, a.tokens)
    release()
    await tick(300)
    const d = await dump(a.backend)
    expect(d.files + d.entries + d.checkpoints + d.state).toBe(0)
  })

  it('two tabs: tab 1 erases while tab 2 downloads', async () => {
    const s = await syncSetup(FILES)
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let n = 0
    const remote = { ...s.remote, blob: async (sha: string) => { if (n++ >= 5) await gate; return s.remote.blob(sha) } }
    const factory = new IDBFactory()
    const one = await tab(factory, s.remote)
    await one.tokens.write(VAULT, TOKEN)
    await saveVaultList(one.store, { vaults: [vault], open: VAULT })
    const two = await tab(factory, remote)
    await two.sync.open(vault)
    await tick(50)
    await signOutAndErase(one.store, one.tokens)
    release()
    await tick(300)
    const d = await dump(one.backend)
    expect(d.files + d.entries + d.checkpoints + d.state).toBe(0)
  })
})

describe('the generation of a vault (YAZ-5193, YAZ-5194, the hook for YAZ-5195)', () => {
  it('a session taken before a reset is refused; the plain store and a new session write', async () => {
    const store = await openVaultStore(memoryBackend())
    const old = await store.session('a@main')
    await old.write('a@main', 'x.md', '#')
    await store.resetCopy('a@main')
    await expect(old.write('a@main', 'y.md', '#')).rejects.toBeInstanceOf(VaultClosedError)
    await expect(old.setCheckpoint('a@main', { commit: 'c', etag: '', shas: {} })).rejects.toBeInstanceOf(VaultClosedError)
    await (await store.session('a@main')).write('a@main', 'z.md', '#')
    await store.write('a@main', 'w.md', '#')
    expect((await store.list('a@main')).map((e) => e.path)).toEqual(['w.md', 'z.md'])
  })

  it('an erase in one store object (tab 1) refuses the writes of another on the same database (tab 2)', async () => {
    const backend = memoryBackend()
    const one = await openVaultStore(backend)
    const two = await openVaultStore(backend)
    const pass = await two.session('a@main')
    await two.write('b@main', 'x.md', '#')
    await one.eraseAll()
    await expect(pass.write('a@main', 'x.md', '#')).rejects.toBeInstanceOf(VaultClosedError)
    await expect(two.write('b@main', 'y.md', '#')).rejects.toBeInstanceOf(VaultClosedError)
  })

  it('session(PHONE): a phone-wide sender (the friends sender) is refused after the erase; the sign-in writes the list', async () => {
    const store = await openVaultStore(memoryBackend())
    const sender = await store.session(PHONE)
    await sender.setState(PHONE, 'friendsSend', { at: 1 })
    await store.eraseAll()
    await expect(sender.setState(PHONE, 'friendsSend', { at: 2 })).rejects.toBeInstanceOf(VaultClosedError)
    expect(await store.getState(PHONE, 'friendsSend')).toBeUndefined()
    await saveVaultList(store, { vaults: [], open: null })
  })
})

