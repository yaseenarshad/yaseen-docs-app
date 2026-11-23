import { describe, expect, it } from 'vitest'
import { memoryBackend } from '../store/memoryBackend'
import { openVaultStore } from '../store/vaultStore'
import { addVault, saveVaultList, type PhoneVault, type VaultList } from '../store/vaults'
import { saveAccount, type VaultAccount } from './account'
import { chooseFriendsVault, friendsAccount, friendsMessage, loadFriendsAccount } from './friends'

const account = (login: string, gists: VaultAccount['gists'] = 'unknown'): VaultAccount => ({ login, name: null, avatarUrl: '', gists, expiresAt: null, checkedAt: 1 })

describe('which account acts for friends (round 13, item 4; YAZ-6326 D1 Friends)', () => {
  it('no vault: nothing to say', () => {
    expect(friendsAccount([], null)).toEqual({ kind: 'no-vaults' })
  })

  it('uses the first checked vault (including gists: unknown from D1 sign-ins)', () => {
    const state = friendsAccount(
      [
        { vault: 'yaseen/a@main', account: account('yaseen', 'no') },
        { vault: 'yaseen/b@main', account: account('yaseen', 'unknown') },
        { vault: 'yaseen/c@main', account: account('yaseen', 'yes') },
      ],
      null,
    )
    expect(state).toEqual({ kind: 'ok', vault: 'yaseen/b@main', login: 'yaseen' })
    expect(friendsMessage(state)).toBeNull()
  })

  it('the person can choose another checked vault, falling back to first when gone', () => {
    const vaults = [
      { vault: 'yaseen/b@main', account: account('yaseen', 'unknown') },
      { vault: 'yaseen/c@main', account: account('yaseen', 'yes') },
    ]
    expect(friendsAccount(vaults, 'yaseen/c@main')).toEqual({ kind: 'ok', vault: 'yaseen/c@main', login: 'yaseen' })
    expect(friendsAccount(vaults, 'gone/x@main')).toMatchObject({ vault: 'yaseen/b@main' })
  })

  it('vaults on two GitHub accounts: friends work with one, and the app says which', () => {
    const state = friendsAccount(
      [
        { vault: 'yaseen/a@main', account: account('yaseen', 'unknown') },
        { vault: 'work/b@main', account: account('Yaseen-Work', 'unknown') },
        { vault: 'yaseen/c@main', account: account('Yaseen', 'no') },
      ],
      null,
    )
    expect(state).toEqual({ kind: 'two-accounts', vault: 'yaseen/a@main', login: 'yaseen', logins: ['yaseen', 'Yaseen-Work'] })
    expect(friendsMessage(state)).toBe('Your vaults are on two GitHub accounts. Friends use @yaseen.')
  })

  it('a vault with no account facts yet counts as unchecked', () => {
    expect(friendsAccount([{ vault: 'yaseen/a@main', account: undefined }], null)).toEqual({ kind: 'unchecked' })
  })

  it('keeps the choice on the phone, and refuses a vault with no checked account', async () => {
    const store = await openVaultStore(memoryBackend())
    const v = (repo: string): PhoneVault => ({ repo, branch: 'main', addedAt: 1 })
    let list: VaultList = { vaults: [], open: null }
    list = addVault(addVault(addVault(list, v('yaseen/a')), v('yaseen/b')), v('yaseen/c'))
    await saveVaultList(store, list)
    await saveAccount(store, 'yaseen/a@main', account('yaseen', 'unknown'))
    await saveAccount(store, 'yaseen/b@main', account('yaseen', 'unknown'))
    expect(await loadFriendsAccount(store)).toMatchObject({ kind: 'ok', vault: 'yaseen/a@main' })
    await chooseFriendsVault(store, 'yaseen/b@main')
    expect(await loadFriendsAccount(store)).toMatchObject({ kind: 'ok', vault: 'yaseen/b@main' })
    await expect(chooseFriendsVault(store, 'yaseen/c@main')).rejects.toThrow(/checked GitHub account/)
  })
})
