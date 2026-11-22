/**
 * YAZ-6222: Pending Friends / Group invite link stashed on `/friend#<code>` or `/group#<code>` so it survives a
 * GitHub OAuth sign-in round-trip (which navigates away to github.com and back to `/auth/callback` → `/`).
 * Stored in `localStorage` under `mobile/src/store/` (the only folder allowed to touch browser storage).
 */
export const PENDING_INVITE_KEY = 'notecard.pendingFriendsInvite'
export const PENDING_INVITE_TTL_MS = 24 * 60 * 60 * 1000

export interface PendingInvite {
  kind: 'friend' | 'group'
  code: string
  url: string
  at: number
}

export type PendingInviteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const local = (): PendingInviteStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function savePendingInvite(
  invite: { kind: 'friend' | 'group'; code: string; url: string; at?: number },
  storage: PendingInviteStorage | null = local(),
  nowMs: number = Date.now(),
): void {
  try {
    const payload: PendingInvite = {
      kind: invite.kind,
      code: invite.code,
      url: invite.url,
      at: invite.at ?? nowMs,
    }
    storage?.setItem(PENDING_INVITE_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage errors (private mode / quota).
  }
}

export function readPendingInvite(
  storage: PendingInviteStorage | null = local(),
  nowMs: number = Date.now(),
): PendingInvite | null {
  try {
    const raw = storage?.getItem(PENDING_INVITE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingInvite>
    if (
      (parsed.kind !== 'friend' && parsed.kind !== 'group') ||
      typeof parsed.code !== 'string' ||
      parsed.code.trim() === '' ||
      typeof parsed.url !== 'string' ||
      parsed.url.trim() === '' ||
      typeof parsed.at !== 'number'
    ) {
      return null
    }
    if (nowMs - parsed.at > PENDING_INVITE_TTL_MS) {
      storage?.removeItem(PENDING_INVITE_KEY)
      return null
    }
    return { kind: parsed.kind, code: parsed.code, url: parsed.url, at: parsed.at }
  } catch {
    return null
  }
}

export function clearPendingInvite(storage: PendingInviteStorage | null = local()): void {
  try {
    storage?.removeItem(PENDING_INVITE_KEY)
  } catch {
    // Ignore storage errors.
  }
}

/** Reads and removes any valid pending invite so it is auto-handled at most once after sign-in. */
export function takePendingInvite(
  storage: PendingInviteStorage | null = local(),
  nowMs: number = Date.now(),
): PendingInvite | null {
  const pending = readPendingInvite(storage, nowMs)
  if (pending !== null) clearPendingInvite(storage)
  return pending
}
