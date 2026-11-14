import { describe, expect, it } from 'vitest'
import { SAME_WORD, unitTextOf } from '@client/vault/unitWordText'
import type { SignInError } from '../auth/check'
import { FORWARD_LABEL, signInHelp, syncHelp } from './help'
import { IDLE } from './syncPort'

/** One of each typed result of the sign-in logic (3E). The `Record` makes a new kind fail the typecheck here. */
const EACH: Record<SignInError['kind'], SignInError> = {
  'bad-repo': { kind: 'bad-repo' },
  'bad-branch': { kind: 'bad-branch' },
  'bad-token': { kind: 'bad-token' },
  unauthorized: { kind: 'unauthorized' },
  'repo-not-found': { kind: 'repo-not-found', repo: 'yaseen/vault' },
  'no-access': { kind: 'no-access', repo: 'yaseen/vault' },
  'no-contents': { kind: 'no-contents', repo: 'yaseen/vault' },
  'branch-not-found': { kind: 'branch-not-found', repo: 'yaseen/vault', branch: 'gone' },
  'no-vault': { kind: 'no-vault', repo: 'yaseen/vault', branch: 'main' },
  'read-only': { kind: 'read-only', repo: 'yaseen/vault' },
  'already-added': { kind: 'already-added', repo: 'yaseen/vault', branch: 'main' },
  offline: { kind: 'offline' },
  'github-down': { kind: 'github-down' },
  'rate-limited': { kind: 'rate-limited', resetAt: Date.UTC(2026, 10, 13, 13) },
  unexpected: { kind: 'unexpected', status: null },
}

describe('signInHelp: every sign-in result has words and a way forward', () => {
  for (const error of Object.values(EACH))
    it(error.kind, () => {
      const help = signInHelp(error)
      expect(help.message.length).toBeGreaterThan(10)
      expect(FORWARD_LABEL[help.forward]).toBeTruthy()
    })

  it('sends a token problem to the guide, a missing vault to the repo steps, a passing problem to "Try again"', () => {
    expect(signInHelp(EACH.unauthorized).forward).toBe('token-guide')
    expect(signInHelp(EACH['no-contents']).forward).toBe('token-guide')
    expect(signInHelp(EACH['no-vault']).forward).toBe('repo-guide')
    expect(signInHelp(EACH.offline).forward).toBe('retry')
    expect(signInHelp(EACH['already-added']).forward).toBe('open-vault')
  })
})

describe('syncHelp: what a sync problem means for the person', () => {
  const vault = { repo: 'yaseen/vault', branch: 'main', addedAt: 0 }
  const state = (problem: string | null, more = {}) => ({ ...IDLE, vault: 'yaseen/vault@main', problem, ...more })

  it('says nothing when all is well', () => {
    expect(syncHelp(state(null), vault, SAME_WORD, true)).toBeNull()
  })

  it('N6, R12, F6: the person must act, also when the vault is ready', () => {
    expect(syncHelp(state('UNAUTHORIZED'), vault, SAME_WORD, false)?.forward).toBe('sign-in-again')
    expect(syncHelp(state('NOT_FOUND'), vault, SAME_WORD, false)?.message).toContain('The pages on this phone stay readable.')
    expect(syncHelp(state('TREE_TRUNCATED'), vault, SAME_WORD, false)?.message).toContain('shows none of its pages')
  })

  it("no signal and the rate limit are the dot's when the vault is ready, and said during the first download", () => {
    expect(syncHelp(state('OFFLINE'), vault, SAME_WORD, false)).toBeNull()
    expect(syncHelp(state('RATE_LIMITED', { retryAt: null }), vault, SAME_WORD, false)).toBeNull()
    expect(syncHelp(state('OFFLINE'), vault, SAME_WORD, true)?.message).toContain('The download goes on')
    expect(syncHelp(state('RATE_LIMITED', { retryAt: Date.UTC(2026, 10, 13, 13) }), vault, SAME_WORD, true)?.message).toContain('The download goes on after')
  })

  it("uses the vault's word", () => {
    const doc = unitTextOf({ one: 'doc', many: 'docs' })
    expect(syncHelp(state('UNAUTHORIZED'), vault, doc, false)?.message).toContain('The docs on this phone stay readable.')
  })
})
