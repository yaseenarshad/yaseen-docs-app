import { describe, expect, it } from 'vitest'
import { memoryBackend } from '../store/memoryBackend'
import { openVaultStore } from '../store/vaultStore'
import { addVault, saveVaultList, type PhoneVault, type VaultList } from '../store/vaults'
import { saveAccount, type VaultAccount } from './account'
import { chooseFriendsVault, friendsAccount, friendsMessage, loadFriendsAccount } from './friends'

const account = (login: string, gists: VaultAccount['gists']): VaultAccount => ({ login, name: null, avatarUrl: '', gists, expiresAt: null, checkedAt: 1 })

describe('which account acts for friends (round 13, item 4)', () => {
  it('no vault: nothing to say', () => {
    expect(friendsAccount([], null)).toEqual({ kind: 'no-vaults' })
  })

  it('uses the first vault whose token has the Gists permission', () => {
    const state = friendsAccount(
      [
        { vault: 'yaseen/a@main', account: account('yaseen', 'no') },
        { vault: 'yaseen/b@main', account: account('yaseen', 'yes') },
        { vault: 'yaseen/c@main', account: account('yaseen', 'yes') },
      ],
      null,
    )
    expect(state).toEqual({ kind: 'ok', vault: 'yaseen/b@main', login: 'yaseen' })
    expect(friendsMessage(state)).toBeNull()
  })

  it('the person can choose another vault with the Gists permission', () => {
    const vaults = [
      { vault: 'yaseen/b@main', account: account('yaseen', 'yes') },
      { vault: 'yaseen/c@main', account: account('yaseen', 'yes') },
    ]
    expect(friendsAccount(vaults, 'yaseen/c@main')).toEqual({ kind: 'ok', vault: 'yaseen/c@main', login: 'yaseen' })
    // A choice that lost the permission, or left the phone, falls back to the first.
    expect(friendsAccount([vaults[0], { vault: 'yaseen/c@main', account: account('yaseen', 'no') }], 'yaseen/c@main')).toMatchObject({ vault: 'yaseen/b@main' })
    expect(friendsAccount(vaults, 'gone/x@main')).toMatchObject({ vault: 'yaseen/b@main' })
  })

  it('no token with the Gists permission: says so, and review still works (no other state)', () => {
    const state = friendsAccount([{ vault: 'yaseen/a@main', account: account('yaseen', 'no') }], null)
    expect(state).toEqual({ kind: 'no-gists', logins: ['yaseen'] })
    expect(friendsMessage(state)).toBe('Friends needs the Gists permission on your token.')
  })

  it('vaults on two GitHub accounts: friends work with one, and the app says which', () => {
    const state = friendsAccount(
      [
        { vault: 'yaseen/a@main', account: account('yaseen', 'yes') },
        { vault: 'work/b@main', account: account('Yaseen-Work', 'yes') },
        { vault: 'yaseen/c@main', account: account('Yaseen', 'no') },
      ],
      null,
    )
    expect(state).toEqual({ kind: 'two-accounts', vault: 'yaseen/a@main', login: 'yaseen', logins: ['yaseen', 'Yaseen-Work'] })
    expect(friendsMessage(state)).toBe('Your vaults are on two GitHub accounts. Friends use @yaseen.')
  })

  it('two accounts and no Gists permission: the Gists message comes first (it is the one that stops friends)', () => {
    const state = friendsAccount(
      [
        { vault: 'yaseen/a@main', account: account('yaseen', 'no') },
        { vault: 'work/b@main', account: account('work', 'no') },
      ],
      null,
    )
    expect(state).toEqual({ kind: 'no-gists', logins: ['yaseen', 'work'] })
  })

  it('the Gists check could not run (no network at sign-in): unchecked, no wrong message', () => {
    const state = friendsAccount([{ vault: 'yaseen/a@main', account: account('yaseen', 'unknown') }], null)
    expect(state).toEqual({ kind: 'unchecked' })
    expect(friendsMessage(state)).toBeNull()
  })

  it('a vault with no account facts yet counts as unchecked', () => {
    expect(friendsAccount([{ vault: 'yaseen/a@main', account: undefined }], null)).toEqual({ kind: 'unchecked' })
  })

  it('keeps the choice on the phone, and refuses a vault without the Gists permission', async () => {
    const store = await openVaultStore(memoryBackend())
    const v = (repo: string): PhoneVault => ({ repo, branch: 'main', addedAt: 1 }) as PhoneVault
    let list: VaultList = { vaults: [], open: null }
    list = addVault(addVault(addVault(list, v('yaseen/a')), v('yaseen/b')), v('yaseen/c'))
    await saveVaultList(store, list)
    await saveAccount(store, 'yaseen/a@main', account('yaseen', 'yes'))
    await saveAccount(store, 'yaseen/b@main', account('yaseen', 'yes'))
    await saveAccount(store, 'yaseen/c@main', account('yaseen', 'no'))
    expect(await loadFriendsAccount(store)).toMatchObject({ kind: 'ok', vault: 'yaseen/a@main' })
    await chooseFriendsVault(store, 'yaseen/b@main')
    expect(await loadFriendsAccount(store)).toMatchObject({ kind: 'ok', vault: 'yaseen/b@main' })
    await expect(chooseFriendsVault(store, 'yaseen/c@main')).rejects.toThrow(/Gists/)
  })
})
