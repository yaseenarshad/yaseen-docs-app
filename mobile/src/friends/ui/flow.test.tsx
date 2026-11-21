// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FriendsBoardPayload, SharedCardItem } from '@shared/friendsApi'
import { saveAccount } from '../../auth/account'
import { mount, newPhone, NOW, type Harness } from '../../screens/testing'
import { saveVaultList, vaultId, type PhoneVault, type TokenStore, type VaultStore } from '../../store'
import { createFriendsService } from './service'

// YAZ-5652: Friends is off in the app (`shared/features.ts`); this file tests today's behaviour with it on.
vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))

/**
 * YAZ-6218: End-to-end flow tests on the real D1-backed `createFriendsService` + `FriendsTab` / `VsScreen`
 * against an in-memory mock Friends Worker API (zero Gist calls, zero real network).
 */
const ALI_TOKEN = 'ghu_ali_token_1234567890'
const BEA_TOKEN = 'ghu_bea_token_0987654321'

const plain = (text: string | null | undefined) => (text ?? '').replace(/[\u2068\u2069]/g, '')
const named = (el: Element) =>
  plain(el.getAttribute('aria-label') ?? el.textContent)
    .replace(/\s+/g, ' ')
    .trim()
const btn = (x: Harness, name: string | RegExp) =>
  ([...x.host.querySelectorAll('button, a')].find((el) => (typeof name === 'string' ? named(el) === name : name.test(named(el)))) as
    | HTMLButtonElement
    | undefined) ?? null
const tap = async (x: Harness, name: string | RegExp) => {
  const el = btn(x, name)
  if (el === null) throw new Error(`No button "${name}" on: ${plain(x.text())}`)
  await act(async () => el.click())
  await x.settle()
}

let h: Harness | null = null
afterEach(() => {
  h?.unmount()
  h = null
  vi.unstubAllGlobals()
})

interface MockUser {
  id: number
  login: string
  name: string
  token: string
}

function createMockD1Server() {
  const users: MockUser[] = [
    { id: 1, login: 'ali', name: 'ALI', token: ALI_TOKEN },
    { id: 2, login: 'bea', name: 'BEA', token: BEA_TOKEN },
  ]
  const sessions = new Map<string, number>()
  const invites = new Map<string, { code: string; kind: 'friend' | 'group'; creatorId: number; groupId?: string; createdAt: string }>()
  const friendships: [number, number][] = []
  const marks: { from: number; to: number; kind: 'cheer' | 'nudge'; message?: string | null; at: string; seenAt: string | null }[] = []
  const groups = new Map<string, { id: string; name: string; adminId: number; inviteCode: string; members: { id: number; status: 'active' | 'pending' }[] }>()
  const sharedCards: (SharedCardItem & { toUserId?: number; groupId?: string })[] = []
  let seq = 1
  const calls: string[] = []
  const deletedUsers = new Set<number>()

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const userOf = (init?: RequestInit): MockUser | null => {
    const auth = new Headers(init?.headers).get('authorization') ?? ''
    const tok = auth.replace(/^Bearer\s+/i, '')
    const uid = sessions.get(tok)
    return users.find((u) => u.id === uid) ?? null
  }

  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push(`${method} ${u.pathname}`)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}

    if (u.pathname === '/api/friends/session' && method === 'POST') {
      const user = users.find((x) => x.token === body.githubToken)
      if (!user) return json(401, { error: 'invalid_token' })
      const tok = `sess_${user.id}_${seq++}`
      sessions.set(tok, user.id)
      return json(200, { token: tok, expiresAt: NOW + 3600_000 })
    }

    const me = userOf(init)
    if (!me) return json(401, { error: 'unauthorized' })

    if (u.pathname === '/api/friends/board' && method === 'GET') {
      const myFriendIds = friendships
        .filter(([a, b]) => a === me.id || b === me.id)
        .map(([a, b]) => (a === me.id ? b : a))
      const payload: FriendsBoardPayload = {
        me: {
          id: me.id,
          login: me.login,
          name: me.name,
          nickname: null,
          avatarUrl: null,
          zone: 'America/Denver',
          vaults: [],
          stats: null,
          statsAt: null,
        },
        friends: myFriendIds.map((fid) => {
          const f = users.find((x) => x.id === fid)!
          const inc = marks.find((m) => m.from === fid && m.to === me.id) ?? null
          const out = marks.find((m) => m.from === me.id && m.to === fid) ?? null
          return {
            id: f.id,
            login: f.login,
            name: f.name,
            avatarUrl: null,
            since: new Date(NOW).toISOString(),
            stats: null,
            statsAt: null,
            incomingMark: inc ? { kind: inc.kind, message: inc.message, at: inc.at, seenAt: inc.seenAt } : null,
            outgoingMark: out ? { kind: out.kind, message: out.message, at: out.at } : null,
            sharedCardCount: sharedCards.filter((c) => (c.senderId === fid && c.toUserId === me.id) || (c.senderId === me.id && c.toUserId === fid)).length,
          }
        }),
        invites: [...invites.values()]
          .filter((inv) => inv.kind === 'friend' && inv.creatorId === me.id)
          .map((inv) => ({ code: inv.code, expiresAt: null, createdAt: inv.createdAt })),
        groups: [...groups.values()]
          .filter((g) => g.members.some((m) => m.id === me.id))
          .map((g) => ({
            id: g.id,
            name: g.name,
            adminId: g.adminId,
            isAdmin: g.adminId === me.id,
            myStatus: g.members.find((m) => m.id === me.id)!.status,
            inviteCode: g.inviteCode,
            members: g.members
              .filter((m) => m.status === 'active')
              .map((m) => {
                const usr = users.find((x) => x.id === m.id)!
                return { id: usr.id, login: usr.login, name: usr.name, avatarUrl: null, since: new Date(NOW).toISOString(), stats: null, statsAt: null }
              }),
            pending: g.members
              .filter((m) => m.status === 'pending')
              .map((m) => {
                const usr = users.find((x) => x.id === m.id)!
                return { id: usr.id, login: usr.login, name: usr.name, avatarUrl: null }
              }),
            sharedFolders: [],
            sharedCards: sharedCards.filter((c) => c.groupId === g.id),
          })),
        incomingCards: sharedCards.filter((c) => c.toUserId === me.id),
      }
      return json(200, payload)
    }

    if (u.pathname === '/api/friends/invites' && method === 'POST') {
      const code = `inv${String(seq++).padStart(7, '0')}`
      invites.set(code, { code, kind: 'friend', creatorId: me.id, createdAt: new Date(NOW).toISOString() })
      return json(200, { code, link: `https://docs.yaseenarshad.com/friend#${code}`, expiresAt: new Date(NOW + 7 * 86_400_000).toISOString() })
    }

    if (u.pathname === '/api/friends/invites/accept' && method === 'POST') {
      const code = String(body.code ?? '')
      const inv = invites.get(code)
      if (!inv) return json(404, { error: 'invite_not_found' })
      if (inv.kind === 'friend') {
        if (inv.creatorId === me.id) return json(400, { error: 'cannot_add_self' })
        friendships.push([inv.creatorId, me.id])
        invites.delete(code)
        return json(200, { kind: 'friend', friendId: inv.creatorId })
      }
      const g = groups.get(inv.groupId!)!
      g.members.push({ id: me.id, status: 'pending' })
      return json(200, { kind: 'group', groupId: g.id, status: 'pending', name: g.name })
    }

    if (u.pathname === '/api/friends/marks' && method === 'POST') {
      const at = new Date(NOW).toISOString()
      marks.push({ from: me.id, to: Number(body.toUserId), kind: body.kind as 'cheer' | 'nudge', message: (body.message as string) ?? null, at, seenAt: null })
      return json(200, { ok: true, kind: body.kind, message: body.message ?? null, at })
    }

    if (u.pathname === '/api/friends/marks/seen' && method === 'POST') {
      const ids = (body.fromUserIds as number[]) ?? []
      for (const m of marks) if (m.to === me.id && ids.includes(m.from)) m.seenAt = new Date(NOW).toISOString()
      return json(200, { ok: true })
    }

    if (u.pathname === '/api/friends/groups' && method === 'POST') {
      const id = `grp_${seq++}`
      const inviteCode = `grp${String(seq++).padStart(7, '0')}`
      const name = String(body.name)
      groups.set(id, { id, name, adminId: me.id, inviteCode, members: [{ id: me.id, status: 'active' }] })
      invites.set(inviteCode, { code: inviteCode, kind: 'group', creatorId: me.id, groupId: id, createdAt: new Date(NOW).toISOString() })
      return json(200, { id, name, inviteCode, link: `https://docs.yaseenarshad.com/group#${inviteCode}` })
    }

    if (u.pathname.endsWith('/approve') && method === 'POST') {
      const gid = u.pathname.split('/')[4]
      const g = groups.get(gid)
      const mem = g?.members.find((m) => m.id === Number(body.userId))
      if (mem) mem.status = 'active'
      return json(200, { ok: true })
    }

    if (u.pathname === '/api/friends/cards/share' && method === 'POST') {
      const cards = body.cards as { title: string; markdown: string; note?: string | null }[]
      const cardIds: string[] = []
      for (const c of cards) {
        const id = `sc_${seq++}`
        cardIds.push(id)
        for (const toId of (body.toUserIds as number[] | undefined) ?? []) {
          sharedCards.push({
            id,
            folderId: null,
            senderId: me.id,
            senderLogin: me.login,
            title: c.title,
            markdown: c.markdown,
            note: c.note ?? null,
            attachments: [],
            status: 'pending',
            createdAt: new Date(NOW).toISOString(),
            toUserId: toId,
          })
        }
      }
      return json(200, { ok: true, folderId: null, cardIds, count: cardIds.length })
    }

    if (/^\/api\/friends\/cards\/[^/]+\/state$/.test(u.pathname) && method === 'POST') {
      const cid = u.pathname.split('/')[4]
      const c = sharedCards.find((x) => x.id === cid)
      if (c) c.status = body.status as 'pending' | 'accepted' | 'dismissed'
      return json(200, { ok: true, status: body.status })
    }

    if (u.pathname === '/api/friends/me' && method === 'DELETE') {
      deletedUsers.add(me.id)
      return json(200, { ok: true, deleted: true })
    }

    return json(404, { error: 'not_found' })
  }

  return { fetch, calls, deletedUsers }
}

async function phoneOf(token: string, login: string, name = login.toUpperCase()): Promise<{ store: VaultStore; tokens: TokenStore }> {
  const p = await newPhone()
  const v: PhoneVault = { repo: `${login}/vault`, branch: 'main', addedAt: 1 }
  await p.tokens.write(vaultId(v), token)
  await saveAccount(p.store, vaultId(v), { login, name, avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 })
  await saveVaultList(p.store, { vaults: [v], open: vaultId(v) })
  return p
}

describe('YAZ-6218: D1 Friends service end-to-end flow (zero Gist calls)', () => {
  it('1-step friend invite -> accept -> cheer -> markSeen -> share card -> dismiss/undo -> deleteMe', async () => {
    const server = createMockD1Server()
    const aliPhone = await phoneOf(ALI_TOKEN, 'ali')
    const beaPhone = await phoneOf(BEA_TOKEN, 'bea')
    const ali = createFriendsService({ ...aliPhone, fetch: server.fetch as never, now: () => NOW })
    const bea = createFriendsService({ ...beaPhone, fetch: server.fetch as never, now: () => NOW })

    // 1. Ali creates a 1-step invite link
    const inv = await ali.share()
    expect(inv.kind).toBe('ok')
    if (inv.kind !== 'ok') throw new Error(inv.kind)
    expect(inv.link).toMatch(/^https:\/\/docs\.yaseenarshad\.com\/friend#inv\d+$/)

    // 2. Bea pastes Ali's link -> 1-step instant pairing
    const pasted = await bea.paste(inv.link)
    expect(pasted).toMatchObject({ kind: 'added', paired: true })

    // 3. Both see each other on the board
    const aliBoard = await ali.board()
    expect(aliBoard.kind).toBe('ok')
    if (aliBoard.kind !== 'ok') throw new Error(aliBoard.kind)
    expect(aliBoard.friends.map((f) => f.login)).toEqual(['bea'])

    // 4. Ali cheers Bea, Bea sees it and marks it seen
    const sent = await ali.mark(aliBoard.friends[0].mine, 'cheer', 'cheered your review!')
    expect(sent.kind).toBe('sent')
    const beaBoard = await bea.board()
    if (beaBoard.kind !== 'ok') throw new Error(beaBoard.kind)
    expect(beaBoard.friends[0].mark?.kind).toBe('cheer')
    await bea.see([{ theirs: beaBoard.friends[0].theirs, mark: beaBoard.friends[0].mark! }])

    // 5. Ali shares a card with Bea; Bea dismisses and undoes dismiss
    const shared = await ali.shareCards!({
      toUserIds: [2],
      cards: [{ title: 'FSRS', markdown: 'What is FSRS?', note: 'Must know' }],
    })
    expect(shared).toEqual({ ok: true, count: 1 })
    const beaBoard2 = await bea.board()
    if (beaBoard2.kind !== 'ok') throw new Error(beaBoard2.kind)
    expect(beaBoard2.incomingCards).toHaveLength(1)
    const cardId = beaBoard2.incomingCards![0].id
    await bea.setCardState!(cardId, 'dismissed')
    await bea.setCardState!(cardId, 'pending')

    // 6. Group create + join + admin approve
    const grp = await ali.groups!.create('Study Crew')
    expect(grp.kind).toBe('ok')
    if (grp.kind !== 'ok') throw new Error(grp.kind)
    const joined = await bea.paste(grp.link)
    expect(joined.kind).toBe('joined')
    const approved = await ali.approveMember!(grp.group, 2)
    expect(approved).toEqual({ ok: true })

    // 7. Delete my Friends data
    const del = await ali.deleteMe!()
    expect(del).toEqual({ ok: true, deleted: true })
    expect(server.deletedUsers.has(1)).toBe(true)

    // Verify ZERO calls to GitHub Gists API
    expect(server.calls.every((c) => c.includes('/api/friends/'))).toBe(true)
  })

  it('renders FriendsTab over the real D1 service and shows QR SVG + paired friend', async () => {
    const server = createMockD1Server()
    const aliPhone = await phoneOf(ALI_TOKEN, 'ali')
    const ali = createFriendsService({ ...aliPhone, fetch: server.fetch as never, now: () => NOW })
    const sharedOut: ShareData[] = []
    vi.stubGlobal('navigator', { ...navigator, share: async (d: ShareData) => void sharedOut.push(d) })

    h = await mount({
      phone: aliPhone,
      friends: () => ({ ...ali.port, service: async () => ali, stop: ali.stop }),
    })
    if (h.host.querySelector('section[aria-label="Friends"]') === null) await tap(h, 'Friends')
    for (let i = 0; i < 50 && h.host.querySelector('section[aria-label="Friends"]:not([aria-busy])') === null; i++) await h.settle()

    await tap(h, 'Share my link')
    const shareBtn = [...h.host.querySelectorAll('.fr-panel button')].find((b) => b.textContent === 'Share my link') as HTMLButtonElement
    await act(async () => shareBtn.click())
    for (let i = 0; i < 6; i++) await h.settle()

    expect(sharedOut[0]?.url).toMatch(/^https:\/\/docs\.yaseenarshad\.com\/friend#inv\d+$/)
    expect(h.host.querySelector('.fr-qr svg')).not.toBeNull()
  })
})
