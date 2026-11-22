import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import type { FriendsSendView } from '@shared/types'
import type { FriendsService } from '../friends/service'
import { registerFriendsIpc } from './friends'
import { registered } from './ipcFixture'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

const ev = { sender: { id: 1 } }

function makeMockService(): FriendsService {
  return {
    client: {} as never,
    clearSession: vi.fn(),
    board: vi.fn(async () => ({ ok: true as const, board: { me: { id: 1, login: 'y', name: 'Y', nickname: null, avatarUrl: null, zone: null, vaults: [], stats: null, statsAt: null }, friends: [], invites: [], groups: [], incomingCards: [] } })),
    updatePrefs: vi.fn(async (p) => ({ ok: true as const, vaults: p.vaults ?? [], zone: p.zone ?? null, nickname: p.nickname ?? null })),
    createInvite: vi.fn(async () => ({ ok: true as const, code: 'abc12345', link: 'https://docs.yaseenarshad.com/friend#abc12345', expiresAt: '2026-12-01T00:00:00Z' })),
    acceptInvite: vi.fn(async (code) => ({ ok: true as const, result: { kind: 'friend', code } })),
    removeFriend: vi.fn(async () => ({ ok: true as const })),
    createGroup: vi.fn(async (name) => ({ ok: true as const, id: 'g1', name, inviteCode: 'grp12345', link: 'https://docs.yaseenarshad.com/group#grp12345' })),
    renameGroup: vi.fn(async (_id, name) => ({ ok: true as const, name })),
    removeMember: vi.fn(async () => ({ ok: true as const, deleted: false })),
    banMember: vi.fn(async () => ({ ok: true as const })),
    unbanMember: vi.fn(async () => ({ ok: true as const })),
    rotateGroupInvite: vi.fn(async () => ({ ok: true as const, inviteCode: 'grp99999', link: 'https://docs.yaseenarshad.com/group#grp99999' })),
    shareCards: vi.fn(async (input) => ({ ok: true as const, count: input.cards.length })),
    setCardState: vi.fn(async () => ({ ok: true as const })),
    setFolderState: vi.fn(async () => ({ ok: true as const })),
    deleteSharedCard: vi.fn(async () => ({ ok: true as const })),
    importCards: vi.fn(async () => ({ ok: true as const, paths: ['/v/card.md'] })),
    deleteMe: vi.fn(async () => ({ ok: true as const })),
  }
}

describe('registerFriendsIpc (YAZ-6219)', () => {
  let service: FriendsService
  const view: FriendsSendView = { status: 'sent', lastSentAt: 100, retryAt: null, friends: 2, groups: 1, missing: 0 }

  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear()
    service = makeMockService()
    registerFriendsIpc({
      look: async () => view,
      setVaultIncluded: vi.fn(async (vaultPath, included) => ({ ok: true as const, knownVaults: [{ path: vaultPath, name: 'Demo', included }] })),
      service,
    })
  })

  it('routes all 18 invoke channels to the Friends service and status view', async () => {
    expect(await registered(CONTRACT.friends.status)(ev)).toEqual({ ok: true, value: view })
    expect(await registered(CONTRACT.friends.board)(ev, true)).toMatchObject({ ok: true, value: { ok: true } })
    expect(service.board).toHaveBeenCalledWith(true)

    expect(await registered(CONTRACT.friends.updatePrefs)(ev, { nickname: 'Y' })).toEqual({
      ok: true,
      value: { ok: true, vaults: [], zone: null, nickname: 'Y' },
    })
    expect(await registered(CONTRACT.friends.createInvite)(ev)).toMatchObject({ ok: true, value: { ok: true, code: 'abc12345' } })
    expect(await registered(CONTRACT.friends.acceptInvite)(ev, ' abc12345 ')).toMatchObject({ ok: true, value: { ok: true } })
    expect(service.acceptInvite).toHaveBeenCalledWith('abc12345')

    expect(await registered(CONTRACT.friends.removeFriend)(ev, 7, true)).toEqual({ ok: true, value: { ok: true } })
    expect(service.removeFriend).toHaveBeenCalledWith(7, true)

    expect(await registered(CONTRACT.friends.createGroup)(ev, 'Bio Squad')).toMatchObject({ ok: true, value: { ok: true, name: 'Bio Squad' } })
    expect(await registered(CONTRACT.friends.renameGroup)(ev, 'g1', 'Bio Pro')).toEqual({ ok: true, value: { ok: true, name: 'Bio Pro' } })
    expect(await registered(CONTRACT.friends.removeMember)(ev, 'g1', 7)).toEqual({ ok: true, value: { ok: true, deleted: false } })
    expect(await registered(CONTRACT.friends.banMember)(ev, 'g1', 7)).toEqual({ ok: true, value: { ok: true } })
    expect(await registered(CONTRACT.friends.unbanMember)(ev, 'g1', 7)).toEqual({ ok: true, value: { ok: true } })
    expect(await registered(CONTRACT.friends.rotateGroupInvite)(ev, 'g1')).toMatchObject({ ok: true, value: { ok: true, inviteCode: 'grp99999' } })
    expect(await registered(CONTRACT.friends.shareCards)(ev, { toUserIds: [7], cards: [{ title: 'T', markdown: 'M' }] })).toEqual({ ok: true, value: { ok: true, count: 1 } })
    expect(await registered(CONTRACT.friends.setCardState)(ev, 'c1', 'accepted')).toEqual({ ok: true, value: { ok: true } })
    expect(await registered(CONTRACT.friends.setFolderState)(ev, 'f1', 'dismissed')).toEqual({ ok: true, value: { ok: true } })
    expect(await registered(CONTRACT.friends.deleteSharedCard)(ev, 'c1')).toEqual({ ok: true, value: { ok: true } })
    expect(await registered(CONTRACT.friends.importCards)(ev, { root: '/v', dir: 'Shared', cards: [{ id: 'c1', title: 'T', markdown: 'M', senderLogin: 'ali' }] })).toEqual({
      ok: true,
      value: { ok: true, paths: ['/v/card.md'] },
    })
    expect(await registered(CONTRACT.friends.deleteMe)(ev)).toEqual({ ok: true, value: { ok: true } })
    expect(await registered(CONTRACT.friends.setVaultIncluded)(ev, '/v/scratch', false)).toEqual({
      ok: true,
      value: { ok: true, knownVaults: [{ path: '/v/scratch', name: 'Demo', included: false }] },
    })
  })

  it('rejects malformed arguments cleanly without invoking the service', async () => {
    expect(await registered(CONTRACT.friends.acceptInvite)(ev, '')).toEqual({ ok: true, value: { ok: false, error: 'Invalid invite code' } })
    expect(await registered(CONTRACT.friends.removeFriend)(ev, -1)).toEqual({ ok: true, value: { ok: false, error: 'Invalid userId' } })
    expect(await registered(CONTRACT.friends.setCardState)(ev, 'c1', 'bogus')).toEqual({ ok: true, value: { ok: false, error: 'Invalid cardId or status' } })
    expect(service.acceptInvite).not.toHaveBeenCalled()
    expect(service.removeFriend).not.toHaveBeenCalled()
    expect(service.setCardState).not.toHaveBeenCalled()
  })
})
