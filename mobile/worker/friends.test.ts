import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import type { FriendStats } from '../../shared/friendStatsFormat'
import type { D1Database, D1PreparedStatement, D1Result } from './d1Types'
import { handle, type Env } from './index'

const MIGRATION_SQL = readFileSync(join(__dirname, 'migrations/0001_friends.sql'), 'utf8')

/** Real SQLite-backed D1 adapter executing the exact production 0001_friends.sql migration. */
function makeSqliteD1(): D1Database {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(MIGRATION_SQL)

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

    // Cheer from Alice to Bob
    const markRes = await handle(req('/api/friends/marks', { method: 'POST', headers: authA, body: JSON.stringify({ toUserId: 2, kind: 'cheer' }) }), env, ghFetch)
    expect(markRes.status).toBe(200)

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

    // Charlie joins late -> pending -> Alice approves -> Charlie sees the Biochem folder!
    await handle(req('/api/friends/invites/accept', { method: 'POST', headers: authC, body: JSON.stringify({ code: grp.inviteCode }) }), env, ghFetch)
    await handle(req(`/api/friends/groups/${grp.id}/approve`, { method: 'POST', headers: authA, body: JSON.stringify({ userId: 3 }) }), env, ghFetch)

    const boardC = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authC }), env, ghFetch)).json()) as {
      groups: { sharedFolders: { id: string; name: string; cards: { id: string; status: string }[] }[] }[]
    }
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

    // Bob sees Alice's cheer + sharedCardCount = 1 + incoming card
    const boardB = (await (await handle(req('/api/friends/board', { method: 'GET', headers: authB }), env, ghFetch)).json()) as {
      friends: { id: number; sharedCardCount: number; incomingMark: { kind: string } | null }[]
      incomingCards: { title: string }[]
    }
    expect(boardB.friends[0].sharedCardCount).toBe(1)
    expect(boardB.friends[0].incomingMark?.kind).toBe('cheer')
    expect(boardB.incomingCards[0].title).toBe('Krebs')

    // Delete my Friends data wipes Bob cleanly
    const delMe = await handle(req('/api/friends/me', { method: 'DELETE', headers: authB }), env, ghFetch)
    expect(delMe.status).toBe(200)
    const afterDel = await handle(req('/api/friends/board', { method: 'GET', headers: authB }), env, ghFetch)
    expect(afterDel.status).toBe(401)
  })
})
