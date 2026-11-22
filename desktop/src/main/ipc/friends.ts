import { isRecord } from '@shared/guards'
import { CONTRACT } from '@shared/ipc'
import type { FriendsSendView } from '@shared/types'
import type { SharedCardStatus } from '@shared/friendsApi'
import type { FriendsService } from '../friends/service'
import { handle } from './envelope'

export interface FriendsIpcTarget {
  look(): Promise<FriendsSendView>
  setVaultIncluded?(vaultPath: string, included: boolean): Promise<{ ok: true; knownVaults: { path: string; name: string; included: boolean }[] } | { ok: false; error: string }>
  service: FriendsService
}

const CARD_STATUSES = new Set<SharedCardStatus>(['pending', 'accepted', 'dismissed'])

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}

function isCardStatus(v: unknown): v is SharedCardStatus {
  return typeof v === 'string' && CARD_STATUSES.has(v as SharedCardStatus)
}

/**
 * Registers all `friends:*` IPC handlers (`CONTRACT.friends`, YAZ-6219).
 * Tokens never cross IPC; all API calls run in main via `FriendsService`.
 */
export function registerFriendsIpc(getTarget: FriendsIpcTarget | (() => Promise<FriendsIpcTarget>)): void {
  const resolve = typeof getTarget === 'function' ? getTarget : async () => getTarget

  handle(CONTRACT.friends.status, async () => (await resolve()).look())

  handle(CONTRACT.friends.board, async (force: unknown) => {
    const { service } = await resolve()
    return service.board(force === true)
  })

  handle(CONTRACT.friends.updatePrefs, async (prefs: unknown) => {
    if (!isRecord(prefs)) return { ok: false as const, error: 'Invalid preferences' }
    const cleaned: { vaults?: string[]; zone?: string | null; nickname?: string | null } = {}
    if (Array.isArray(prefs.vaults) && prefs.vaults.every((v) => typeof v === 'string')) cleaned.vaults = prefs.vaults
    if (prefs.zone === null || typeof prefs.zone === 'string') cleaned.zone = prefs.zone
    if (prefs.nickname === null || typeof prefs.nickname === 'string') cleaned.nickname = prefs.nickname
    const { service } = await resolve()
    return service.updatePrefs(cleaned)
  })

  handle(CONTRACT.friends.createInvite, async () => {
    const { service } = await resolve()
    return service.createInvite()
  })

  handle(CONTRACT.friends.acceptInvite, async (code: unknown) => {
    if (!isNonEmptyString(code)) return { ok: false as const, error: 'Invalid invite code' }
    const { service } = await resolve()
    return service.acceptInvite(code.trim())
  })

  handle(CONTRACT.friends.removeFriend, async (userId: unknown, block: unknown) => {
    if (!isPositiveInt(userId)) return { ok: false as const, error: 'Invalid userId' }
    const { service } = await resolve()
    return service.removeFriend(userId, block === true)
  })

  handle(CONTRACT.friends.createGroup, async (name: unknown) => {
    if (!isNonEmptyString(name)) return { ok: false as const, error: 'Group name is required' }
    const { service } = await resolve()
    return service.createGroup(name.trim())
  })

  handle(CONTRACT.friends.removeMember, async (groupId: unknown, userId: unknown) => {
    if (!isNonEmptyString(groupId)) return { ok: false as const, error: 'Invalid groupId' }
    if (userId !== undefined && !isPositiveInt(userId)) return { ok: false as const, error: 'Invalid userId' }
    const { service } = await resolve()
    return service.removeMember(groupId.trim(), userId)
  })

  handle(CONTRACT.friends.rotateGroupInvite, async (groupId: unknown) => {
    if (!isNonEmptyString(groupId)) return { ok: false as const, error: 'Invalid groupId' }
    const { service } = await resolve()
    return service.rotateGroupInvite(groupId.trim())
  })

  handle(CONTRACT.friends.shareCards, async (input: unknown) => {
    if (!isRecord(input) || !Array.isArray(input.cards) || input.cards.length === 0) {
      return { ok: false as const, error: 'Invalid share payload' }
    }
    const cards: { title: string; markdown: string; note?: string | null }[] = []
    for (const c of input.cards) {
      if (!isRecord(c) || typeof c.title !== 'string' || typeof c.markdown !== 'string') {
        return { ok: false as const, error: 'Invalid card in share payload' }
      }
      cards.push({
        title: c.title,
        markdown: c.markdown,
        ...(c.note === null || typeof c.note === 'string' ? { note: c.note } : {}),
      })
    }
    const { service } = await resolve()
    return service.shareCards({
      ...(isNonEmptyString(input.groupId) ? { groupId: input.groupId.trim() } : {}),
      ...(Array.isArray(input.toUserIds) ? { toUserIds: input.toUserIds.filter(isPositiveInt) } : {}),
      ...(isNonEmptyString(input.folderName) ? { folderName: input.folderName.trim() } : {}),
      cards,
    })
  })

  handle(CONTRACT.friends.setCardState, async (cardId: unknown, status: unknown) => {
    if (!isNonEmptyString(cardId) || !isCardStatus(status)) return { ok: false as const, error: 'Invalid cardId or status' }
    const { service } = await resolve()
    return service.setCardState(cardId.trim(), status)
  })

  handle(CONTRACT.friends.setFolderState, async (folderId: unknown, status: unknown) => {
    if (!isNonEmptyString(folderId) || !isCardStatus(status)) return { ok: false as const, error: 'Invalid folderId or status' }
    const { service } = await resolve()
    return service.setFolderState(folderId.trim(), status)
  })

  handle(CONTRACT.friends.deleteSharedCard, async (cardId: unknown) => {
    if (!isNonEmptyString(cardId)) return { ok: false as const, error: 'Invalid cardId' }
    const { service } = await resolve()
    return service.deleteSharedCard(cardId.trim())
  })

  handle(CONTRACT.friends.importCards, async (input: unknown) => {
    if (!isRecord(input) || typeof input.root !== 'string' || typeof input.dir !== 'string' || !Array.isArray(input.cards)) {
      return { ok: false as const, error: 'Invalid import payload' }
    }
    const cards: { id: string; title: string; markdown: string; senderLogin: string; upNext?: boolean }[] = []
    for (const c of input.cards) {
      if (!isRecord(c) || typeof c.id !== 'string' || typeof c.title !== 'string' || typeof c.markdown !== 'string' || typeof c.senderLogin !== 'string') {
        return { ok: false as const, error: 'Invalid card in import payload' }
      }
      cards.push({
        id: c.id,
        title: c.title,
        markdown: c.markdown,
        senderLogin: c.senderLogin,
        ...(typeof c.upNext === 'boolean' ? { upNext: c.upNext } : {}),
      })
    }
    const { service } = await resolve()
    return service.importCards({
      root: input.root,
      dir: input.dir,
      cards,
      ...(typeof input.createFolder === 'string' && input.createFolder.trim() !== '' ? { createFolder: input.createFolder } : {}),
    })
  })

  handle(CONTRACT.friends.deleteMe, async () => {
    const { service } = await resolve()
    return service.deleteMe()
  })

  handle(CONTRACT.friends.setVaultIncluded, async (vaultPath: unknown, included: unknown) => {
    if (!isNonEmptyString(vaultPath) || typeof included !== 'boolean') {
      return { ok: false as const, error: 'Invalid vaultPath or included flag' }
    }
    const target = await resolve()
    if (!target.setVaultIncluded) return { ok: false as const, error: 'Vault preferences unavailable' }
    return target.setVaultIncluded(vaultPath, included)
  })
}
