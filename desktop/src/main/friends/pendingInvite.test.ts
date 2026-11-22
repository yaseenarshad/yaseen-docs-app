import { describe, expect, it, vi } from 'vitest'
import { createPendingInviteHandler } from './pendingInvite'

describe('createPendingInviteHandler (YAZ-6222 Item 5)', () => {
  it('stashes an invite deep link when signed out and auto-accepts it once GitHub sign-in completes', async () => {
    let signedIn = false
    const acceptInvite = vi.fn(async () => ({ ok: true as const, result: { kind: 'friend', friendId: 42 } }))
    const notifyRenderer = vi.fn()

    const handler = createPendingInviteHandler({
      isSignedIn: async () => signedIn,
      acceptInvite,
      notifyRenderer,
    })

    await handler.onInviteLink({ kind: 'friend', code: 'k9x2m7ab' })
    expect(notifyRenderer).toHaveBeenCalledWith({ kind: 'friend', code: 'k9x2m7ab' })
    expect(handler.peek()).toEqual({ kind: 'friend', code: 'k9x2m7ab' })
    expect(acceptInvite).not.toHaveBeenCalled()

    // Auth change while still signed out -> stays stashed
    expect(await handler.onAuthChanged()).toBe(false)
    expect(handler.peek()).toEqual({ kind: 'friend', code: 'k9x2m7ab' })

    // User finishes GitHub sign-in -> auto-accepts invite and notifies renderer
    signedIn = true
    expect(await handler.onAuthChanged()).toBe(true)
    expect(acceptInvite).toHaveBeenCalledWith('k9x2m7ab')
    expect(notifyRenderer).toHaveBeenCalledTimes(2)
    expect(handler.peek()).toBeNull()
  })

  it('does not stash the invite when the user is already signed in', async () => {
    const acceptInvite = vi.fn()
    const notifyRenderer = vi.fn()
    const handler = createPendingInviteHandler({
      isSignedIn: async () => true,
      acceptInvite,
      notifyRenderer,
    })

    await handler.onInviteLink({ kind: 'group', code: 'medstudy26' })
    expect(notifyRenderer).toHaveBeenCalledWith({ kind: 'group', code: 'medstudy26' })
    expect(handler.peek()).toBeNull()
    expect(await handler.onAuthChanged()).toBe(false)
    expect(acceptInvite).not.toHaveBeenCalled()
  })
})
