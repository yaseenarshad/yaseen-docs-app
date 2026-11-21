import {
  createFriendsApiClient,
  FriendsApiError,
  type FriendsApiClient,
  type FriendsBoardPayload,
  type MarkKind,
  type SharedCardItem,
  type SharedCardStatus,
} from '@shared/friendsApi'
import { dayIn, type FriendDay, type FriendStats } from '@shared/friendStatsFormat'
import { sanitizeSharedCard } from '@shared/friendsShare'
import { importSharedCards, type ImportCardsDeps, type ImportCardsInput } from './importCards'

export interface FriendsServiceDeps {
  getGithubToken: () => Promise<string | null>
  origin?: string
  fetch?: (url: string, init?: RequestInit) => Promise<Response>
  now?: () => number
  importDeps?: ImportCardsDeps
}

export interface FriendsService {
  readonly client: FriendsApiClient
  clearSession(): void
  board(force?: boolean): Promise<{ ok: true; board: FriendsBoardPayload } | { ok: false; error: string }>
  updatePrefs(prefs: { vaults?: string[]; zone?: string | null; nickname?: string | null }): Promise<
    { ok: true; vaults: string[]; zone: string | null; nickname: string | null } | { ok: false; error: string }
  >
  createInvite(): Promise<{ ok: true; code: string; link: string; expiresAt: string } | { ok: false; error: string }>
  acceptInvite(code: string): Promise<{ ok: true; result: unknown } | { ok: false; error: string }>
  removeFriend(userId: number, block?: boolean): Promise<{ ok: true } | { ok: false; error: string }>
  sendMark(toUserId: number, kind: MarkKind, message?: string): Promise<{ ok: true } | { ok: false; error: string }>
  markSeen(fromUserIds?: number[]): Promise<{ ok: true } | { ok: false; error: string }>
  createGroup(name: string): Promise<{ ok: true; id: string; name: string; inviteCode: string; link: string } | { ok: false; error: string }>
  approveMember(groupId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string }>
  removeMember(groupId: string, userId?: number): Promise<{ ok: true; deleted?: boolean } | { ok: false; error: string }>
  rotateGroupInvite(groupId: string): Promise<{ ok: true; inviteCode: string; link: string } | { ok: false; error: string }>
  shareCards(input: {
    groupId?: string
    toUserIds?: number[]
    folderName?: string
    cards: { title: string; markdown: string; note?: string | null }[]
  }): Promise<{ ok: true; count: number } | { ok: false; error: string }>
  setCardState(cardId: string, status: SharedCardStatus): Promise<{ ok: true } | { ok: false; error: string }>
  setFolderState(folderId: string, status: SharedCardStatus): Promise<{ ok: true } | { ok: false; error: string }>
  deleteSharedCard(cardId: string): Promise<{ ok: true } | { ok: false; error: string }>
  importCards(input: ImportCardsInput): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }>
  deleteMe(): Promise<{ ok: true } | { ok: false; error: string }>
}

function errorText(err: unknown): string {
  if (err instanceof FriendsApiError) return err.code
  return err instanceof Error ? err.message : String(err)
}

async function wrap<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn()
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** Parses a `yaseendocs://friend#<code>` or `yaseendocs://group#<code>` desktop deep link. */
export function parseFriendsInviteDeepLink(rawUrl: string): { kind: 'friend' | 'group'; code: string } | null {
  const m = /^yaseendocs:\/\/\/?(friend|group)[#/?](?:code=)?([a-z0-9]{6,32})$/i.exec(rawUrl.trim())
  if (!m) return null
  return { kind: m[1].toLowerCase() as 'friend' | 'group', code: m[2].toLowerCase() }
}

function makeDemoStats(opts: {
  login: string
  name: string
  todayCards: number
  todaySeconds: number
  todayDone: boolean
  dueLeft: number
  streak: number
  nowMs: number
}): FriendStats {
  const days: FriendDay[] = []
  for (let i = 0; i < 30; i++) {
    const ms = opts.nowMs - i * 86_400_000
    const isToday = i === 0
    const inStreak = i < opts.streak
    const cards = isToday ? opts.todayCards : inStreak ? 20 + ((i * 7 + opts.todayCards) % 28) : i % 3 === 0 ? 12 : 0
    const seconds = isToday ? opts.todaySeconds : cards * 24
    const done = isToday ? opts.todayDone : inStreak
    days.push({
      day: dayIn(ms, null),
      cards,
      seconds,
      remembered: Math.round(cards * 0.9),
      forgot: Math.max(0, cards - Math.round(cards * 0.9)),
      newCards: Math.min(cards, 4),
      done,
    })
  }
  return {
    v: 1,
    login: opts.login,
    name: opts.name,
    avatar: '',
    days,
    totals: {
      cards: 320,
      inReview: 240,
      newLeft: 35,
      mature: 165,
      dueLeft: opts.dueLeft,
      addedThisWeek: 18,
      streak: opts.streak,
      bestStreak: Math.max(opts.streak, 24),
      bestDay: Math.max(opts.todayCards, 64),
      bestWeek: 245,
    },
    at: new Date(opts.nowMs).toISOString(),
  }
}

function createDemoFriendsService(deps: FriendsServiceDeps): FriendsService {
  const now = deps.now ?? Date.now
  const startMs = now()
  const iso = (offsetMs = 0) => new Date(startMs + offsetMs).toISOString()

  const meStats = makeDemoStats({ login: 'yaseen', name: 'Yaseen', todayCards: 42, todaySeconds: 18 * 60, todayDone: true, dueLeft: 0, streak: 14, nowMs: startMs })
  const mayaStats = makeDemoStats({ login: 'maya', name: 'Maya', todayCards: 25, todaySeconds: 12 * 60, todayDone: true, dueLeft: 0, streak: 21, nowMs: startMs })
  const samStats = makeDemoStats({ login: 'sam', name: 'Sam', todayCards: 58, todaySeconds: 31 * 60, todayDone: false, dueLeft: 6, streak: 9, nowMs: startMs })

  let nextId = 100
  const boardState: FriendsBoardPayload = {
    me: {
      id: 1,
      login: 'yaseen',
      name: 'Yaseen',
      nickname: null,
      avatarUrl: null,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      vaults: ['yaseen/cards-friends-demo'],
      stats: meStats,
      statsAt: iso(-60_000),
    },
    friends: [
      {
        id: 2,
        login: 'maya',
        name: 'Maya',
        avatarUrl: null,
        since: iso(-30 * 86_400_000),
        stats: mayaStats,
        statsAt: iso(-120_000),
        incomingMark: null,
        outgoingMark: null,
        sharedCardCount: 12,
      },
      {
        id: 3,
        login: 'sam',
        name: 'Sam',
        avatarUrl: null,
        since: iso(-14 * 86_400_000),
        stats: samStats,
        statsAt: iso(-180_000),
        incomingMark: { kind: 'cheer', message: 'Crushing your 14-day streak!', at: iso(-300_000), seenAt: null },
        outgoingMark: null,
        sharedCardCount: 4,
      },
    ],
    invites: [],
    groups: [
      {
        id: 'grp-med-study',
        name: 'Med Study',
        adminId: 1,
        isAdmin: true,
        myStatus: 'active',
        inviteCode: 'medstudy2026',
        members: [
          { id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: null, since: iso(-20 * 86_400_000), stats: meStats, statsAt: iso(-60_000) },
          { id: 2, login: 'maya', name: 'Maya', avatarUrl: null, since: iso(-19 * 86_400_000), stats: mayaStats, statsAt: iso(-120_000) },
          { id: 3, login: 'sam', name: 'Sam', avatarUrl: null, since: iso(-12 * 86_400_000), stats: samStats, statsAt: iso(-180_000) },
        ],
        pending: [{ id: 4, login: 'tariq', name: 'Tariq', avatarUrl: null }],
        sharedFolders: [
          {
            id: 'fld-biochem',
            name: 'Biochem',
            senderId: 2,
            senderLogin: 'maya',
            createdAt: iso(-7_200_000),
            cards: [
              {
                id: 'sc-bio-1',
                folderId: 'fld-biochem',
                senderId: 2,
                senderLogin: 'maya',
                title: 'Oxidative Phosphorylation Yield',
                markdown: 'How many ATP are generated per NADH and FADH2?\n---\n~2.5 ATP per NADH and ~1.5 ATP per FADH2.',
                note: 'Classic exam question',
                attachments: [],
                status: 'pending',
                createdAt: iso(-7_200_000),
              },
              {
                id: 'sc-bio-2',
                folderId: 'fld-biochem',
                senderId: 2,
                senderLogin: 'maya',
                title: 'PFK-1 Allosteric Activators',
                markdown: 'What is the most potent allosteric activator of PFK-1?\n---\nFructose-2,6-bisphosphate (F-2,6-BP).',
                note: null,
                attachments: [],
                status: 'pending',
                createdAt: iso(-7_100_000),
              },
              {
                id: 'sc-bio-3',
                folderId: 'fld-biochem',
                senderId: 2,
                senderLogin: 'maya',
                title: 'Competitive Inhibition Effect on Km and Vmax',
                markdown: 'How does a competitive inhibitor change Km and Vmax?\n---\nIncreases apparent Km; Vmax is unchanged.',
                note: null,
                attachments: [],
                status: 'pending',
                createdAt: iso(-7_000_000),
              },
            ],
          },
        ],
        sharedCards: [
          {
            id: 'sc-loose-1',
            folderId: null,
            senderId: 3,
            senderLogin: 'sam',
            title: 'Krebs Cycle Rate-Limiting Enzyme',
            markdown: 'What is the rate-limiting enzyme of the citric acid cycle?\n---\nIsocitrate dehydrogenase.',
            note: 'Remember: inhibited by ATP & NADH',
            attachments: [],
            status: 'pending',
            createdAt: iso(-3_600_000),
          },
          {
            id: 'sc-dismissed-1',
            folderId: null,
            senderId: 3,
            senderLogin: 'sam',
            title: 'Beta-Oxidation Location',
            markdown: 'Where does fatty acid beta-oxidation occur?\n---\nMitochondrial matrix.',
            note: null,
            attachments: [],
            status: 'dismissed',
            createdAt: iso(-86_400_000),
          },
        ],
      },
    ],
    incomingCards: [
      {
        id: 'sc-direct-1',
        folderId: null,
        senderId: 2,
        senderLogin: 'maya',
        title: 'Osmosis vs Facilitated Diffusion',
        markdown: 'How does osmosis differ from facilitated diffusion?\n---\nOsmosis moves water down its gradient; facilitated diffusion moves solutes via transport proteins.',
        note: 'High-yield for Friday!',
        attachments: [],
        status: 'pending',
        createdAt: iso(-1_800_000),
      },
    ],
  }

  const allCardLists = (): SharedCardItem[][] => [
    boardState.incomingCards,
    ...boardState.groups.flatMap((g) => [g.sharedCards, ...g.sharedFolders.map((f) => f.cards)]),
  ]

  const stubClient = createFriendsApiClient({
    origin: deps.origin,
    getGithubToken: async () => null,
    fetch: deps.fetch,
    now,
  })

  return {
    client: {
      ...stubClient,
      board: async () => structuredClone(boardState),
      sendStats: async (stats, zone) => {
        boardState.me.stats = stats
        if (zone !== undefined) boardState.me.zone = zone
        const statsAt = new Date(now()).toISOString()
        boardState.me.statsAt = statsAt
        return { ok: true as const, statsAt }
      },
    },
    clearSession: () => undefined,
    board: async () => ({ ok: true as const, board: structuredClone(boardState) }),
    updatePrefs: async (prefs) => {
      if (prefs.vaults !== undefined) boardState.me.vaults = [...prefs.vaults]
      if (prefs.zone !== undefined) boardState.me.zone = prefs.zone
      if (prefs.nickname !== undefined) boardState.me.nickname = prefs.nickname
      return { ok: true as const, vaults: [...boardState.me.vaults], zone: boardState.me.zone, nickname: boardState.me.nickname }
    },
    createInvite: async () => {
      const code = `demo${++nextId}ab`
      const expiresAt = new Date(now() + 7 * 86_400_000).toISOString()
      boardState.invites.unshift({ code, expiresAt, createdAt: new Date(now()).toISOString() })
      return { ok: true as const, code, link: `https://docs.yaseenarshad.com/friend#${code}`, expiresAt }
    },
    acceptInvite: async (code) => ({ ok: true as const, result: { kind: 'friend', code } }),
    removeFriend: async (userId) => {
      boardState.friends = boardState.friends.filter((f) => f.id !== userId)
      return { ok: true as const }
    },
    sendMark: async (toUserId, kind, message) => {
      const f = boardState.friends.find((x) => x.id === toUserId)
      if (f) f.outgoingMark = { kind, message: message ?? null, at: new Date(now()).toISOString() }
      return { ok: true as const }
    },
    markSeen: async (fromUserIds) => {
      const set = fromUserIds && fromUserIds.length > 0 ? new Set(fromUserIds) : null
      for (const f of boardState.friends) {
        if (f.incomingMark && (set === null || set.has(f.id))) {
          f.incomingMark.seenAt = new Date(now()).toISOString()
        }
      }
      return { ok: true as const }
    },
    createGroup: async (name) => {
      const id = `grp-${++nextId}`
      const inviteCode = `grp${nextId}code`
      boardState.groups.push({
        id,
        name,
        adminId: boardState.me.id,
        isAdmin: true,
        myStatus: 'active',
        inviteCode,
        members: [{ id: boardState.me.id, login: boardState.me.login, name: boardState.me.name, avatarUrl: null, since: new Date(now()).toISOString(), stats: boardState.me.stats, statsAt: boardState.me.statsAt }],
        pending: [],
        sharedFolders: [],
        sharedCards: [],
      })
      return { ok: true as const, id, name, inviteCode, link: `https://docs.yaseenarshad.com/group#${inviteCode}` }
    },
    approveMember: async (groupId, userId) => {
      const g = boardState.groups.find((x) => x.id === groupId)
      if (g) {
        const idx = g.pending.findIndex((p) => p.id === userId)
        if (idx !== -1) {
          const [member] = g.pending.splice(idx, 1)
          g.members.push({ ...member, since: new Date(now()).toISOString(), stats: null, statsAt: null })
        }
      }
      return { ok: true as const }
    },
    removeMember: async (groupId, userId) => {
      const g = boardState.groups.find((x) => x.id === groupId)
      if (!g) return { ok: true as const }
      if (userId === undefined || userId === boardState.me.id) {
        boardState.groups = boardState.groups.filter((x) => x.id !== groupId)
        return { ok: true as const, deleted: true }
      }
      g.members = g.members.filter((m) => m.id !== userId)
      g.pending = g.pending.filter((p) => p.id !== userId)
      return { ok: true as const, deleted: false }
    },
    rotateGroupInvite: async (groupId) => {
      const inviteCode = `rot${++nextId}xyz`
      const g = boardState.groups.find((x) => x.id === groupId)
      if (g) g.inviteCode = inviteCode
      return { ok: true as const, inviteCode, link: `https://docs.yaseenarshad.com/group#${inviteCode}` }
    },
    shareCards: async (input) => {
      const createdAt = new Date(now()).toISOString()
      const items: SharedCardItem[] = input.cards.map((c) => {
        const clean = sanitizeSharedCard(c.title, c.markdown, c.note)
        return {
          id: `sc-demo-${++nextId}`,
          folderId: null,
          senderId: boardState.me.id,
          senderLogin: boardState.me.login,
          title: clean.title,
          markdown: clean.markdown,
          note: clean.note,
          attachments: [],
          status: 'pending',
          createdAt,
        }
      })
      if (input.groupId) {
        const g = boardState.groups.find((x) => x.id === input.groupId)
        if (g) {
          if (input.folderName) {
            const folderId = `fld-demo-${++nextId}`
            for (const item of items) item.folderId = folderId
            g.sharedFolders.unshift({ id: folderId, name: input.folderName, senderId: boardState.me.id, senderLogin: boardState.me.login, createdAt, cards: items })
          } else {
            g.sharedCards.unshift(...items)
          }
        }
      } else if (input.toUserIds) {
        for (const uid of input.toUserIds) {
          const f = boardState.friends.find((x) => x.id === uid)
          if (f) f.sharedCardCount += items.length
        }
      }
      return { ok: true as const, count: items.length }
    },
    setCardState: async (cardId, status) => {
      for (const list of allCardLists()) {
        const found = list.find((c) => c.id === cardId)
        if (found) found.status = status
      }
      return { ok: true as const }
    },
    setFolderState: async (folderId, status) => {
      for (const g of boardState.groups) {
        const folder = g.sharedFolders.find((f) => f.id === folderId)
        if (folder) {
          for (const card of folder.cards) card.status = status
        }
      }
      return { ok: true as const }
    },
    deleteSharedCard: async (cardId) => {
      boardState.incomingCards = boardState.incomingCards.filter((c) => c.id !== cardId)
      for (const g of boardState.groups) {
        g.sharedCards = g.sharedCards.filter((c) => c.id !== cardId)
        for (const f of g.sharedFolders) {
          f.cards = f.cards.filter((c) => c.id !== cardId)
        }
      }
      return { ok: true as const }
    },
    // Always writes REAL .md card files into the target vault even in demo mode!
    importCards: (input) => importSharedCards(input, deps.importDeps),
    deleteMe: async () => {
      boardState.friends = []
      boardState.groups = []
      boardState.incomingCards = []
      boardState.invites = []
      return { ok: true as const }
    },
  }
}

export function createFriendsService(deps: FriendsServiceDeps): FriendsService {
  if (process.env.YASEEN_DOCS_FRIENDS_DEMO === '1') {
    return createDemoFriendsService(deps)
  }

  const client = createFriendsApiClient({
    origin: deps.origin,
    getGithubToken: deps.getGithubToken,
    fetch: deps.fetch,
    now: deps.now,
  })

  return {
    client,
    clearSession: () => client.clearSession(),
    board: (force) => wrap(async () => ({ ok: true as const, board: await client.board(force) })),
    updatePrefs: (prefs) =>
      wrap(async () => {
        const res = await client.updatePrefs(prefs)
        return { ok: true as const, vaults: res.vaults, zone: res.zone, nickname: res.nickname }
      }),
    createInvite: () =>
      wrap(async () => {
        const res = await client.createInvite()
        return { ok: true as const, code: res.code, link: res.link, expiresAt: res.expiresAt }
      }),
    acceptInvite: (code) => wrap(async () => ({ ok: true as const, result: await client.acceptInvite(code) })),
    removeFriend: (userId, block) =>
      wrap(async () => {
        await client.removeFriend(userId, block)
        return { ok: true as const }
      }),
    sendMark: (toUserId, kind, message) =>
      wrap(async () => {
        await client.sendMark(toUserId, kind, message)
        return { ok: true as const }
      }),
    markSeen: (fromUserIds) =>
      wrap(async () => {
        await client.markSeen(fromUserIds)
        return { ok: true as const }
      }),
    createGroup: (name) =>
      wrap(async () => {
        const res = await client.createGroup(name)
        return { ok: true as const, id: res.id, name: res.name, inviteCode: res.inviteCode, link: res.link }
      }),
    approveMember: (groupId, userId) =>
      wrap(async () => {
        await client.approveMember(groupId, userId)
        return { ok: true as const }
      }),
    removeMember: (groupId, userId) =>
      wrap(async () => {
        const res = await client.removeMember(groupId, userId)
        return { ok: true as const, ...(res.deleted !== undefined ? { deleted: res.deleted } : {}) }
      }),
    rotateGroupInvite: (groupId) =>
      wrap(async () => {
        const res = await client.rotateGroupInvite(groupId)
        return { ok: true as const, inviteCode: res.inviteCode, link: res.link }
      }),
    shareCards: (input) =>
      wrap(async () => {
        const cards = input.cards.map((c) => sanitizeSharedCard(c.title, c.markdown, c.note))
        const res = await client.shareCards({
          ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
          ...(input.toUserIds !== undefined ? { toUserIds: input.toUserIds } : {}),
          ...(input.folderName !== undefined ? { folderName: input.folderName } : {}),
          cards,
        })
        return { ok: true as const, count: res.count }
      }),
    setCardState: (cardId, status) =>
      wrap(async () => {
        await client.setCardState(cardId, status)
        return { ok: true as const }
      }),
    setFolderState: (folderId, status) =>
      wrap(async () => {
        await client.setFolderState(folderId, status)
        return { ok: true as const }
      }),
    deleteSharedCard: (cardId) =>
      wrap(async () => {
        await client.deleteSharedCard(cardId)
        return { ok: true as const }
      }),
    importCards: (input) => importSharedCards(input, deps.importDeps),
    deleteMe: () =>
      wrap(async () => {
        await client.deleteMe()
        return { ok: true as const }
      }),
  }
}
