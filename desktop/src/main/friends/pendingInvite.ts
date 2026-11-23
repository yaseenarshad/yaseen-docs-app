/**
 * Stashes an incoming `yaseendocs://friend#<code>` or `yaseendocs://group#<code>` deep link
 * when the user is signed out of GitHub, and auto-accepts + surfaces it once GitHub sign-in finishes (YAZ-6222 Item 5).
 */
export interface InviteDeepLinkPayload {
  kind: 'friend' | 'group'
  code: string
  status?: 'accepted' | 'pending-auth' | 'error'
  result?: unknown
  error?: string
}

export interface PendingInviteDeps {
  isSignedIn: () => Promise<boolean>
  acceptInvite: (code: string) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>
  notifyRenderer: (payload: InviteDeepLinkPayload) => void
}

export interface PendingInviteHandler {
  /** Called when a `yaseendocs://friend#...` or `yaseendocs://group#...` deep link arrives. */
  onInviteLink(payload: InviteDeepLinkPayload): Promise<void>
  /** Called when GitHub auth status changes (e.g. sign-in completes). */
  onAuthChanged(): Promise<boolean>
  /** Current stashed invite, if any (for diagnostics/tests). */
  peek(): InviteDeepLinkPayload | null
}

export function createPendingInviteHandler(deps: PendingInviteDeps): PendingInviteHandler {
  let pending: InviteDeepLinkPayload | null = null

  async function acceptAndNotify(invite: InviteDeepLinkPayload): Promise<void> {
    const res = await deps
      .acceptInvite(invite.code)
      .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : 'accept_failed' }))
    if (res.ok) {
      deps.notifyRenderer({ kind: invite.kind, code: invite.code, status: 'accepted', result: res.result })
    } else {
      deps.notifyRenderer({ kind: invite.kind, code: invite.code, status: 'error', error: res.error })
    }
  }

  return {
    async onInviteLink(payload) {
      const signedIn = await deps.isSignedIn().catch(() => false)
      if (!signedIn) {
        pending = { kind: payload.kind, code: payload.code }
        deps.notifyRenderer({ kind: payload.kind, code: payload.code, status: 'pending-auth' })
        return
      }
      await acceptAndNotify(payload)
    },

    async onAuthChanged() {
      if (pending === null) return false
      const signedIn = await deps.isSignedIn().catch(() => false)
      if (!signedIn) return false
      const invite = pending
      pending = null
      await acceptAndNotify(invite)
      return true
    },

    peek: () => pending,
  }
}
