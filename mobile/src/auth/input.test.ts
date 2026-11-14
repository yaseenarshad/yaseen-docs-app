import { describe, expect, it } from 'vitest'
import { cleanToken, isBranchName, parseRepo } from './input'

describe('what the person types or pastes', () => {
  it.each([
    ['yaseen/vault', 'yaseen/vault'],
    ['  Yaseen/My.Vault-2 \n', 'Yaseen/My.Vault-2'],
    ['https://github.com/yaseen/vault', 'yaseen/vault'],
    ['https://github.com/yaseen/vault.git', 'yaseen/vault'],
    ['github.com/yaseen/vault/', 'yaseen/vault'],
    ['https://github.com/yaseen/vault/tree/main', 'yaseen/vault'],
  ])('reads %j as the repo %s', (text, full) => {
    expect(parseRepo(text)?.full).toBe(full)
  })

  it.each(['', 'yaseen', 'yaseen/', '/vault', 'a/b/c', '-bad/vault', 'yaseen/..', 'yaseen/.', 'ya seen/vault', 'https://gitlab.com/a/b', 'yaseen/vault?x=1'])(
    'refuses %j as a repo',
    (text) => {
      expect(parseRepo(text)).toBeNull()
    },
  )

  it('cleans a pasted token: the spaces and line breaks around it go', () => {
    const token = 'github_pat_11ABCDEFG0abcdefghijkl_' + 'x'.repeat(59)
    expect(cleanToken(`  ${token}\n`)).toBe(token)
    expect(cleanToken('ghp_' + 'a'.repeat(36))).toBe('ghp_' + 'a'.repeat(36))
  })

  it.each(['', 'short', 'has space inside_1234567890123', 'github_pat_ünïcode_1234567890', 'x'.repeat(300), 'Bearer github_pat_1234567890123456789'])(
    'refuses %j as a token',
    (text) => {
      expect(cleanToken(text)).toBeNull()
    },
  )

  it.each(['main', 'feat/phone', 'v1.0', 'release-2026'])('accepts the branch %s', (b) => expect(isBranchName(b)).toBe(true))
  it.each(['', '/main', 'main/', 'a..b', 'a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[', 'a\\b', 'x.lock', 'a@{1}', '@', 'a//b'])(
    'refuses the branch %j',
    (b) => expect(isBranchName(b)).toBe(false),
  )
})
