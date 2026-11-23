import { describe, expect, it } from 'vitest'
import { vaultTitle } from './vaultTitle'

describe("YAZ-5659: a vault's name in words, from its repo", () => {
  it('drops the owner, splits on - and _, drops a last "vault", starts each word with a capital', () => {
    expect(vaultTitle('yaseenarshad/notecards-scratch-vault')).toBe('Notecards Scratch')
    expect(vaultTitle('yaseenarshad/yaseen-docs-vault')).toBe('Yaseen Docs')
    expect(vaultTitle('someone/work_notes')).toBe('Work Notes')
    expect(vaultTitle('someone/Team-VAULT')).toBe('Team')
    expect(vaultTitle('someone/my--odd__repo')).toBe('My Odd Repo')
    // Only "vault" in the middle stays; a repo named only "vault" keeps it.
    expect(vaultTitle('someone/vault-of-ideas')).toBe('Vault Of Ideas')
    expect(vaultTitle('yaseen/vault')).toBe('Vault')
    // Letters inside a word keep their case; a name with no owner works too.
    expect(vaultTitle('someone/iOS-notes')).toBe('IOS Notes')
    expect(vaultTitle('notes2026')).toBe('Notes2026')
  })
})
