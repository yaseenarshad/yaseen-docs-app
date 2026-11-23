/**
 * Stashes an incoming `yaseendocs://friend#<code>` or `yaseendocs://group#<code>` deep link
 * when the user is signed out of GitHub, and auto-accepts + surfaces it once GitHub sign-in finishes (YAZ-6222 Item 5).
 */
export interface InviteDeepLinkPayload {
  kind: 'friend' | 'group'
  code: string
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

  return {
    async onInviteLink(payload) {
      deps.notifyRenderer(payload)
      const signedIn = await deps.isSignedIn().catch(() => false)
      if (!signedIn) {
        pending = payload
      }
    },

    async onAuthChanged() {
      if (pending === null) return false
      const signedIn = await deps.isSignedIn().catch(() => false)
      if (!signedIn) return false
      const invite = pending
      pending = null
      await deps.acceptInvite(invite.code).catch(() => undefined)
      deps.notifyRenderer(invite)
      return true
    },

    peek: () => pending,
  }
}
