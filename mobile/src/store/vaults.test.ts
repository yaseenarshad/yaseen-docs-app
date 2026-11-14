import { describe, expect, it } from 'vitest'
import { memoryBackend } from './memoryBackend'
import { PHONE, openVaultStore } from './vaultStore'
import { addVault, forgetVault, loadVaultList, openVault, openVaultOf, pollingVault, removeVault, saveVaultList, vaultId, type PhoneVault, type VaultList } from './vaults'

const vault = (repo: string, branch = 'main', addedAt = 1): PhoneVault => ({ repo, branch, addedAt })
const EMPTY: VaultList = { vaults: [], open: null }

describe('the vault list (decision 7: several vaults)', () => {
  it('a vault is a whole repo and branch, with no folder; its id ignores the case of the repo, as GitHub does', () => {
    expect(Object.keys(vault('a/one')).sort()).toEqual(['addedAt', 'branch', 'repo'])
    expect(vaultId(vault('Yaseen/Vault'))).toBe('yaseen/vault@main')
    expect(vaultId(vault('yaseen/vault', 'phone'))).not.toBe(vaultId(vault('yaseen/vault')))
  })

  it('the first vault added opens; a second one is added and the open one stays open', () => {
    const one = addVault(EMPTY, vault('a/one'))
    expect(one.open).toBe('a/one@main')
    const two = addVault(one, vault('b/two'))
    expect(two.vaults.map(vaultId)).toEqual(['a/one@main', 'b/two@main'])
    expect(two.open).toBe('a/one@main')
  })

  it('the same repo and branch is not added two times', () => {
    const one = addVault(EMPTY, vault('a/one'))
    expect(() => addVault(one, vault('A/One', 'main', 9))).toThrow(/already/)
  })

  it('only the open vault polls GitHub', () => {
    const list = openVault(addVault(addVault(EMPTY, vault('a/one')), vault('b/two')), 'b/two@main')
    expect(pollingVault(list)).toEqual(vault('b/two'))
    expect(openVaultOf(list)).toEqual(vault('b/two'))
    expect(pollingVault(EMPTY)).toBeNull()
  })

  it('a vault that is not in the list cannot open', () => {
    expect(() => openVault(addVault(EMPTY, vault('a/one')), 'x/y@main')).toThrow(/not on this phone/)
  })

  it('removing the open vault opens the first one left, or none', () => {
    const list = openVault(addVault(addVault(EMPTY, vault('a/one')), vault('b/two')), 'b/two@main')
    const left = removeVault(list, 'b/two@main')
    expect(left).toEqual({ vaults: [vault('a/one')], open: 'a/one@main' })
    expect(removeVault(left, 'a/one@main')).toEqual(EMPTY)
    expect(removeVault(list, 'a/one@main').open).toBe('b/two@main')
  })

  it('the list is phone-only state in the store; a phone with none has an empty list', async () => {
    const store = await openVaultStore(memoryBackend())
    expect(await loadVaultList(store)).toEqual(EMPTY)
    const list = addVault(EMPTY, vault('a/one'))
    await saveVaultList(store, list)
    expect(await loadVaultList(store)).toEqual(list)
    expect(await store.getState(PHONE, 'vaults')).toEqual(list)
  })

  it('forgetting a vault removes its stored files first, then takes it off the list', async () => {
    const store = await openVaultStore(memoryBackend())
    const list = addVault(addVault(EMPTY, vault('a/one')), vault('b/two'))
    await saveVaultList(store, list)
    await store.write('a/one@main', 'p.md', 'x')
    await store.write('b/two@main', 'p.md', 'y')
    const left = await forgetVault(store, list, 'a/one@main')
    expect(left.vaults.map(vaultId)).toEqual(['b/two@main'])
    expect(await loadVaultList(store)).toEqual(left)
    expect(await store.list('a/one@main')).toEqual([])
    expect((await store.read('b/two@main', 'p.md'))?.content).toBe('y')
  })
})
