import {
  createFriendsApiClient,
  FriendsApiError,
  type DeckFilePayload,
  type DeckSettingsPayload,
  type DeckTreePayload,
  type FriendsApiClient,
  type FriendsBoardPayload,
  type SharedCardItem,
  type SharedCardStatus,
} from '@shared/friendsApi'
import { dayIn, type FriendDay, type FriendStats } from '@shared/friendStatsFormat'
import { computeBuddyStreak } from '@shared/friendsBoard'
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
  createGroup(name: string): Promise<{ ok: true; id: string; name: string; inviteCode: string; link: string } | { ok: false; error: string }>
  renameGroup(groupId: string, name: string): Promise<{ ok: true; name: string } | { ok: false; error: string }>
  removeMember(groupId: string, userId?: number): Promise<{ ok: true; deleted?: boolean } | { ok: false; error: string }>
  banMember(groupId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string }>
  unbanMember(groupId: string, userId: number): Promise<{ ok: true } | { ok: false; error: string }>
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
  getDeckSettings(): Promise<{ ok: true; settings: DeckSettingsPayload } | { ok: false; error: string }>
  saveDeckSettings(input: DeckSettingsPayload): Promise<{ ok: true; settings: DeckSettingsPayload } | { ok: false; error: string }>
  browseDeckTree(ownerId: number, repo: string): Promise<{ ok: true; tree: DeckTreePayload } | { ok: false; error: string }>
  browseDeckFile(ownerId: number, repo: string, path: string): Promise<{ ok: true; file: DeckFilePayload } | { ok: false; error: string }>
  browseDeckAsset(ownerId: number, repo: string, path: string): Promise<{ ok: true; mime: string; dataBase64: string } | { ok: false; error: string }>
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
  doneRunDays?: number
  nowMs: number
}): FriendStats {
  const doneRun = opts.doneRunDays ?? opts.streak
  const days: FriendDay[] = []
  for (let i = 0; i < 30; i++) {
    const ms = opts.nowMs - i * 86_400_000
    const isToday = i === 0
    const inRun = opts.todayDone ? i < doneRun : i >= 1 && i <= doneRun
    const cards = isToday ? opts.todayCards : inRun ? 20 + ((i * 7 + opts.todayCards) % 28) : i % 3 === 0 ? 12 : 0
    const seconds = isToday ? opts.todaySeconds : cards * 24
    const done = isToday ? opts.todayDone : inRun
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

function demoAvatar(bg: string, shirt: string, skin: string, hair: string, glasses = false): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
    `<rect width="128" height="128" rx="64" fill="${bg}"/>` +
    `<circle cx="64" cy="118" r="42" fill="${shirt}"/>` +
    `<rect x="54" y="74" width="20" height="18" rx="8" fill="${skin}"/>` +
    `<circle cx="64" cy="54" r="24" fill="${skin}"/>` +
    `<path d="M40 52c0-18 11-28 24-28s24 10 24 28c-5-9-13-13-24-13s-19 4-24 13z" fill="${hair}"/>` +
    `<circle cx="55" cy="55" r="2.6" fill="#1f2937"/><circle cx="73" cy="55" r="2.6" fill="#1f2937"/>` +
    (glasses ? `<rect x="47" y="49" width="15" height="11" rx="4" fill="none" stroke="#1f2937" stroke-width="2.2"/><rect x="66" y="49" width="15" height="11" rx="4" fill="none" stroke="#1f2937" stroke-width="2.2"/><line x1="62" y1="54" x2="66" y2="54" stroke="#1f2937" stroke-width="2.2"/>` : '') +
    `<path d="M56 65c3 4 13 4 16 0" fill="none" stroke="#7c2d12" stroke-width="2.4" stroke-linecap="round"/>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function createDemoFriendsService(deps: FriendsServiceDeps): FriendsService {
  const now = deps.now ?? Date.now
  const startMs = now()
  const iso = (offsetMs = 0) => new Date(startMs + offsetMs).toISOString()

  const avatars = {
    yaseen: demoAvatar('#dbeafe', '#2563eb', '#d9a17c', '#1f2937', true),
    maya: demoAvatar('#fce7f3', '#db2777', '#e7b999', '#3b2417'),
    sam: demoAvatar('#dcfce7', '#16a34a', '#c6865c', '#1c1917'),
    trevor: demoAvatar('#fef3c7', '#d97706', '#f0c8a8', '#78350f', true),
    ali: demoAvatar('#e0e7ff', '#4f46e5', '#d49a73', '#111827'),
    nina: demoAvatar('#f3e8ff', '#9333ea', '#f2c9ac', '#451a03'),
    tariq: demoAvatar('#cffafe', '#0891b2', '#c88d65', '#1f2937'),
  }

  const meStats = makeDemoStats({ login: 'yaseen', name: 'Yaseen', todayCards: 42, todaySeconds: 18 * 60, todayDone: true, dueLeft: 0, streak: 14, doneRunDays: 14, nowMs: startMs })
  const mayaStats = makeDemoStats({ login: 'maya', name: 'Maya', todayCards: 25, todaySeconds: 12 * 60, todayDone: true, dueLeft: 0, streak: 21, doneRunDays: 6, nowMs: startMs })
  const samStats = makeDemoStats({ login: 'sam', name: 'Sam', todayCards: 58, todaySeconds: 31 * 60, todayDone: false, dueLeft: 6, streak: 9, doneRunDays: 5, nowMs: startMs })
  const trevorStats = makeDemoStats({ login: 'trevor', name: 'Trevor', todayCards: 18, todaySeconds: 8 * 60, todayDone: true, dueLeft: 0, streak: 7, doneRunDays: 3, nowMs: startMs })
  const aliStats = makeDemoStats({ login: 'ali', name: 'Ali', todayCards: 12, todaySeconds: 6 * 60, todayDone: false, dueLeft: 9, streak: 4, doneRunDays: 2, nowMs: startMs })
  const ninaStats = makeDemoStats({ login: 'nina', name: 'Nina', todayCards: 0, todaySeconds: 0, todayDone: false, dueLeft: 14, streak: 2, doneRunDays: 0, nowMs: startMs })

  let nextId = 100
  const boardState: FriendsBoardPayload = {
    me: {
      id: 1,
      login: 'yaseen',
      name: 'Yaseen',
      nickname: null,
      avatarUrl: avatars.yaseen,
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
        avatarUrl: avatars.maya,
        since: iso(-30 * 86_400_000),
        stats: mayaStats,
        statsAt: iso(-120_000),
        sharedCardCount: 12,
        buddyStreak: computeBuddyStreak(meStats.days, mayaStats.days, startMs),
        canBrowseDeck: true,
        browsableVaults: [{ repo: 'maya/med-notes', name: 'Med Notes' }],
      },
      {
        id: 3,
        login: 'sam',
        name: 'Sam',
        avatarUrl: avatars.sam,
        since: iso(-14 * 86_400_000),
        stats: samStats,
        statsAt: iso(-180_000),
        sharedCardCount: 4,
        buddyStreak: computeBuddyStreak(meStats.days, samStats.days, startMs),
      },
      {
        id: 5,
        login: 'trevor',
        name: 'Trevor',
        avatarUrl: avatars.trevor,
        since: iso(-10 * 86_400_000),
        stats: trevorStats,
        statsAt: iso(-900_000),
        sharedCardCount: 2,
        buddyStreak: computeBuddyStreak(meStats.days, trevorStats.days, startMs),
      },
      {
        id: 6,
        login: 'ali',
        name: 'Ali',
        avatarUrl: avatars.ali,
        since: iso(-8 * 86_400_000),
        stats: aliStats,
        statsAt: iso(-1_500_000),
        sharedCardCount: 1,
        buddyStreak: computeBuddyStreak(meStats.days, aliStats.days, startMs),
      },
      {
        id: 7,
        login: 'nina',
        name: 'Nina',
        avatarUrl: avatars.nina,
        since: iso(-5 * 86_400_000),
        stats: ninaStats,
        statsAt: iso(-3_600_000),
        sharedCardCount: 0,
        buddyStreak: computeBuddyStreak(meStats.days, ninaStats.days, startMs),
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
        createdAt: iso(-20 * 86_400_000),
        members: [
          { id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: avatars.yaseen, since: iso(-20 * 86_400_000), stats: meStats, statsAt: iso(-60_000) },
          { id: 2, login: 'maya', name: 'Maya', avatarUrl: avatars.maya, since: iso(-19 * 86_400_000), stats: mayaStats, statsAt: iso(-120_000) },
          { id: 3, login: 'sam', name: 'Sam', avatarUrl: avatars.sam, since: iso(-12 * 86_400_000), stats: samStats, statsAt: iso(-180_000) },
        ],
        pending: [],
        banned: [],
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
      {
        id: 'grp-spanish-squad',
        name: 'Spanish Squad',
        adminId: 5,
        isAdmin: false,
        myStatus: 'active',
        inviteCode: 'spanish2026',
        createdAt: iso(-10 * 86_400_000),
        members: [
          { id: 5, login: 'trevor', name: 'Trevor', avatarUrl: avatars.trevor, since: iso(-10 * 86_400_000), stats: trevorStats, statsAt: iso(-900_000) },
          { id: 6, login: 'ali', name: 'Ali', avatarUrl: avatars.ali, since: iso(-8 * 86_400_000), stats: aliStats, statsAt: iso(-1_500_000) },
          { id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: avatars.yaseen, since: iso(-10 * 86_400_000), stats: meStats, statsAt: iso(-60_000) },
        ],
        pending: [],
        banned: [],
        sharedFolders: [],
        sharedCards: [],
      },
      {
        id: 'grp-mcat-grind',
        name: 'MCAT Grind',
        adminId: 1,
        isAdmin: true,
        myStatus: 'active',
        inviteCode: 'mcatgrind26',
        createdAt: iso(-25 * 86_400_000),
        members: [
          { id: 2, login: 'maya', name: 'Maya', avatarUrl: avatars.maya, since: iso(-25 * 86_400_000), stats: mayaStats, statsAt: iso(-120_000) },
          { id: 5, login: 'trevor', name: 'Trevor', avatarUrl: avatars.trevor, since: iso(-18 * 86_400_000), stats: trevorStats, statsAt: iso(-900_000) },
          { id: 3, login: 'sam', name: 'Sam', avatarUrl: avatars.sam, since: iso(-15 * 86_400_000), stats: samStats, statsAt: iso(-180_000) },
          { id: 7, login: 'nina', name: 'Nina', avatarUrl: avatars.nina, since: iso(-5 * 86_400_000), stats: ninaStats, statsAt: iso(-3_600_000) },
          { id: 1, login: 'yaseen', name: 'Yaseen', avatarUrl: avatars.yaseen, since: iso(-25 * 86_400_000), stats: meStats, statsAt: iso(-60_000) },
        ],
        pending: [],
        banned: [],
        sharedFolders: [],
        sharedCards: [],
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

  let demoDeckSettings: DeckSettingsPayload = {
    mode: 'none',
    vaults: [],
    allowedFriendIds: [],
  }

  const demoDeckFiles: Record<string, { title: string; markdown: string; assetPaths: string[] }> = {
    'Biochem/ATP Synthase.md': {
      title: 'ATP Synthase',
      markdown:
        'How does **ATP Synthase** ($F_0 F_1$ complex) couple the proton gradient to ATP synthesis?\n---\nProtons flow down their electrochemical gradient through the $F_0$ channel, spinning the $c$-ring and $\\gamma$-stalk. Conformational changes in the three $F_1$ $\\beta$-subunits cycle through **Open → Loose → Tight** states to phosphorylate ADP + $P_i$ → ATP.\n\n- Inhibited by **oligomycin** (blocks $F_0$ proton channel)\n- Uncouplers (e.g., DNP, thermogenin/UCP1) dissipate the gradient as heat',
      assetPaths: [],
    },
    'Biochem/PFK-1 Regulation.md': {
      title: 'PFK-1 Regulation',
      markdown:
        'What are the key allosteric regulators of **PFK-1** (the committed step of glycolysis)?\n---\n- **Activators:** Fructose-2,6-bisphosphate (most potent), AMP, ADP\n- **Inhibitors:** ATP, Citrate, low pH ($H^+$)\n\nRemember: insulin raises F-2,6-BP via PFK-2 activation; glucagon lowers it via PKA phosphorylation.',
      assetPaths: [],
    },
    'Biochem/Henderson-Hasselbalch.md': {
      title: 'Henderson-Hasselbalch',
      markdown:
        'Write the **Henderson-Hasselbalch equation** and state what happens when $[A^-] = [HA]$.\n---\n$$\\text{pH} = \\text{p}K_a + \\log_{10}\\frac{[A^-]}{[HA]}$$\n\nWhen $[A^-] = [HA]$, $\\log_{10}(1) = 0$, so **$\\text{pH} = \\text{p}K_a$** (maximum buffering capacity).',
      assetPaths: [],
    },
    'Spanish/Subjunctive Triggers.md': {
      title: 'Subjunctive Triggers',
      markdown:
        'What does the **WEIRDO** acronym stand for in Spanish subjunctive triggers?\n---\n- **W**ishes / desires (*esperar que*, *querer que*)\n- **E**motions (*alegrarse de que*, *temer que*)\n- **I**mpersonal expressions (*es importante que*)\n- **R**ecommendations (*sugerir que*, *recomendar que*)\n- **D**oubt / denial (*dudar que*, *no creer que*)\n- **O**jalá (*ojalá que*)',
      assetPaths: [],
    },
    'README.md': {
      title: 'README',
      markdown:
        '# Maya\'s Med Notes\n\nHigh-yield spaced repetition cards for **Biochemistry** and **Spanish**.\n\n- `Biochem/` — Metabolism, bioenergetics, and acid-base equilibrium\n- `Spanish/` — Subjunctive mood & verb drills',
      assetPaths: [],
    },
  }

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
        members: [{ id: boardState.me.id, login: boardState.me.login, name: boardState.me.name, avatarUrl: avatars.yaseen, since: new Date(now()).toISOString(), stats: boardState.me.stats, statsAt: boardState.me.statsAt }],
        pending: [],
        banned: [],
        sharedFolders: [],
        sharedCards: [],
      })
      return { ok: true as const, id, name, inviteCode, link: `https://docs.yaseenarshad.com/group#${inviteCode}` }
    },
    renameGroup: async (groupId, name) => {
      const clean = name.trim().slice(0, 80)
      if (!clean) return { ok: false as const, error: 'name_required' }
      const g = boardState.groups.find((x) => x.id === groupId)
      if (g) g.name = clean
      return { ok: true as const, name: clean }
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
    banMember: async (groupId, userId) => {
      const g = boardState.groups.find((x) => x.id === groupId)
      if (g) {
        const mem = g.members.find((m) => m.id === userId)
        g.members = g.members.filter((m) => m.id !== userId)
        g.banned ??= []
        if (mem && !g.banned.some((b) => b.id === userId)) {
          g.banned.push({ id: mem.id, login: mem.login, name: mem.name })
        }
      }
      return { ok: true as const }
    },
    unbanMember: async (groupId, userId) => {
      const g = boardState.groups.find((x) => x.id === groupId)
      if (g && g.banned) {
        g.banned = g.banned.filter((b) => b.id !== userId)
      }
      return { ok: true as const }
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
    getDeckSettings: async () => ({ ok: true as const, settings: structuredClone(demoDeckSettings) }),
    saveDeckSettings: async (input) => {
      demoDeckSettings = {
        mode: input.mode,
        vaults: input.vaults.map((v) => ({ ...v })),
        allowedFriendIds: [...input.allowedFriendIds],
      }
      return { ok: true as const, settings: structuredClone(demoDeckSettings) }
    },
    browseDeckTree: async (ownerId, repo) => {
      if (ownerId !== 2 || repo.toLowerCase() !== 'maya/med-notes') {
        return { ok: false as const, error: 'forbidden' }
      }
      return {
        ok: true as const,
        tree: {
          repo: 'maya/med-notes',
          name: 'Med Notes',
          files: Object.entries(demoDeckFiles).map(([path, f]) => ({
            path,
            title: f.title,
            kind: 'md' as const,
          })),
        },
      }
    },
    browseDeckFile: async (ownerId, repo, path) => {
      if (ownerId !== 2 || repo.toLowerCase() !== 'maya/med-notes') {
        return { ok: false as const, error: 'forbidden' }
      }
      const entry = demoDeckFiles[path]
      if (!entry) return { ok: false as const, error: 'not_found' }
      return {
        ok: true as const,
        file: {
          path,
          title: entry.title,
          markdown: entry.markdown,
          assetPaths: [...entry.assetPaths],
        },
      }
    },
    browseDeckAsset: async () => ({ ok: false as const, error: 'not_found' }),
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
    createGroup: (name) =>
      wrap(async () => {
        const res = await client.createGroup(name)
        return { ok: true as const, id: res.id, name: res.name, inviteCode: res.inviteCode, link: res.link }
      }),
    renameGroup: (groupId, name) =>
      wrap(async () => {
        const res = await client.renameGroup(groupId, name)
        return { ok: true as const, name: res.name }
      }),
    removeMember: (groupId, userId) =>
      wrap(async () => {
        const res = await client.removeMember(groupId, userId)
        return { ok: true as const, ...(res.deleted !== undefined ? { deleted: res.deleted } : {}) }
      }),
    banMember: (groupId, userId) =>
      wrap(async () => {
        await client.banGroupMember(groupId, userId)
        return { ok: true as const }
      }),
    unbanMember: (groupId, userId) =>
      wrap(async () => {
        await client.unbanGroupMember(groupId, userId)
        return { ok: true as const }
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
    getDeckSettings: () =>
      wrap(async () => ({ ok: true as const, settings: await client.getDeckSettings() })),
    saveDeckSettings: (input) =>
      wrap(async () => {
        const res = await client.saveDeckSettings(input)
        return {
          ok: true as const,
          settings: { mode: res.mode, vaults: res.vaults, allowedFriendIds: res.allowedFriendIds },
        }
      }),
    browseDeckTree: (ownerId, repo) =>
      wrap(async () => ({ ok: true as const, tree: await client.getDeckTree(ownerId, repo) })),
    browseDeckFile: (ownerId, repo, path) =>
      wrap(async () => ({ ok: true as const, file: await client.getDeckFile(ownerId, repo, path) })),
    browseDeckAsset: (ownerId, repo, path) =>
      wrap(async () => {
        const res = await client.getDeckAssetBytes(ownerId, repo, path)
        return {
          ok: true as const,
          mime: res.contentType,
          dataBase64: Buffer.from(res.bytes).toString('base64'),
        }
      }),
  }
}
