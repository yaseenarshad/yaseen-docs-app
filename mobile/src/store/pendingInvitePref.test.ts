import { describe, expect, it } from 'vitest'
import {
  PENDING_INVITE_TTL_MS,
  readPendingInvite,
  savePendingInvite,
  takePendingInvite,
  type PendingInviteStorage,
} from './pendingInvitePref'

function memStorage(): PendingInviteStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

describe('pendingInvitePref (YAZ-6222)', () => {
  it('saves a friend or group invite and survives a simulated GitHub OAuth round-trip', () => {
    const storage = memStorage()
    const t0 = 1_700_000_000_000
    savePendingInvite({ kind: 'friend', code: 'abc12345', url: 'https://docs.yaseenarshad.com/friend#abc12345' }, storage, t0)

    // After OAuth callback returns 2 minutes later, the pending invite is still available and consumed once.
    const taken = takePendingInvite(storage, t0 + 120_000)
    expect(taken).toEqual({
      kind: 'friend',
      code: 'abc12345',
      url: 'https://docs.yaseenarshad.com/friend#abc12345',
      at: t0,
    })
    expect(readPendingInvite(storage, t0 + 120_000)).toBeNull()
  })

  it('expires pending invites older than 24 hours', () => {
    const storage = memStorage()
    const t0 = 1_700_000_000_000
    savePendingInvite({ kind: 'group', code: 'medstudy26', url: 'https://docs.yaseenarshad.com/group#medstudy26' }, storage, t0)

    expect(readPendingInvite(storage, t0 + PENDING_INVITE_TTL_MS + 1)).toBeNull()
  })
})
