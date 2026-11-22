import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { FriendStats } from '../../shared/friendStatsFormat'
import type { D1Database, D1PreparedStatement, D1Result } from './d1Types'
import { mergeStatsNeverLower } from './friends'
import { handle, type Env } from './index'

const MIGRATION_SQL = readFileSync(join(__dirname, 'migrations/0001_friends.sql'), 'utf8')
const MIGRATION_0002_SQL = readFileSync(join(__dirname, 'migrations/0002_drop_marks.sql'), 'utf8')
const MIGRATION_0003_SQL = readFileSync(join(__dirname, 'migrations/0003_shared_decks.sql'), 'utf8')

/** Real SQLite-backed D1 adapter executing the exact production migrations (0001 + 0002 + 0003). */
function makeSqliteD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(MIGRATION_SQL)
  sqlite.exec(MIGRATION_0002_SQL)
  sqlite.exec(MIGRATION_0003_SQL)

  const makeStmt = (sql: string, params: unknown[] = []): D1PreparedStatement => {
    const cleanParams = () => params.map((p) => (p === undefined ? null : p)) as (string | number | null)[]
    return {
      bind(...values: unknown[]) {
        return makeStmt(sql, values)
      },
      async first<T = Record<string, unknown>>(): Promise<T | null> {
        const row = sqlite.prepare(sql).get(...cleanParams()) as T | undefined
        return row ?? null
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const rows = sqlite.prepare(sql).all(...cleanParams()) as T[]
        return { results: rows, success: true }
      },
      async run(): Promise<D1Result> {
        const info = sqlite.prepare(sql).run(...cleanParams())
        return { results: [], success: true, meta: { changes: Number(info.changes ?? 0) } }
      },
    }
  }

  return {
    prepare: (query: string) => makeStmt(query),
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const out: D1Result<T>[] = []
      sqlite.exec('BEGIN')
      try {
        for (const s of statements) out.push((await s.run()) as D1Result<T>)
        sqlite.exec('COMMIT')
      } catch (err) {
        sqlite.exec('ROLLBACK')
        throw err
      }
      return out
    },
  }
}

const SECRET = 'test-friends-hmac-secret-32-chars!!'

function fakeGithubFetch(profiles: Record<string, { id: number; login: string; name?: string; avatar_url?: string }>) {
  return async (_url: string, init: RequestInit): Promise<Response> => {
    const auth = (init.headers as Record<string, string>)?.authorization ?? ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const p = profiles[token]
    if (!p) return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
    return new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

const req = (path: string, init: RequestInit = {}, origin: string | null = 'https://docs.yaseenarshad.com') => {
  const headers = new Headers(init.headers)
  if (origin !== null) headers.set('origin', origin)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Request(`https://docs.yaseenarshad.com${path}`, { ...init, headers })
}

const sampleStats = (day: string, cards: number, seconds: number, streak = 5, done = true): FriendStats => ({
  v: 1,
  login: 'yaseen',
  name: 'Yaseen',
  avatar: 'https://avatars.githubusercontent.com/u/1',
  days: [{ day, cards, seconds, remembered: cards, forgot: 0, newCards: 2, done }],
  totals: { cards: 100, inReview: 80, newLeft: 20, mature: 40, dueLeft: done ? 0 : 5, addedThisWeek: 10, streak, bestStreak: streak, bestDay: cards, bestWeek: cards },
  at: '2026-11-21T12:00:00.000Z',
})

describe('Cloudflare Worker /api/friends/* (YAZ-6216)', () => {
  it('exchanges GitHub token for HMAC friendsToken, rejects cross-origin, and accepts native Mac (no Origin)', async () => {
    const db = makeSqliteD1()
    const env: Env = { FRIENDS_DB: db, FRIENDS_TOKEN_SECRET: SECRET }
    const ghFetch = fakeGithubFetch({ gh_yaseen: { id: 101, login: 'yaseen', name: 'Yaseen', avatar_url: 'https://avatars.githubusercontent.com/u/101' } })

    // Cross-origin rejected
    const badOrigin = await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: 'gh_yaseen' }) }, 'https://evil.example'), env, ghFetch)
    expect(badOrigin.status).toBe(403)

    // Native Electron Mac (no Origin header) accepted
    const ok = await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: 'gh_yaseen' }) }, null), env, ghFetch)
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { token: string; user: { id: number; login: string } }
    expect(body.token.startsWith('v1.')).toBe(true)
    expect(body.user).toMatchObject({ id: 101, login: 'yaseen' })

    // Prefs work cleanly even with 0 friends (aligned with Cards Onboarding)
    const prefs = await handle(
      req('/api/friends/prefs', { method: 'PUT', headers: { authorization: `Bearer ${body.token}` }, body: JSON.stringify({ vaults: ['Yaseen/Study'], zone: 'America/Denver' }) }),
      env,
      ghFetch,
    )
    expect(prefs.status).toBe(200)
    const prefsBody = (await prefs.json()) as { vaults: string[]; zone: string }
    expect(prefsBody.vaults).toEqual(['yaseen/study'])
    expect(prefsBody.zone).toBe('America/Denver')
  })

  it('enforces two-device never-lower guard on PUT /api/friends/stats and supports ETag 304 on GET /api/friends/board', async () => {
    const db = makeSqliteD1()
    const env: Env = { FRIENDS_DB: db, FRIENDS_TOKEN_SECRET: SECRET }
    const ghFetch = fakeGithubFetch({ gh_yaseen: { id: 101, login: 'yaseen', name: 'Yaseen' } })

    const { token } = (await (await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: 'gh_yaseen' }) }), env, ghFetch)).json()) as { token: string }
    const auth = { authorization: `Bearer ${token}` }

    // Phone sends 20 cards today
    await handle(req('/api/friends/stats', { method: 'PUT', headers: auth, body: JSON.stringify({ stats: sampleStats('2026-11-21', 20, 600, 10, true), zone: 'America/Denver' }) }), env, ghFetch)
    // Stale Mac sends 8 cards for the same local day -> must NOT lower to 8
    await handle(req('/api/friends/stats', { method: 'PUT', headers: auth, body: JSON.stringify({ stats: sampleStats('2026-11-21', 8, 200, 9, false) }) }), env, ghFetch)

    const b1 = await handle(req('/api/friends/board', { method: 'GET', headers: auth }), env, ghFetch)
    expect(b1.status).toBe(200)
    const etag = b1.headers.get('etag')
    expect(etag).toBeTruthy()
    const board = (await b1.json()) as { me: { stats: FriendStats; zone: string } }
    expect(board.me.stats.days[0].cards).toBe(20)
    expect(board.me.stats.days[0].seconds).toBe(600)
    expect(board.me.stats.days[0].done).toBe(true)
    expect(board.me.stats.totals.streak).toBe(10)
    expect(board.me.zone).toBe('America/Denver')

    // Second poll with same ETag returns 304 Not Modified
    const b2 = await handle(req('/api/friends/board', { method: 'GET', headers: { ...auth, 'if-none-match': etag! } }), env, ghFetch)
    expect(b2.status).toBe(304)
  })

  it('runs full 1-step invite, cheer/nudge, group late-joiner shared folder, 1-shot import, reversible dismiss, and delete-my-data flow', async () => {
    const db = makeSqliteD1()
    const env: Env = { FRIENDS_DB: db, FRIENDS_TOKEN_SECRET: SECRET }
    const ghFetch = fakeGithubFetch({
      gh_a: { id: 1, login: 'alice', name: 'Alice' },
      gh_b: { id: 2, login: 'bob', name: 'Bob' },
      gh_c: { id: 3, login: 'charlie', name: 'Charlie' },
    })

    const signIn = async (tok: string) =>
      ((await (await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: tok }) }), env, ghFetch)).json()) as { token: string }).token

    const tokA = await signIn('gh_a')
    const tokB = await signIn('gh_b')
    const tokC = await signIn('gh_c')
    const authA = { authorization: `Bearer ${tokA}` }
    const authB = { authorization: `Bearer ${tokB}` }
    const authC = { authorization: `Bearer ${tokC}` }

    // 1-step friend invite: Alice creates, Bob accepts
    const invRes = (await (await handle(req('/api/friends/invites', { method: 'POST', headers: authA }), env, ghFetch)).json()) as { code: string }
    const accRes = await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authB, body: JSON.stringify({ code: invRes.code }) }), env, ghFetch)
    expect(accRes.status).toBe(200)
    // Single-use: second accept fails 404
    const accAgain = await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authC, body: JSON.stringify({ code: invRes.code }) }), env, ghFetch)
    expect(accAgain.status).toBe(404)

    // 1-on-1 card share from Alice to Bob -> increments sharedCardCount
    const directShare = await handle(
      req('/api/friends/cards/share', {
        method: 'POST',
        headers: authA,
        body: JSON.stringify({ toUserIds: [2], cards: [{ title: 'Krebs', markdown: 'Q\n---\nA', note: 'High yield' }] }),
      }),
      env,
      ghFetch,
    )
    expect(directShare.status).toBe(200)

    // Group created by Alice + folder of 2 cards shared BEFORE Charlie joins
    const grp = (await (await handle(req('/api/friends/groups', { method: 'POST', headers: authA, body: JSON.stringify({ name: 'Med Study' }) }), env, ghFetch)).json()) as {
      id: string
      inviteCode: string
    }
    const folderShare = (await (
      await handle(
        req('/api/friends/cards/share', {
          method: 'POST',
          headers: authA,
          body: JSON.stringify({
            groupId: grp.id,
            folderName: 'Biochem',
            cards: [
              { title: 'Card 1', markdown: 'Front 1\n---\nBack 1' },
              { title: 'Card 2', markdown: 'Front 2\n---\nBack 2' },
            ],
          }),
        }),
        env,
        ghFetch,
      )
    ).json()) as { folderId: string; cardIds: string[] }
    expect(folderShare.folderId).toBeTruthy()
    expect(folderShare.cardIds).toHaveLength(2)

    // Charlie joins late -> instant active join (no pending approval needed!) -> Charlie immediately sees the Biochem folder!
    const joinRes = await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authC, body: JSON.stringify({ code: grp.inviteCode }) }), env, ghFetch)
    expect(joinRes.status).toBe(200)
    expect(await joinRes.json()).toMatchObject({ kind: 'group', groupId: grp.id, status: 'active' })

    const boardC = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authC }), env, ghFetch)).json()) as {
      groups: { pending: unknown[]; banned: unknown[]; sharedFolders: { id: string; name: string; cards: { id: string; status: string }[] }[] }[]
    }
    expect(boardC.groups[0].pending).toEqual([])
    expect(boardC.groups[0].banned).toEqual([])
    expect(boardC.groups[0].sharedFolders).toHaveLength(1)
    expect(boardC.groups[0].sharedFolders[0].name).toBe('Biochem')
    expect(boardC.groups[0].sharedFolders[0].cards.map((c) => c.status)).toEqual(['pending', 'pending'])

    // Reversible dismiss: Charlie dismisses Card 1, then undoes dismiss back to 'pending'
    const c1 = boardC.groups[0].sharedFolders[0].cards[0].id
    await handle(req(`/api/friends/cards/${c1}/state`, { method: 'POST', headers: authC, body: JSON.stringify({ status: 'dismissed' }) }), env, ghFetch)
    await handle(req(`/api/friends/cards/${c1}/state`, { method: 'POST', headers: authC, body: JSON.stringify({ status: 'pending' }) }), env, ghFetch)

    // 1-shot folder import marks all 2 cards accepted
    const importRes = await handle(req(`/api/friends/folders/${folderShare.folderId}/state`, { method: 'POST', headers: authC, body: JSON.stringify({ status: 'accepted' }) }), env, ghFetch)
    expect(importRes.status).toBe(200)
    const boardC2 = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authC }), env, ghFetch)).json()) as {
      groups: { sharedFolders: { cards: { status: string }[] }[] }[]
    }
    expect(boardC2.groups[0].sharedFolders[0].cards.every((c) => c.status === 'accepted')).toBe(true)

    // Admin bans Charlie -> Charlie cannot rejoin (403 banned) -> Admin sees Charlie in banned[] -> Admin unbans -> Charlie can rejoin
    const banRes = await handle(req(`/api/friends/groups/${grp.id}/ban`, { method: 'POST', headers: authA, body: JSON.stringify({ userId: 3 }) }), env, ghFetch)
    expect(banRes.status).toBe(200)
    const rejoinBanned = await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authC, body: JSON.stringify({ code: grp.inviteCode }) }), env, ghFetch)
    expect(rejoinBanned.status).toBe(403)
    const boardA = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authA }), env, ghFetch)).json()) as {
      groups: { banned: { id: number; login: string; name: string }[] }[]
    }
    expect(boardA.groups[0].banned).toEqual([{ id: 3, login: 'charlie', name: 'Charlie' }])
    const unbanRes = await handle(req(`/api/friends/groups/${grp.id}/unban`, { method: 'POST', headers: authA, body: JSON.stringify({ userId: 3 }) }), env, ghFetch)
    expect(unbanRes.status).toBe(200)
    const rejoinOk = await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authC, body: JSON.stringify({ code: grp.inviteCode }) }), env, ghFetch)
    expect(rejoinOk.status).toBe(200)

    // Admin renames group via PATCH /api/friends/groups/:id (non-admin rejected 403)
    const renameForbidden = await handle(req(`/api/friends/groups/${grp.id}`, { method: 'PATCH', headers: authC, body: JSON.stringify({ name: 'Hacked' }) }), env, ghFetch)
    expect(renameForbidden.status).toBe(403)
    const renameOk = await handle(req(`/api/friends/groups/${grp.id}`, { method: 'PATCH', headers: authA, body: JSON.stringify({ name: 'MCAT Bio' }) }), env, ghFetch)
    expect(renameOk.status).toBe(200)
    expect(await renameOk.json()).toEqual({ ok: true, name: 'MCAT Bio' })
    const boardRenamed = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authA }), env, ghFetch)).json()) as { groups: { name: string }[] }
    expect(boardRenamed.groups[0].name).toBe('MCAT Bio')

    // Bob sees sharedCardCount = 1 + incoming card
    const boardB = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authB }), env, ghFetch)).json()) as {
      friends: { id: number; sharedCardCount: number }[]
      incomingCards: { title: string }[]
    }
    expect(boardB.friends[0].sharedCardCount).toBe(1)
    expect(boardB.incomingCards[0].title).toBe('Krebs')

    // Delete my Friends data wipes Bob cleanly
    const delMe = await handle(req('/api/friends/me', { method: 'DELETE', headers: authB }), env, ghFetch)
    expect(delMe.status).toBe(200)
    const afterDel = await handle(req('/api/friends/board', { method: 'GET', headers: authB }), env, ghFetch)
    expect(afterDel.status).toBe(401)
  })

  it('fixes mergeStatsNeverLower (done protection + past days merge), supports force recount, and strips @branch in prefs', async () => {
    const db = makeSqliteD1()
    const env: Env = { FRIENDS_DB: db, FRIENDS_TOKEN_SECRET: SECRET }
    const ghFetch = fakeGithubFetch({ gh_yaseen: { id: 101, login: 'yaseen', name: 'Yaseen' } })
    const { token } = (await (await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: 'gh_yaseen' }) }), env, ghFetch)).json()) as { token: string }
    const auth = { authorization: `Bearer ${token}` }

    // Prefs strips @branch suffix
    const prefs = await handle(
      req('/api/friends/prefs', { method: 'PUT', headers: auth, body: JSON.stringify({ vaults: ['Yaseen/Study@main', 'Yaseen/Study', 'Yaseen/Med@dev'] }) }),
      env,
      ghFetch,
    )
    expect(prefs.status).toBe(200)
    expect(((await prefs.json()) as { vaults: string[] }).vaults).toEqual(['yaseen/study', 'yaseen/med'])

    // Pure mergeStatsNeverLower: done:false NEVER overwrites done:true even with equal/higher counts, and past days merge by Math.max / ||
    const prev: FriendStats = {
      ...sampleStats('2026-11-21', 20, 600, 5, true),
      days: [
        { day: '2026-11-21', cards: 20, seconds: 600, remembered: 18, forgot: 2, newCards: 2, done: true },
        { day: '2026-11-20', cards: 45, seconds: 1200, remembered: 40, forgot: 5, newCards: 3, done: true },
        { day: '2026-11-19', cards: 30, seconds: 900, remembered: 28, forgot: 2, newCards: 1, done: true },
      ],
    }
    const partialDevice: FriendStats = {
      ...sampleStats('2026-11-21', 25, 700, 4, false),
      days: [
        { day: '2026-11-21', cards: 25, seconds: 700, remembered: 24, forgot: 1, newCards: 2, done: false },
        { day: '2026-11-20', cards: 10, seconds: 300, remembered: 10, forgot: 0, newCards: 0, done: false },
      ],
    }
    const merged = mergeStatsNeverLower(prev, partialDevice)
    expect(merged.days[0]).toMatchObject({ day: '2026-11-21', cards: 25, seconds: 700, done: true })
    expect(merged.days[1]).toMatchObject({ day: '2026-11-20', cards: 45, seconds: 1200, done: true })
    expect(merged.days[2]).toMatchObject({ day: '2026-11-19', cards: 30, seconds: 900, done: true })

    // PUT /api/friends/stats normal push then force: true recount lowers counts & overwrites daily_activity
    await handle(req('/api/friends/stats', { method: 'PUT', headers: auth, body: JSON.stringify({ stats: prev }) }), env, ghFetch)
    const forced = sampleStats('2026-11-21', 5, 120, 2, false)
    const forceRes = await handle(req('/api/friends/stats', { method: 'PUT', headers: auth, body: JSON.stringify({ stats: forced, force: true }) }), env, ghFetch)
    expect(forceRes.status).toBe(200)
    const board = (await (await handle(req('/api/friends/board', { method: 'GET', headers: auth }), env, ghFetch)).json()) as { me: { stats: FriendStats } }
    expect(board.me.stats.days[0]).toMatchObject({ day: '2026-11-21', cards: 5, seconds: 120, done: false })
    expect(board.me.stats.totals.streak).toBe(2)
    const daRow = await db.prepare('SELECT cards, seconds, done FROM daily_activity WHERE user_id = ? AND day = ?').bind(101, '2026-11-21').first<{ cards: number; seconds: number; done: number }>()
    expect(daRow).toEqual({ cards: 5, seconds: 120, done: 0 })
  })

  it('supports deck sharing settings, board canBrowseDeck/createdAt, read-only GitHub App proxy (tree/file/asset), and cleanup on deleteMe', async () => {
    const db = makeSqliteD1()
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pkcs1Pem = pair.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
    const env: Env = {
      FRIENDS_DB: db,
      FRIENDS_TOKEN_SECRET: SECRET,
      GITHUB_APP_ID: '555000',
      GITHUB_APP_PRIVATE_KEY: pkcs1Pem,
    }

    const profiles: Record<string, { id: number; login: string; name: string }> = {
      gh_a: { id: 1, login: 'alice', name: 'Alice' },
      gh_b: { id: 2, login: 'bob', name: 'Bob' },
      gh_c: { id: 3, login: 'charlie', name: 'Charlie' },
    }
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    let mintedCount = 0

    const mockFetch = async (url: string, init: RequestInit): Promise<Response> => {
      if (url === 'https://api.github.com/user') {
        const tok = ((init.headers as Record<string, string>)?.authorization ?? '').replace(/^Bearer\s+/i, '')
        const p = profiles[tok]
        return p ? new Response(JSON.stringify(p), { status: 200 }) : new Response(null, { status: 401 })
      }
      if (url === 'https://api.github.com/app/installations/9001/access_tokens') {
        mintedCount++
        expect(JSON.parse(String(init.body))).toEqual({ repositories: ['med-notes'], permissions: { contents: 'read' } })
        return new Response(JSON.stringify({ token: 'ghs_inst_readonly', expires_at: '2026-11-22T06:00:00Z' }), { status: 201 })
      }
      if (url === 'https://api.github.com/repos/alice/med-notes/git/trees/HEAD?recursive=1') {
        expect((init.headers as Record<string, string>)?.authorization).toBe('Bearer ghs_inst_readonly')
        if ((init.headers as Record<string, string>)?.['if-none-match'] === '"tree-etag-1"') {
          return new Response(null, { status: 304, headers: { etag: '"tree-etag-1"' } })
        }
        return new Response(
          JSON.stringify({
            tree: [
              { path: '.yaseendocs/settings.json', type: 'blob' },
              { path: '.git/HEAD', type: 'blob' },
              { path: 'Biochem', type: 'tree' },
              { path: 'Biochem/ATP Synthase.md', type: 'blob' },
              { path: 'Biochem/img/atp.png', type: 'blob' },
              { path: 'README.md', type: 'blob' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json', etag: '"tree-etag-1"' } },
        )
      }
      if (url === 'https://api.github.com/repos/alice/med-notes/contents/Biochem/ATP%20Synthase.md') {
        const md = [
          '---',
          'kind: card',
          '---',
          '```card',
          'What powers ATP synthase?',
          '---',
          'Proton motive force ![diagram](./img/atp.png)',
          '```',
          '<!-- card: BIO-7, "ATP Synthase", 2026-11-20T12:00:00.000Z good 10s -->',
        ].join('\n')
        return new Response(md, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } })
      }
      if (url === 'https://api.github.com/repos/alice/med-notes/contents/Biochem/img/atp.png') {
        return new Response(pngBytes, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    }

    const signIn = async (tok: string) =>
      ((await (await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: tok }) }), env, mockFetch)).json()) as { token: string }).token

    const authA = { authorization: `Bearer ${await signIn('gh_a')}` }
    const authB = { authorization: `Bearer ${await signIn('gh_b')}` }
    const authC = { authorization: `Bearer ${await signIn('gh_c')}` }

    // Friend Alice <-> Bob and Alice <-> Charlie
    const inv1 = (await (await handle(req('/api/friends/invites', { method: 'POST', headers: authA }), env, mockFetch)).json()) as { code: string }
    await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authB, body: JSON.stringify({ code: inv1.code }) }), env, mockFetch)
    const inv2 = (await (await handle(req('/api/friends/invites', { method: 'POST', headers: authA }), env, mockFetch)).json()) as { code: string }
    await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authC, body: JSON.stringify({ code: inv2.code }) }), env, mockFetch)

    // Group createdAt is included on board
    await handle(req('/api/friends/groups', { method: 'POST', headers: authA, body: JSON.stringify({ name: 'Bio Squad' }) }), env, mockFetch)
    const boardA0 = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authA }), env, mockFetch)).json()) as {
      groups: { createdAt: string }[]
    }
    expect(boardA0.groups[0].createdAt).toBeTruthy()

    // Default deck settings: mode = 'none'
    const s0 = await handle(req('/api/friends/decks/settings', { method: 'GET', headers: authA }), env, mockFetch)
    expect(s0.status).toBe(200)
    expect(await s0.json()).toEqual({ mode: 'none', vaults: [], allowedFriendIds: [] })

    // Bob cannot browse when Alice is 'none'
    const forbiddenTree = await handle(req('/api/friends/decks/1/tree?repo=alice/med-notes', { method: 'GET', headers: authB }), env, mockFetch)
    expect(forbiddenTree.status).toBe(403)

    // Alice enables mode = 'selected' for Bob (id 2) only, with @main stripped from repo slug
    const putSettings = await handle(
      req('/api/friends/decks/settings', {
        method: 'PUT',
        headers: authA,
        body: JSON.stringify({
          mode: 'selected',
          vaults: [{ repo: 'Alice/Med-Notes@main', installationId: 9001, name: 'Med Notes' }],
          allowedFriendIds: [2],
        }),
      }),
      env,
      mockFetch,
    )
    expect(putSettings.status).toBe(200)
    expect(await putSettings.json()).toEqual({
      ok: true,
      mode: 'selected',
      vaults: [{ repo: 'alice/med-notes', installationId: 9001, name: 'Med Notes' }],
      allowedFriendIds: [2],
    })

    // Board: Bob sees canBrowseDeck: true + browsableVaults; Charlie sees canBrowseDeck: false
    const boardB = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authB }), env, mockFetch)).json()) as {
      friends: { id: number; canBrowseDeck: boolean; browsableVaults: { repo: string; name: string }[] }[]
    }
    expect(boardB.friends[0]).toMatchObject({ id: 1, canBrowseDeck: true, browsableVaults: [{ repo: 'alice/med-notes', name: 'Med Notes' }] })
    const boardC = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authC }), env, mockFetch)).json()) as {
      friends: { id: number; canBrowseDeck: boolean; browsableVaults: { repo: string; name: string }[] }[]
    }
    expect(boardC.friends[0]).toMatchObject({ id: 1, canBrowseDeck: false, browsableVaults: [] })

    // Charlie is blocked from tree (403)
    const charlieTree = await handle(req('/api/friends/decks/1/tree?repo=alice/med-notes', { method: 'GET', headers: authC }), env, mockFetch)
    expect(charlieTree.status).toBe(403)

    // Bob fetches tree -> filters out .yaseendocs/ and .git/, returns ETag, supports 304
    const bobTree = await handle(req('/api/friends/decks/1/tree?repo=alice/med-notes', { method: 'GET', headers: authB }), env, mockFetch)
    expect(bobTree.status).toBe(200)
    expect(bobTree.headers.get('etag')).toBe('"tree-etag-1"')
    expect(await bobTree.json()).toEqual({
      repo: 'alice/med-notes',
      name: 'Med Notes',
      files: [
        { path: 'Biochem/ATP Synthase.md', title: 'ATP Synthase', kind: 'md' },
        { path: 'Biochem/img/atp.png', title: 'atp.png', kind: 'asset' },
        { path: 'README.md', title: 'README', kind: 'md' },
      ],
    })
    const bobTree304 = await handle(
      req('/api/friends/decks/1/tree?repo=alice/med-notes', { method: 'GET', headers: { ...authB, 'if-none-match': '"tree-etag-1"' } }),
      env,
      mockFetch,
    )
    expect(bobTree304.status).toBe(304)

    // Path traversal & dotfile rejected (400)
    const trav = await handle(req('/api/friends/decks/1/file?repo=alice/med-notes&path=../secret.md', { method: 'GET', headers: authB }), env, mockFetch)
    expect(trav.status).toBe(400)
    const dotf = await handle(req('/api/friends/decks/1/file?repo=alice/med-notes&path=.yaseendocs/settings.json', { method: 'GET', headers: authB }), env, mockFetch)
    expect(dotf.status).toBe(400)

    // Bob fetches file -> SM-2 review line stripped on the fly, relative assetPaths extracted
    const bobFile = await handle(req('/api/friends/decks/1/file?repo=alice/med-notes&path=Biochem/ATP%20Synthase.md', { method: 'GET', headers: authB }), env, mockFetch)
    expect(bobFile.status).toBe(200)
    const fileData = (await bobFile.json()) as { path: string; title: string; markdown: string; assetPaths: string[] }
    expect(fileData.path).toBe('Biochem/ATP Synthase.md')
    expect(fileData.title).toBe('ATP Synthase')
    expect(fileData.markdown).toContain('Proton motive force')
    expect(fileData.markdown).not.toContain('BIO-7')
    expect(fileData.markdown).not.toContain('<!-- card:')
    expect(fileData.assetPaths).toEqual(['Biochem/img/atp.png'])

    // Bob fetches asset -> safe Content-Type + private cache-control + exact bytes
    const bobAsset = await handle(req('/api/friends/decks/1/asset?repo=alice/med-notes&path=Biochem/img/atp.png', { method: 'GET', headers: authB }), env, mockFetch)
    expect(bobAsset.status).toBe(200)
    expect(bobAsset.headers.get('content-type')).toBe('image/png')
    expect(bobAsset.headers.get('cache-control')).toBe('private, max-age=300')
    expect(new Uint8Array(await bobAsset.arrayBuffer())).toEqual(pngBytes)
    expect(mintedCount).toBe(4)

    // DELETE /api/friends/me cleans up deck_vaults and deck_permissions
    const delA = await handle(req('/api/friends/me', { method: 'DELETE', headers: authA }), env, mockFetch)
    expect(delA.status).toBe(200)
    const leftVaults = await db.prepare('SELECT COUNT(*) AS cnt FROM deck_vaults WHERE owner_id = ?').bind(1).first<{ cnt: number }>()
    const leftPerms = await db.prepare('SELECT COUNT(*) AS cnt FROM deck_permissions WHERE owner_id = ?').bind(1).first<{ cnt: number }>()
    expect(leftVaults?.cnt).toBe(0)
    expect(leftPerms?.cnt).toBe(0)
  })
})
