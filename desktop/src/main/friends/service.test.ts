import { describe, expect, it, vi } from 'vitest'
import { createFriendsService, parseFriendsInviteDeepLink } from './service'

function mockJsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

describe('parseFriendsInviteDeepLink', () => {
  it('parses friend and group deep links in hash and query forms', () => {
    expect(parseFriendsInviteDeepLink('yaseendocs://friend#abc12345')).toEqual({ kind: 'friend', code: 'abc12345' })
    expect(parseFriendsInviteDeepLink('yaseendocs://group#XYZ98765')).toEqual({ kind: 'group', code: 'xyz98765' })
    expect(parseFriendsInviteDeepLink('yaseendocs://friend?code=Abc12345')).toEqual({ kind: 'friend', code: 'abc12345' })
  })

  it('rejects non-invite links', () => {
    expect(parseFriendsInviteDeepLink('yaseendocs:///Users/me/vault/Note.md')).toBeNull()
    expect(parseFriendsInviteDeepLink('yaseendocs://auth/callback?code=123456&state=mac.x')).toBeNull()
    expect(parseFriendsInviteDeepLink('https://docs.yaseenarshad.com/friend#abc12345')).toBeNull()
    expect(parseFriendsInviteDeepLink('yaseendocs://friend#ab')).toBeNull()
  })
})

describe('createFriendsService (YAZ-6219)', () => {
  it('returns { ok: false, error: "signed_out" } when no GitHub token is available', async () => {
    const fetchFn = vi.fn()
    const svc = createFriendsService({ getGithubToken: async () => null, fetch: fetchFn })
    expect(await svc.board()).toEqual({ ok: false, error: 'signed_out' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('exchanges GitHub token for session and proxies board, invites, marks, groups, and card sharing', async () => {
    const seen: { url: string; method: string; body: unknown }[] = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null
      seen.push({ url, method, body })

      if (url.endsWith('/api/friends/session')) {
        return mockJsonResponse({ token: 'sess_123', expiresAt: Date.now() + 3_600_000 })
      }
      if (url.endsWith('/api/friends/board')) {
        return mockJsonResponse({
          me: { id: 1, login: 'yaseen', name: 'Yaseen', nickname: null, avatarUrl: null, zone: null, vaults: [], stats: null, statsAt: null },
          friends: [],
          invites: [],
          groups: [],
          incomingCards: [],
        })
      }
      if (url.endsWith('/api/friends/invites') && method === 'POST') {
        return mockJsonResponse({ code: 'abc12345', link: 'https://docs.yaseenarshad.com/friend#abc12345', expiresAt: '2026-11-28T00:00:00Z' })
      }
      if (url.endsWith('/api/friends/cards/share')) {
        return mockJsonResponse({ ok: true, folderId: null, cardIds: ['c1'], count: 1 })
      }
      if (url.endsWith('/api/friends/me') && method === 'DELETE') {
        return mockJsonResponse({ ok: true, deleted: true })
      }
      if (url.endsWith('/api/friends/avatar') && method === 'PUT') {
        return mockJsonResponse({ ok: true, avatarUrl: 'https://docs.yaseenarshad.com/api/friends/avatar/1?v=abc123', hasCustomAvatar: true })
      }
      if (url.endsWith('/api/friends/avatar') && method === 'DELETE') {
        return mockJsonResponse({ ok: true, avatarUrl: 'https://avatars.githubusercontent.com/u/1', hasCustomAvatar: false })
      }
      return mockJsonResponse({ error: 'unexpected' }, 404)
    })

    const svc = createFriendsService({
      origin: 'https://docs.yaseenarshad.com',
      getGithubToken: async () => 'ghu_secret_token',
      fetch: fetchFn,
    })

    const boardRes = await svc.board()
    expect(boardRes.ok).toBe(true)
    if (boardRes.ok) expect(boardRes.board.me.login).toBe('yaseen')

    const inviteRes = await svc.createInvite()
    expect(inviteRes).toEqual({
      ok: true,
      code: 'abc12345',
      link: 'https://docs.yaseenarshad.com/friend#abc12345',
      expiresAt: '2026-11-28T00:00:00Z',
    })

    // Verifies shareCards sanitizes sender card IDs / frontmatter before sending
    const shareRes = await svc.shareCards({
      toUserIds: [2],
      cards: [{ title: '  My Card  ', markdown: '---\nkind: card\n---\nQ\n---\nA\n<!-- card: YAZ-99, 2026-11-20T00:00:00.000Z good 4s -->', note: '  try this  ' }],
    })
    expect(shareRes).toEqual({ ok: true, count: 1 })
    const shareReq = seen.find((r) => r.url.endsWith('/api/friends/cards/share'))!
    const sentCards = (shareReq.body as { cards: { title: string; markdown: string; note: string | null }[] }).cards
    expect(sentCards[0].title).toBe('My Card')
    expect(sentCards[0].markdown).not.toContain('YAZ-99')
    expect(sentCards[0].markdown).not.toContain('kind: card')
    expect(sentCards[0].note).toBe('try this')

    expect(await svc.uploadAvatar({ contentType: 'image/webp', dataBase64: 'UklGRg==' })).toEqual({
      ok: true,
      avatarUrl: 'https://docs.yaseenarshad.com/api/friends/avatar/1?v=abc123',
      hasCustomAvatar: true,
    })
    expect(await svc.deleteAvatar()).toEqual({
      ok: true,
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      hasCustomAvatar: false,
    })

    expect(await svc.deleteMe()).toEqual({ ok: true })
  })

  it('surfaces API error codes cleanly', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith('/api/friends/session')) {
        return mockJsonResponse({ token: 'sess_123', expiresAt: Date.now() + 3_600_000 })
      }
      return mockJsonResponse({ error: 'invite_expired' }, 410)
    })
    const svc = createFriendsService({ getGithubToken: async () => 'ghu_tok', fetch: fetchFn })
    expect(await svc.acceptInvite('deadbeef')).toEqual({ ok: false, error: 'invite_expired' })
  })

  it('serves stateful demo board when YASEEN_DOCS_FRIENDS_DEMO=1', async () => {
    vi.stubEnv('YASEEN_DOCS_FRIENDS_DEMO', '1')
    try {
      const fetchFn = vi.fn()
      const svc = createFriendsService({ getGithubToken: async () => null, fetch: fetchFn })
      const b1 = await svc.board()
      expect(b1.ok).toBe(true)
      if (!b1.ok) return
      expect(b1.board.me.stats?.days[0].cards).toBe(42)
      expect(b1.board.me.stats?.totals.streak).toBe(14)
      expect(b1.board.friends.map((f) => f.name)).toEqual(['Maya', 'Sam', 'Trevor', 'Ali', 'Nina'])
      expect(b1.board.groups[0].name).toBe('Med Study')
      expect(b1.board.groups[0].sharedFolders[0].cards).toHaveLength(3)
      expect(b1.board.incomingCards).toHaveLength(1)

      await svc.setCardState('sc-dismissed-1', 'pending')
      await svc.setFolderState('fld-biochem', 'accepted')
      expect(await svc.renameGroup('grp-med-study', 'MCAT Med')).toEqual({ ok: true, name: 'MCAT Med' })
      expect(await svc.banMember('grp-med-study', 3)).toEqual({ ok: true })
      const bBanned = await svc.board()
      expect(bBanned.ok && bBanned.board.groups[0].banned?.map((x) => x.id)).toEqual([3])
      expect(await svc.unbanMember('grp-med-study', 3)).toEqual({ ok: true })

      const b2 = await svc.board()
      expect(b2.ok).toBe(true)
      if (!b2.ok) return
      expect(b2.board.friends[0].buddyStreak).toBe(6)
      expect(b2.board.groups[0].name).toBe('MCAT Med')
      expect(b2.board.groups[0].pending).toHaveLength(0)
      expect(b2.board.groups[0].banned).toEqual([])
      expect(b2.board.groups[0].members).toHaveLength(2)
      expect(b2.board.groups[0].sharedFolders[0].cards.every((c) => c.status === 'accepted')).toBe(true)
      expect(b2.board.groups[0].sharedCards.find((c) => c.id === 'sc-dismissed-1')?.status).toBe('pending')

      // Demo deck browsing (Maya has canBrowseDeck: true + realistic multi-folder tree)
      const maya = b2.board.friends.find((f) => f.id === 2)
      expect(maya?.canBrowseDeck).toBe(true)
      expect(maya?.browsableVaults).toEqual([{ repo: 'maya/med-notes', name: 'Med Notes' }])

      const tree = await svc.browseDeckTree(2, 'maya/med-notes')
      expect(tree.ok).toBe(true)
      if (!tree.ok) throw new Error('expected tree')
      expect(tree.tree.files.map((f) => f.path)).toEqual([
        'Biochem/ATP Synthase.md',
        'Biochem/PFK-1 Regulation.md',
        'Biochem/Henderson-Hasselbalch.md',
        'Spanish/Subjunctive Triggers.md',
        'README.md',
      ])

      const file = await svc.browseDeckFile(2, 'maya/med-notes', 'Biochem/ATP Synthase.md')
      expect(file.ok).toBe(true)
      if (!file.ok) throw new Error('expected file')
      expect(file.file.title).toBe('ATP Synthase')
      expect(file.file.markdown).toContain('ATP Synthase')

      const savedDeck = await svc.saveDeckSettings({
        mode: 'selected',
        vaults: [{ repo: 'yaseen/med-notes', installationId: 1001, name: 'Med Notes' }],
        allowedFriendIds: [2],
      })
      expect(savedDeck.ok).toBe(true)
      const loadedDeck = await svc.getDeckSettings()
      expect(loadedDeck).toEqual({
        ok: true,
        settings: {
          mode: 'selected',
          vaults: [{ repo: 'yaseen/med-notes', installationId: 1001, name: 'Med Notes' }],
          allowedFriendIds: [2],
        },
      })

      // Demo custom avatar upload, delete, and live nickname persistence (YAZ-6299)
      const defaultAvatar = b1.board.me.avatarUrl
      const uploaded = await svc.uploadAvatar({ contentType: 'image/webp', dataBase64: 'UklGRg==' })
      expect(uploaded).toEqual({
        ok: true,
        avatarUrl: 'data:image/webp;base64,UklGRg==',
        hasCustomAvatar: true,
      })
      const bAvatar = await svc.board()
      expect(bAvatar.ok && bAvatar.board.me.avatarUrl).toBe('data:image/webp;base64,UklGRg==')
      expect(bAvatar.ok && (bAvatar.board.me as { hasCustomAvatar?: boolean }).hasCustomAvatar).toBe(true)

      const resetAvatar = await svc.deleteAvatar()
      expect(resetAvatar).toEqual({
        ok: true,
        avatarUrl: defaultAvatar,
        hasCustomAvatar: false,
      })
      const bReset = await svc.board()
      expect(bReset.ok && bReset.board.me.avatarUrl).toBe(defaultAvatar)
      expect(bReset.ok && (bReset.board.me as { hasCustomAvatar?: boolean }).hasCustomAvatar).toBe(false)

      expect(await svc.updatePrefs({ nickname: 'Yas A' })).toMatchObject({ ok: true, nickname: 'Yas A' })
      const bNick = await svc.board()
      expect(bNick.ok && bNick.board.me.nickname).toBe('Yas A')
      expect(bNick.ok && bNick.board.me.name).toBe('Yas A')

      expect(await svc.updatePrefs({ nickname: null })).toMatchObject({ ok: true, nickname: null })
      const bCleared = await svc.board()
      expect(bCleared.ok && bCleared.board.me.nickname).toBeNull()
      expect(bCleared.ok && bCleared.board.me.name).toBe('Yaseen')

      expect(fetchFn).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
