import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { FriendStats } from '../../shared/friendStatsFormat'
import type { D1Database, D1PreparedStatement, D1Result } from './d1Types'
import { handleFriends, mergeStatsNeverLower, type WorkerExecutionContext } from './friends'
import { handle, type Env } from './index'
import { runDailyReminders } from './pushNotify'
import { base64UrlEncode } from './webPush'

const MIGRATION_SQL = readFileSync(join(__dirname, 'migrations/0001_friends.sql'), 'utf8')
const MIGRATION_0002_SQL = readFileSync(join(__dirname, 'migrations/0002_drop_marks.sql'), 'utf8')
const MIGRATION_0003_SQL = readFileSync(join(__dirname, 'migrations/0003_shared_decks.sql'), 'utf8')
const MIGRATION_0004_SQL = readFileSync(join(__dirname, 'migrations/0004_custom_avatar.sql'), 'utf8')
const MIGRATION_0005_SQL = readFileSync(join(__dirname, 'migrations/0005_push_notifications.sql'), 'utf8')
const MIGRATION_0006_SQL = readFileSync(join(__dirname, 'migrations/0006_push_dedupe.sql'), 'utf8')

/** Real SQLite-backed D1 adapter executing the exact production migrations (0001..0006). */
function makeSqliteD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(MIGRATION_SQL)
  sqlite.exec(MIGRATION_0002_SQL)
  sqlite.exec(MIGRATION_0003_SQL)
  sqlite.exec(MIGRATION_0004_SQL)
  sqlite.exec(MIGRATION_0005_SQL)
  sqlite.exec(MIGRATION_0006_SQL)

  const makeStmt = (sql: string, params: unknown[] = []): D1PreparedStatement => {
    const cleanParams = () => params.map((p) => (p === undefined ? null : p)) as (string | number | Uint8Array | null)[]
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
      if (url === 'https://api.github.com/app/installations/9001') {
        return new Response(JSON.stringify({ id: 9001, account: { id: 1, login: 'alice', type: 'User' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
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
    expect(mintedCount).toBe(5)

    // DELETE /api/friends/me cleans up deck_vaults and deck_permissions
    const delA = await handle(req('/api/friends/me', { method: 'DELETE', headers: authA }), env, mockFetch)
    expect(delA.status).toBe(200)
    const leftVaults = await db.prepare('SELECT COUNT(*) AS cnt FROM deck_vaults WHERE owner_id = ?').bind(1).first<{ cnt: number }>()
    const leftPerms = await db.prepare('SELECT COUNT(*) AS cnt FROM deck_permissions WHERE owner_id = ?').bind(1).first<{ cnt: number }>()
    expect(leftVaults?.cnt).toBe(0)
    expect(leftPerms?.cnt).toBe(0)
  })

  it('rejects confused-deputy installation/repo registration in PUT /api/friends/decks/settings (YAZ-6290)', async () => {
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
    }
    const mockFetch = async (url: string, init: RequestInit): Promise<Response> => {
      if (url === 'https://api.github.com/user') {
        const tok = ((init.headers as Record<string, string>)?.authorization ?? '').replace(/^Bearer\s+/i, '')
        const p = profiles[tok]
        return p ? new Response(JSON.stringify(p), { status: 200 }) : new Response(null, { status: 401 })
      }
      if (url === 'https://api.github.com/app/installations/9001') {
        return new Response(JSON.stringify({ id: 9001, account: { id: 1, login: 'alice', type: 'User' } }), { status: 200 })
      }
      if (url === 'https://api.github.com/app/installations/9001/access_tokens') {
        const parsed = JSON.parse(String(init.body)) as { repositories?: string[] }
        if (parsed.repositories?.[0] === 'med-notes') {
          return new Response(JSON.stringify({ token: 'ghs_inst_readonly', expires_at: '2026-11-22T06:00:00Z' }), { status: 201 })
        }
        return new Response(JSON.stringify({ message: 'Repository not accessible' }), { status: 422 })
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    }

    const signIn = async (tok: string) =>
      ((await (await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: tok }) }), env, mockFetch)).json()) as { token: string }).token

    const authA = { authorization: `Bearer ${await signIn('gh_a')}` }
    const authB = { authorization: `Bearer ${await signIn('gh_b')}` }

    // Attack 1: Malicious Bob tries to register Alice's repo + Alice's installationId -> 403, NOT saved
    const stealAliceRepo = await handle(
      req('/api/friends/decks/settings', {
        method: 'PUT',
        headers: authB,
        body: JSON.stringify({
          mode: 'all',
          vaults: [{ repo: 'alice/med-notes', installationId: 9001, name: 'Stolen' }],
          allowedFriendIds: [],
        }),
      }),
      env,
      mockFetch,
    )
    expect(stealAliceRepo.status).toBe(403)

    // Attack 2: Malicious Bob tries to pair his own repo name with Alice's installationId -> 403, NOT saved
    const stealAliceInst = await handle(
      req('/api/friends/decks/settings', {
        method: 'PUT',
        headers: authB,
        body: JSON.stringify({
          mode: 'all',
          vaults: [{ repo: 'bob/med-notes', installationId: 9001, name: 'Spoofed' }],
          allowedFriendIds: [],
        }),
      }),
      env,
      mockFetch,
    )
    expect(stealAliceInst.status).toBe(403)

    // Verify deck_vaults has 0 rows for Bob and Bob cannot browse via own ownerId
    const bobVaults = await db.prepare('SELECT COUNT(*) AS cnt FROM deck_vaults WHERE owner_id = ?').bind(2).first<{ cnt: number }>()
    expect(bobVaults?.cnt).toBe(0)
    const bobTree = await handle(req('/api/friends/decks/2/tree?repo=alice/med-notes', { method: 'GET', headers: authB }), env, mockFetch)
    expect(bobTree.status).toBe(403)

    // Attack 3: Unconfigured GitHub App credentials must fail closed (403), never silently trust installationId
    const noAppEnv: Env = { FRIENDS_DB: db, FRIENDS_TOKEN_SECRET: SECRET }
    const noAppRes = await handle(
      req('/api/friends/decks/settings', {
        method: 'PUT',
        headers: authA,
        body: JSON.stringify({
          mode: 'all',
          vaults: [{ repo: 'alice/med-notes', installationId: 9001, name: 'Med Notes' }],
          allowedFriendIds: [],
        }),
      }),
      noAppEnv,
      mockFetch,
    )
    expect(noAppRes.status).toBe(403)

    // Legitimate owner Alice registering her own repo + installationId succeeds (200)
    const legit = await handle(
      req('/api/friends/decks/settings', {
        method: 'PUT',
        headers: authA,
        body: JSON.stringify({
          mode: 'all',
          vaults: [{ repo: 'alice/med-notes', installationId: 9001, name: 'Med Notes' }],
          allowedFriendIds: [],
        }),
      }),
      env,
      mockFetch,
    )
    expect(legit.status).toBe(200)
    const aliceVaults = await db.prepare('SELECT COUNT(*) AS cnt FROM deck_vaults WHERE owner_id = ?').bind(1).first<{ cnt: number }>()
    expect(aliceVaults?.cnt).toBe(1)
  })

  it('supports custom avatar PUT/GET/DELETE, magic-byte & 50KB validation, cache headers, first-name clipping on board, and deleteMe cleanup (YAZ-6298)', async () => {
    const db = makeSqliteD1()
    const env: Env = { FRIENDS_DB: db, FRIENDS_TOKEN_SECRET: SECRET }
    const ghFetch = fakeGithubFetch({
      gh_a: { id: 10, login: 'yaseen', name: 'Yaseen Arshad', avatar_url: 'https://avatars.githubusercontent.com/u/10' },
      gh_b: { id: 20, login: 'maya-gh', name: 'Maya Lin', avatar_url: 'https://avatars.githubusercontent.com/u/20' },
      gh_c: { id: 30, login: 'samir-gh', name: '   ', avatar_url: 'https://avatars.githubusercontent.com/u/30' },
    })

    const signIn = async (tok: string) =>
      ((await (await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: tok }) }), env, ghFetch)).json()) as { token: string }).token

    const authA = { authorization: `Bearer ${await signIn('gh_a')}` }
    const authB = { authorization: `Bearer ${await signIn('gh_b')}` }
    const authC = { authorization: `Bearer ${await signIn('gh_c')}` }

    // Friend A <-> B and create group with A, B, C
    const inv = (await (await handle(req('/api/friends/invites', { method: 'POST', headers: authA }), env, ghFetch)).json()) as { code: string }
    await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authB, body: JSON.stringify({ code: inv.code }) }), env, ghFetch)
    const grp = (await (await handle(req('/api/friends/groups', { method: 'POST', headers: authA, body: JSON.stringify({ name: 'Study Crew' }) }), env, ghFetch)).json()) as {
      id: string
      inviteCode: string
    }
    await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authB, body: JSON.stringify({ code: grp.inviteCode }) }), env, ghFetch)
    await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authC, body: JSON.stringify({ code: grp.inviteCode }) }), env, ghFetch)

    // First-name clipping on GET /api/friends/board before any custom nickname or avatar
    const boardInitial = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authA }), env, ghFetch)).json()) as {
      me: { name: string; avatarUrl: string | null; hasCustomAvatar: boolean }
      friends: { id: number; name: string; avatarUrl: string | null }[]
      groups: { members: { id: number; name: string; avatarUrl: string | null }[] }[]
    }
    expect(boardInitial.me.name).toBe('Yaseen')
    expect(boardInitial.me.hasCustomAvatar).toBe(false)
    expect(boardInitial.me.avatarUrl).toBe('https://avatars.githubusercontent.com/u/10')
    expect(boardInitial.friends[0].name).toBe('Maya')
    const memberNamesById = new Map(boardInitial.groups[0].members.map((m) => [m.id, m.name]))
    expect(memberNamesById.get(10)).toBe('Yaseen')
    expect(memberNamesById.get(20)).toBe('Maya')
    expect(memberNamesById.get(30)).toBe('samir-gh')

    // Custom nickname preserved as-typed (including multi-word)
    await handle(req('/api/friends/prefs', { method: 'PUT', headers: authA, body: JSON.stringify({ nickname: 'Yaseen A.' }) }), env, ghFetch)

    const toB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
    const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20])
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

    // Public GET before upload -> 404; invalid id -> 400
    expect((await handle(req('/api/friends/avatar/10', { method: 'GET' }, null), env, ghFetch)).status).toBe(404)
    expect((await handle(req('/api/friends/avatar/notanumber', { method: 'GET' }, null), env, ghFetch)).status).toBe(400)

    // Validation failures: disallowed contentType, mismatched magic bytes, empty, >50KB
    const badType = await handle(
      req('/api/friends/avatar', { method: 'PUT', headers: authA, body: JSON.stringify({ contentType: 'image/svg+xml', dataBase64: toB64(pngBytes) }) }),
      env,
      ghFetch,
    )
    expect(badType.status).toBe(400)

    const badMagic = await handle(
      req('/api/friends/avatar', { method: 'PUT', headers: authA, body: JSON.stringify({ contentType: 'image/webp', dataBase64: toB64(pngBytes) }) }),
      env,
      ghFetch,
    )
    expect(badMagic.status).toBe(400)

    const emptyData = await handle(
      req('/api/friends/avatar', { method: 'PUT', headers: authA, body: JSON.stringify({ contentType: 'image/png', dataBase64: '' }) }),
      env,
      ghFetch,
    )
    expect(emptyData.status).toBe(400)

    const oversize = new Uint8Array(50 * 1024 + 1)
    oversize.set(pngBytes, 0)
    const tooBig = await handle(
      req('/api/friends/avatar', { method: 'PUT', headers: authA, body: JSON.stringify({ contentType: 'image/png', dataBase64: toB64(oversize) }) }),
      env,
      ghFetch,
    )
    expect(tooBig.status).toBe(413)

    // Exact 50KB boundary succeeds
    const exactCap = new Uint8Array(50 * 1024)
    exactCap.set(jpegBytes, 0)
    const capOk = await handle(
      req('/api/friends/avatar', { method: 'PUT', headers: authA, body: JSON.stringify({ contentType: 'image/jpeg', dataBase64: toB64(exactCap) }) }),
      env,
      ghFetch,
    )
    expect(capOk.status).toBe(200)

    // Upload WebP for A and PNG for B
    const putA = await handle(
      req('/api/friends/avatar', { method: 'PUT', headers: authA, body: JSON.stringify({ contentType: 'image/webp', dataBase64: toB64(webpBytes) }) }),
      env,
      ghFetch,
    )
    expect(putA.status).toBe(200)
    const putABody = (await putA.json()) as { ok: true; avatarUrl: string; hasCustomAvatar: boolean }
    expect(putABody.ok).toBe(true)
    expect(putABody.hasCustomAvatar).toBe(true)
    expect(putABody.avatarUrl).toMatch(/^https:\/\/docs\.yaseenarshad\.com\/api\/friends\/avatar\/10\?v=[0-9a-f]{12}$/)

    const putB = await handle(
      req('/api/friends/avatar', { method: 'PUT', headers: authB, body: JSON.stringify({ contentType: 'image/png', dataBase64: toB64(pngBytes) }) }),
      env,
      ghFetch,
    )
    expect(putB.status).toBe(200)
    const putBBody = (await putB.json()) as { avatarUrl: string }

    // Public GET /api/friends/avatar/10 (NO Authorization header!) with ?v= -> immutable cache, exact bytes
    const versionParam = new URL(putABody.avatarUrl).searchParams.get('v')!
    const getWithV = await handle(req(`/api/friends/avatar/10?v=${versionParam}`, { method: 'GET' }, null), env, ghFetch)
    expect(getWithV.status).toBe(200)
    expect(getWithV.headers.get('content-type')).toBe('image/webp')
    expect(getWithV.headers.get('x-content-type-options')).toBe('nosniff')
    expect(getWithV.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await getWithV.arrayBuffer())).toEqual(webpBytes)

    // Public GET without ?v= -> short cache
    const getNoV = await handle(req('/api/friends/avatar/10', { method: 'GET' }, null), env, ghFetch)
    expect(getNoV.status).toBe(200)
    expect(getNoV.headers.get('cache-control')).toBe('public, max-age=300')

    // Re-signing in via /api/friends/session must NOT wipe nickname or custom avatar
    await signIn('gh_a')

    // Board returns custom avatar URLs for me, friend, and group members + hasCustomAvatar: true
    const boardAfterUpload = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authA }), env, ghFetch)).json()) as {
      me: { name: string; nickname: string | null; avatarUrl: string | null; hasCustomAvatar: boolean }
      friends: { id: number; avatarUrl: string | null }[]
      groups: { members: { id: number; avatarUrl: string | null }[] }[]
    }
    expect(boardAfterUpload.me.name).toBe('Yaseen A.')
    expect(boardAfterUpload.me.nickname).toBe('Yaseen A.')
    expect(boardAfterUpload.me.avatarUrl).toBe(putABody.avatarUrl)
    expect(boardAfterUpload.me.hasCustomAvatar).toBe(true)
    expect(boardAfterUpload.friends[0].avatarUrl).toBe(putBBody.avatarUrl)
    const memberAvatarsById = new Map(boardAfterUpload.groups[0].members.map((m) => [m.id, m.avatarUrl]))
    expect(memberAvatarsById.get(10)).toBe(putABody.avatarUrl)
    expect(memberAvatarsById.get(20)).toBe(putBBody.avatarUrl)
    expect(memberAvatarsById.get(30)).toBe('https://avatars.githubusercontent.com/u/30')

    // DELETE /api/friends/avatar restores GitHub fallback
    const delAv = await handle(req('/api/friends/avatar', { method: 'DELETE', headers: authA }), env, ghFetch)
    expect(delAv.status).toBe(200)
    expect(await delAv.json()).toEqual({ ok: true, avatarUrl: 'https://avatars.githubusercontent.com/u/10', hasCustomAvatar: false })
    expect((await handle(req('/api/friends/avatar/10', { method: 'GET' }, null), env, ghFetch)).status).toBe(404)

    const boardAfterDel = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authA }), env, ghFetch)).json()) as {
      me: { avatarUrl: string | null; hasCustomAvatar: boolean }
    }
    expect(boardAfterDel.me.avatarUrl).toBe('https://avatars.githubusercontent.com/u/10')
    expect(boardAfterDel.me.hasCustomAvatar).toBe(false)

    // DELETE /api/friends/me cleans up user_avatars
    const delMeB = await handle(req('/api/friends/me', { method: 'DELETE', headers: authB }), env, ghFetch)
    expect(delMeB.status).toBe(200)
    const leftAvatarB = await db.prepare('SELECT COUNT(*) AS cnt FROM user_avatars WHERE github_id = ?').bind(20).first<{ cnt: number }>()
    expect(leftAvatarB?.cnt).toBe(0)
    expect((await handle(req('/api/friends/avatar/20', { method: 'GET' }, null), env, ghFetch)).status).toBe(404)
  })

  it('supports push config, subscribe/unsubscribe, prefs, test push with 410 pruning, and DELETE /api/friends/me cleanup', async () => {
    const db = makeSqliteD1()
    const vapidKp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const vapidPub = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', vapidKp.publicKey)))
    const vapidPriv = (await crypto.subtle.exportKey('jwk', vapidKp.privateKey)).d!

    const subKp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const subP256dh = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', subKp.publicKey)))
    const subAuth = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)))

    const ghFetch = fakeGithubFetch({ gh_a: { id: 101, login: 'alice', name: 'Alice' } })

    // 1. Graceful 200 with vapidPublicKey: null when VAPID env is unset
    const unsetEnv: Env = { FRIENDS_DB: db, FRIENDS_TOKEN_SECRET: SECRET }
    const { token } = (await (
      await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: 'gh_a' }) }), unsetEnv, ghFetch)
    ).json()) as { token: string }
    const auth = { authorization: `Bearer ${token}` }

    const cfgUnset = await handle(req('/api/friends/push/config', { method: 'GET', headers: auth }), unsetEnv, ghFetch)
    expect(cfgUnset.status).toBe(200)
    expect(await cfgUnset.json()).toEqual({ vapidPublicKey: null })

    // 2. Configured VAPID returns public key
    const env: Env = { ...unsetEnv, VAPID_PUBLIC_KEY: vapidPub, VAPID_PRIVATE_KEY: vapidPriv }
    const cfgSet = await handle(req('/api/friends/push/config', { method: 'GET', headers: auth }), env, ghFetch)
    expect(cfgSet.status).toBe(200)
    expect(await cfgSet.json()).toEqual({ vapidPublicKey: vapidPub })

    // 3. Rejects non-HTTPS / private push endpoints
    const badEp = await handle(
      req('/api/friends/push/subscribe', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ endpoint: 'http://localhost:8080/push', keys: { p256dh: subP256dh, auth: subAuth } }),
      }),
      env,
      ghFetch,
    )
    expect(badEp.status).toBe(400)

    // 4. Subscribe two devices (one healthy, one that will return 410 Gone)
    const ep1 = 'https://fcm.googleapis.com/fcm/send/dev-1'
    const ep2 = 'https://fcm.googleapis.com/fcm/send/dev-gone'
    expect(
      (
        await handle(
          req('/api/friends/push/subscribe', { method: 'POST', headers: auth, body: JSON.stringify({ endpoint: ep1, keys: { p256dh: subP256dh, auth: subAuth } }) }),
          env,
          ghFetch,
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await handle(
          req('/api/friends/push/subscribe', { method: 'POST', headers: auth, body: JSON.stringify({ endpoint: ep2, keys: { p256dh: subP256dh, auth: subAuth } }) }),
          env,
          ghFetch,
        )
      ).status,
    ).toBe(200)

    // 5. Default prefs + subscribedCount = 2, then update prefs
    const prefsGet1 = (await (await handle(req('/api/friends/push/prefs', { method: 'GET', headers: auth }), env, ghFetch)).json()) as {
      prefs: Record<string, unknown>
      subscribedCount: number
    }
    expect(prefsGet1.subscribedCount).toBe(2)
    expect(prefsGet1.prefs).toEqual({
      dailyReminder: true,
      reminderHour: 20,
      friendFinishedMode: 'all',
      friendFinishedIds: [],
      buddyStreak: true,
      sharedCards: true,
    })

    const prefsPut = await handle(
      req('/api/friends/push/prefs', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({ reminderHour: 19, friendFinishedMode: 'selected', friendFinishedIds: [202, 303], buddyStreak: false }),
      }),
      env,
      ghFetch,
    )
    expect(prefsPut.status).toBe(200)
    expect(await prefsPut.json()).toEqual({
      ok: true,
      prefs: {
        dailyReminder: true,
        reminderHour: 19,
        friendFinishedMode: 'selected',
        friendFinishedIds: [202, 303],
        buddyStreak: false,
        sharedCards: true,
      },
    })

    // 6. Test push sends to both, prunes the 410 subscription automatically
    const pushFetch = async (url: string, init: RequestInit): Promise<Response> => {
      if (url === ep1) return new Response(null, { status: 201 })
      if (url === ep2) return new Response(null, { status: 410 })
      return ghFetch(url, init)
    }
    const testRes = await handle(req('/api/friends/push/test', { method: 'POST', headers: auth }), env, pushFetch)
    expect(testRes.status).toBe(200)
    expect(await testRes.json()).toEqual({ ok: true, sent: 1, failed: 1, failedStatuses: [410] })

    // 6b. Targeted test push sends only to the requested device endpoint
    const targetedRes = await handle(
      req('/api/friends/push/test', { method: 'POST', headers: auth, body: JSON.stringify({ endpoint: ep1 }) }),
      env,
      pushFetch,
    )
    expect(targetedRes.status).toBe(200)
    expect(await targetedRes.json()).toEqual({ ok: true, sent: 1, failed: 0 })

    const missingTargetRes = await handle(
      req('/api/friends/push/test', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ endpoint: 'https://web.push.apple.com/not-registered' }),
      }),
      env,
      pushFetch,
    )
    expect(missingTargetRes.status).toBe(200)
    expect(await missingTargetRes.json()).toEqual({ ok: true, sent: 0, failed: 0 })

    const prefsGet2 = (await (await handle(req('/api/friends/push/prefs', { method: 'GET', headers: auth }), env, ghFetch)).json()) as {
      subscribedCount: number
    }
    expect(prefsGet2.subscribedCount).toBe(1)

    // 7. Unsubscribe removes remaining endpoint, re-subscribe, then DELETE /api/friends/me cleans both tables
    await handle(req('/api/friends/push/unsubscribe', { method: 'POST', headers: auth, body: JSON.stringify({ endpoint: ep1 }) }), env, ghFetch)
    const prefsGet3 = (await (await handle(req('/api/friends/push/prefs', { method: 'GET', headers: auth }), env, ghFetch)).json()) as {
      subscribedCount: number
    }
    expect(prefsGet3.subscribedCount).toBe(0)

    await handle(
      req('/api/friends/push/subscribe', { method: 'POST', headers: auth, body: JSON.stringify({ endpoint: ep1, keys: { p256dh: subP256dh, auth: subAuth } }) }),
      env,
      ghFetch,
    )
    await handle(req('/api/friends/me', { method: 'DELETE', headers: auth }), env, ghFetch)
    const subLeft = await db.prepare('SELECT COUNT(*) AS cnt FROM push_subscriptions WHERE user_id = ?').bind(101).first<{ cnt: number }>()
    const prefLeft = await db.prepare('SELECT COUNT(*) AS cnt FROM notification_prefs WHERE user_id = ?').bind(101).first<{ cnt: number }>()
    expect(subLeft?.cnt).toBe(0)
    expect(prefLeft?.cnt).toBe(0)
  })

  it('triggers buddy-streak nudges, friend-finished filters, and shared-card / invite notifications on transitions', async () => {
    const db = makeSqliteD1()
    const vapidKp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const vapidPub = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', vapidKp.publicKey)))
    const vapidPriv = (await crypto.subtle.exportKey('jwk', vapidKp.privateKey)).d!
    const env: Env = { FRIENDS_DB: db, FRIENDS_TOKEN_SECRET: SECRET, VAPID_PUBLIC_KEY: vapidPub, VAPID_PRIVATE_KEY: vapidPriv }

    const makeSub = async () => {
      const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
      const pubBytes = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
      const authSecret = crypto.getRandomValues(new Uint8Array(16))
      return {
        privateKey: kp.privateKey,
        pubBytes,
        authSecret,
        keys: { p256dh: base64UrlEncode(pubBytes), auth: base64UrlEncode(authSecret) },
      }
    }

    const decryptPush = async (body: Uint8Array, sub: Awaited<ReturnType<typeof makeSub>>) => {
      const salt = new Uint8Array(body.slice(0, 16))
      const idlen = body[20]
      const asPub = new Uint8Array(body.slice(21, 21 + idlen))
      const ct = new Uint8Array(body.slice(21 + idlen))
      const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
      const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, sub.privateKey, 256))
      const enc = new TextEncoder()
      const prefix = enc.encode('WebPush: info\0')
      const info = new Uint8Array(prefix.byteLength + sub.pubBytes.byteLength + asPub.byteLength)
      info.set(prefix, 0)
      info.set(sub.pubBytes, prefix.byteLength)
      info.set(asPub, prefix.byteLength + sub.pubBytes.byteLength)
      const ecdhKey = await crypto.subtle.importKey('raw', ecdh, 'HKDF', false, ['deriveBits'])
      const ikm = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sub.authSecret, info }, ecdhKey, 256))
      const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
      const cek = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: aes128gcm\0') }, ikmKey, 128))
      const nonce = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('Content-Encoding: nonce\0') }, ikmKey, 96))
      const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt'])
      const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, ct))
      return JSON.parse(new TextDecoder().decode(pt.slice(0, -1))) as { title: string; body: string }
    }

    const subA = await makeSub()
    const subB = await makeSub()
    const subC = await makeSub()
    const subByEp = new Map([
      ['https://push.example/alice', subA],
      ['https://push.example/bob', subB],
      ['https://push.example/charlie', subC],
    ])

    const ghFetch = fakeGithubFetch({
      gh_a: { id: 1, login: 'alice', name: 'Alice' },
      gh_b: { id: 2, login: 'bob', name: 'Bob' },
      gh_c: { id: 3, login: 'charlie', name: 'Charlie' },
    })

    const sentPushes: { endpoint: string; payload: { title: string; body: string } }[] = []
    const combinedFetch = async (url: string, init: RequestInit): Promise<Response> => {
      const sub = subByEp.get(url)
      if (sub) {
        sentPushes.push({ endpoint: url, payload: await decryptPush(init.body as Uint8Array, sub) })
        return new Response(null, { status: 201 })
      }
      return ghFetch(url, init)
    }

    const pending: Promise<unknown>[] = []
    const ctx: WorkerExecutionContext = { waitUntil: (p) => pending.push(p) }
    const flush = async () => {
      await Promise.all(pending.splice(0))
    }
    const fixedNow = () => Date.parse('2026-11-22T18:00:00.000Z')

    const signIn = async (tok: string) =>
      ((await (await handleFriends(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: tok }) }), env, combinedFetch, fixedNow, ctx)).json()) as { token: string }).token

    const authA = { authorization: `Bearer ${await signIn('gh_a')}` }
    const authB = { authorization: `Bearer ${await signIn('gh_b')}` }
    const authC = { authorization: `Bearer ${await signIn('gh_c')}` }

    await handleFriends(req('/api/friends/push/subscribe', { method: 'POST', headers: authA, body: JSON.stringify({ endpoint: 'https://push.example/alice', keys: subA.keys }) }), env, combinedFetch, fixedNow, ctx)
    await handleFriends(req('/api/friends/push/subscribe', { method: 'POST', headers: authB, body: JSON.stringify({ endpoint: 'https://push.example/bob', keys: subB.keys }) }), env, combinedFetch, fixedNow, ctx)
    await handleFriends(req('/api/friends/push/subscribe', { method: 'POST', headers: authC, body: JSON.stringify({ endpoint: 'https://push.example/charlie', keys: subC.keys }) }), env, combinedFetch, fixedNow, ctx)

    // Alice invites Bob & Charlie -> invite accept notifies Alice
    const inv1 = (await (await handleFriends(req('/api/friends/invites', { method: 'POST', headers: authA }), env, combinedFetch, fixedNow, ctx)).json()) as { code: string }
    await handleFriends(req('/api/friends/invites/accept', { method: 'POST', headers: authB, body: JSON.stringify({ code: inv1.code }) }), env, combinedFetch, fixedNow, ctx)
    await flush()
    expect(sentPushes).toHaveLength(1)
    expect(sentPushes[0]).toMatchObject({ endpoint: 'https://push.example/alice', payload: { body: 'Bob accepted your friend invite' } })
    sentPushes.length = 0

    const inv2 = (await (await handleFriends(req('/api/friends/invites', { method: 'POST', headers: authA }), env, combinedFetch, fixedNow, ctx)).json()) as { code: string }
    await handleFriends(req('/api/friends/invites/accept', { method: 'POST', headers: authC, body: JSON.stringify({ code: inv2.code }) }), env, combinedFetch, fixedNow, ctx)
    await flush()
    sentPushes.length = 0

    // Charlie disables buddyStreak and sets friendFinishedMode = 'selected' for [1] (Alice)
    await handleFriends(
      req('/api/friends/push/prefs', {
        method: 'PUT',
        headers: authC,
        body: JSON.stringify({ buddyStreak: false, friendFinishedMode: 'selected', friendFinishedIds: [1], sharedCards: false }),
      }),
      env,
      combinedFetch,
      fixedNow,
      ctx,
    )

    // Bob already has a 2-day streak ending yesterday (Nov 20 & Nov 21), NOT done today yet (Nov 22)
    const bobInitial: FriendStats = {
      ...sampleStats('2026-11-22', 3, 60, 2, false),
      days: [
        { day: '2026-11-22', cards: 3, seconds: 60, remembered: 3, forgot: 0, newCards: 0, done: false },
        { day: '2026-11-21', cards: 15, seconds: 300, remembered: 14, forgot: 1, newCards: 2, done: true },
        { day: '2026-11-20', cards: 12, seconds: 240, remembered: 12, forgot: 0, newCards: 1, done: true },
      ],
    }
    await handleFriends(req('/api/friends/stats', { method: 'PUT', headers: authB, body: JSON.stringify({ stats: bobInitial }) }), env, combinedFetch, fixedNow, ctx)
    await flush()
    expect(sentPushes).toHaveLength(0)

    // Alice finishes today (Nov 22) with 18 cards and also finished Nov 20 & Nov 21 ->
    // Bob gets buddy-streak nudge ("finish yours to hit a 3-day buddy streak!"),
    // Charlie gets friend-finished ("Alice just finished due cards (18 cards)").
    const aliceDone: FriendStats = {
      ...sampleStats('2026-11-22', 18, 420, 3, true),
      days: [
        { day: '2026-11-22', cards: 18, seconds: 420, remembered: 17, forgot: 1, newCards: 3, done: true },
        { day: '2026-11-21', cards: 14, seconds: 280, remembered: 14, forgot: 0, newCards: 2, done: true },
        { day: '2026-11-20', cards: 10, seconds: 200, remembered: 10, forgot: 0, newCards: 1, done: true },
      ],
    }
    await handleFriends(req('/api/friends/stats', { method: 'PUT', headers: authA, body: JSON.stringify({ stats: aliceDone }) }), env, combinedFetch, fixedNow, ctx)
    await flush()

    const byEp = new Map(sentPushes.map((p) => [p.endpoint, p.payload.body]))
    expect(byEp.get('https://push.example/bob')).toBe('Alice finished today — finish yours to hit a 3-day buddy streak!')
    expect(byEp.get('https://push.example/charlie')).toBe('Alice just finished due cards (18 cards)')
    sentPushes.length = 0

    // Re-uploading Alice's stats when already done today must NOT re-trigger notifications
    await handleFriends(req('/api/friends/stats', { method: 'PUT', headers: authA, body: JSON.stringify({ stats: aliceDone }) }), env, combinedFetch, fixedNow, ctx)
    await flush()
    expect(sentPushes).toHaveLength(0)

    // Now Bob finishes today with 3 concurrent PUT /api/friends/stats calls ->
    // atomic push_deliveries dedupe ensures Alice gets ONLY ONE "🎉 You & Bob hit a 3-day buddy streak!"
    const bobDone: FriendStats = {
      ...bobInitial,
      days: [
        { day: '2026-11-22', cards: 22, seconds: 500, remembered: 20, forgot: 2, newCards: 1, done: true },
        ...bobInitial.days.slice(1),
      ],
    }
    await Promise.all([
      handleFriends(req('/api/friends/stats', { method: 'PUT', headers: authB, body: JSON.stringify({ stats: bobDone }) }), env, combinedFetch, fixedNow, ctx),
      handleFriends(req('/api/friends/stats', { method: 'PUT', headers: authB, body: JSON.stringify({ stats: bobDone }) }), env, combinedFetch, fixedNow, ctx),
      handleFriends(req('/api/friends/stats', { method: 'PUT', headers: authB, body: JSON.stringify({ stats: bobDone }) }), env, combinedFetch, fixedNow, ctx),
    ])
    await flush()
    expect(sentPushes).toHaveLength(1)
    expect(sentPushes[0]).toMatchObject({
      endpoint: 'https://push.example/alice',
      payload: { body: '🎉 You & Bob hit a 3-day buddy streak!' },
    })
    sentPushes.length = 0

    // Even if force:true flips Bob done->false->true again the same day, atomic dedupe still prevents a duplicate push
    await handleFriends(
      req('/api/friends/stats', { method: 'PUT', headers: authB, body: JSON.stringify({ stats: bobInitial, force: true }) }),
      env,
      combinedFetch,
      fixedNow,
      ctx,
    )
    await handleFriends(
      req('/api/friends/stats', { method: 'PUT', headers: authB, body: JSON.stringify({ stats: bobDone, force: true }) }),
      env,
      combinedFetch,
      fixedNow,
      ctx,
    )
    await flush()
    expect(sentPushes).toHaveLength(0)

    // Alice shares a card to Bob (sharedCards=true) and Charlie (sharedCards=false) -> only Bob is notified
    await handleFriends(
      req('/api/friends/cards/share', {
        method: 'POST',
        headers: authA,
        body: JSON.stringify({ toUserIds: [2, 3], cards: [{ title: 'Renal', markdown: 'Q\n---\nA' }] }),
      }),
      env,
      combinedFetch,
      fixedNow,
      ctx,
    )
    await flush()
    expect(sentPushes).toHaveLength(1)
    expect(sentPushes[0].endpoint).toBe('https://push.example/bob')
    expect(sentPushes[0].payload.body).toContain('Alice shared "Renal"')
  })

  it('runDailyReminders respects local hour, skips done/zero-due users, and deduplicates via last_reminder_day', async () => {
    const db = makeSqliteD1()
    const vapidKp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const vapidPub = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', vapidKp.publicKey)))
    const vapidPriv = (await crypto.subtle.exportKey('jwk', vapidKp.privateKey)).d!
    const env: Env = { FRIENDS_DB: db, FRIENDS_TOKEN_SECRET: SECRET, VAPID_PUBLIC_KEY: vapidPub, VAPID_PRIVATE_KEY: vapidPriv }

    const subKp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const subPub = new Uint8Array(await crypto.subtle.exportKey('raw', subKp.publicKey))
    const subAuth = crypto.getRandomValues(new Uint8Array(16))
    const subKeys = { p256dh: base64UrlEncode(subPub), auth: base64UrlEncode(subAuth) }

    const ghFetch = fakeGithubFetch({
      gh_due: { id: 10, login: 'dueuser', name: 'Due' },
      gh_done: { id: 20, login: 'doneuser', name: 'Done' },
      gh_ny: { id: 30, login: 'nyuser', name: 'NY' },
    })

    const signIn = async (tok: string) =>
      ((await (await handle(req('/api/friends/session', { method: 'POST', body: JSON.stringify({ githubToken: tok }) }), env, ghFetch)).json()) as { token: string }).token

    const authDue = { authorization: `Bearer ${await signIn('gh_due')}` }
    const authDone = { authorization: `Bearer ${await signIn('gh_done')}` }
    const authNy = { authorization: `Bearer ${await signIn('gh_ny')}` }

    await handle(req('/api/friends/push/subscribe', { method: 'POST', headers: authDue, body: JSON.stringify({ endpoint: 'https://push.example/due', keys: subKeys }) }), env, ghFetch)
    await handle(req('/api/friends/push/subscribe', { method: 'POST', headers: authDone, body: JSON.stringify({ endpoint: 'https://push.example/done', keys: subKeys }) }), env, ghFetch)
    await handle(req('/api/friends/push/subscribe', { method: 'POST', headers: authNy, body: JSON.stringify({ endpoint: 'https://push.example/ny', keys: subKeys }) }), env, ghFetch)

    // 2026-11-23T03:00:00Z = 2026-11-22 20:00 America/Phoenix (UTC-7) and 2026-11-22 22:00 America/New_York (UTC-5)
    const phoenix8pmMs = Date.parse('2026-11-23T03:00:00.000Z')

    // User 10: no zone set (falls back to America/Phoenix, default reminder_hour = 20), NOT done, 7 dueLeft, 12-day streak -> SHOULD notify
    const dueStats: FriendStats = {
      ...sampleStats('2026-11-22', 5, 100, 12, false),
      totals: { ...sampleStats('2026-11-22', 5, 100, 12, false).totals, dueLeft: 7 },
    }
    await handle(req('/api/friends/stats', { method: 'PUT', headers: authDue, body: JSON.stringify({ stats: dueStats }) }), env, ghFetch)

    // User 20: America/Phoenix, ALREADY done today -> MUST skip
    await handle(
      req('/api/friends/stats', { method: 'PUT', headers: authDone, body: JSON.stringify({ stats: sampleStats('2026-11-22', 20, 400, 5, true), zone: 'America/Phoenix' }) }),
      env,
      ghFetch,
    )

    // User 30: America/New_York (22:00 != default 20:00) -> MUST skip at this hour
    await handle(
      req('/api/friends/stats', { method: 'PUT', headers: authNy, body: JSON.stringify({ stats: dueStats, zone: 'America/New_York' }) }),
      env,
      ghFetch,
    )

    const hitEndpoints: string[] = []
    const pushFetch = async (url: string): Promise<Response> => {
      hitEndpoints.push(url)
      return new Response(null, { status: 201 })
    }

    const r1 = await runDailyReminders(env, phoenix8pmMs, pushFetch)
    expect(r1).toEqual({ checked: 3, sent: 1, failed: 0 })
    expect(hitEndpoints).toEqual(['https://push.example/due'])

    // Running again in the same hour/day must NOT re-send (last_reminder_day dedup)
    hitEndpoints.length = 0
    const r2 = await runDailyReminders(env, phoenix8pmMs + 10 * 60_000, pushFetch)
    expect(r2).toEqual({ checked: 3, sent: 0, failed: 0 })
    expect(hitEndpoints).toEqual([])
  })
})
