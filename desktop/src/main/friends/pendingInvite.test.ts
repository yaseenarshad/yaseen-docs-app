import { describe, expect, it, vi } from 'vitest'
import { createPendingInviteHandler } from './pendingInvite'

describe('createPendingInviteHandler (YAZ-6222 Item 5, YAZ-6372)', () => {
  it('stashes an invite deep link when signed out and auto-accepts it once GitHub sign-in completes', async () => {
    let signedIn = false
    const acceptInvite = vi.fn(async () => ({ ok: true as const, result: { kind: 'friend', friendId: 42, alreadyFriends: false } }))
    const notifyRenderer = vi.fn()

    const handler = createPendingInviteHandler({
      isSignedIn: async () => signedIn,
      acceptInvite,
      notifyRenderer,
    })

    await handler.onInviteLink({ kind: 'friend', code: 'k9x2m7ab' })
    expect(notifyRenderer).toHaveBeenCalledWith({ kind: 'friend', code: 'k9x2m7ab', status: 'pending-auth' })
    expect(handler.peek()).toEqual({ kind: 'friend', code: 'k9x2m7ab' })
    expect(acceptInvite).not.toHaveBeenCalled()

    // Auth change while still signed out -> stays stashed
    expect(await handler.onAuthChanged()).toBe(false)
    expect(handler.peek()).toEqual({ kind: 'friend', code: 'k9x2m7ab' })

    // User finishes GitHub sign-in -> auto-accepts invite once and notifies renderer with accepted outcome
    signedIn = true
    expect(await handler.onAuthChanged()).toBe(true)
    expect(acceptInvite).toHaveBeenCalledTimes(1)
    expect(acceptInvite).toHaveBeenCalledWith('k9x2m7ab')
    expect(notifyRenderer).toHaveBeenLastCalledWith({
      kind: 'friend',
      code: 'k9x2m7ab',
      status: 'accepted',
      result: { kind: 'friend', friendId: 42, alreadyFriends: false },
    })
    expect(handler.peek()).toBeNull()
  })

  it('auto-accepts directly when the user is already signed in and notifies renderer with the outcome', async () => {
    const acceptInvite = vi.fn(async () => ({
      ok: true as const,
      result: { kind: 'group', groupId: 'g1', status: 'active', name: 'Founders', alreadyMember: false },
    }))
    const notifyRenderer = vi.fn()
    const handler = createPendingInviteHandler({
      isSignedIn: async () => true,
      acceptInvite,
      notifyRenderer,
    })

    await handler.onInviteLink({ kind: 'group', code: 'medstudy26' })
    expect(acceptInvite).toHaveBeenCalledTimes(1)
    expect(acceptInvite).toHaveBeenCalledWith('medstudy26')
    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'group',
      code: 'medstudy26',
      status: 'accepted',
      result: { kind: 'group', groupId: 'g1', status: 'active', name: 'Founders', alreadyMember: false },
    })
    expect(handler.peek()).toBeNull()
    expect(await handler.onAuthChanged()).toBe(false)
  })

  it('notifies renderer with error status when auto-accept fails', async () => {
    const acceptInvite = vi.fn(async () => ({ ok: false as const, error: 'invite_not_found' }))
    const notifyRenderer = vi.fn()
    const handler = createPendingInviteHandler({
      isSignedIn: async () => true,
      acceptInvite,
      notifyRenderer,
    })

    await handler.onInviteLink({ kind: 'friend', code: 'deadbeef' })
    expect(notifyRenderer).toHaveBeenCalledWith({
      kind: 'friend',
      code: 'deadbeef',
      status: 'error',
      error: 'invite_not_found',
    })
  })
})
