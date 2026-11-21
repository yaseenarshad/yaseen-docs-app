import { describe, expect, it, vi } from 'vitest'
import { FriendsApiError, type FriendsBoardPayload } from '@shared/friendsApi'
import { PUBLISH_EVERY_MS } from '@shared/friendSend'
import { friendStats, type FriendVault } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { ClosedVaultsUnreadable, countPayload } from './countJob'
import { createMacSender, failWait, type MacClock, type MacSendSaved } from './macSender'

const START = Date.parse('2026-11-21T18:00:00Z')

function fakeClock(start = START): { clock: MacClock; advance(ms: number): void; now(): number } {
  let t = start
  return {
    clock: {
      now: () => t,
      setTimeout: () => 0,
      clearTimeout: () => undefined,
    },
    advance(ms: number) {
      t += ms
    },
    now: () => t,
  }
}

function makeBoard(overrides: Partial<FriendsBoardPayload> = {}): FriendsBoardPayload {
  return {
    me: {
      id: 1,
      login: 'yaseen',
      name: 'Yaseen',
      nickname: null,
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      zone: 'America/Denver',
      vaults: ['yaseen/notes'],
      stats: null,
      statsAt: null,
    },
    friends: [
      {
        id: 2,
        login: 'ali',
        name: 'Ali',
        avatarUrl: null,
        since: '2026-11-01T00:00:00Z',
        stats: null,
        statsAt: null,
        incomingMark: null,
        outgoingMark: null,
        sharedCardCount: 0,
      },
    ],
    invites: [],
    groups: [],
    incomingCards: [],
    ...overrides,
  }
}

function makeVault(cards: number): FriendVault {
  return {
    pages: Array.from({ length: cards }, (_, i) => ({
      cards: [{ id: `YAZ-${i + 1}`, off: false, next: false, reviews: [{ at: '2026-11-21T17:00:00.000Z', rating: 'good', seconds: 10 }] }],
    })) as unknown as FriendVault['pages'],
    settings: DEFAULT_REVIEW_SETTINGS,
  }
}

describe('createMacSender (D1 Friends API, YAZ-6219)', () => {
  it('returns no-token when signed out without calling the API', async () => {
    const board = vi.fn()
    const sendStats = vi.fn()
    const sender = createMacSender({
      readToken: async () => null,
      client: { board, sendStats, clearSession: vi.fn() },
      vaults: async () => new Map(),
      count: async () => makeVault(1),
      stats: async () => friendStats([makeVault(1)], START, 'America/Denver'),
      state: { load: async () => null, save: async () => undefined },
      clock: fakeClock().clock,
    })
    expect((await sender.attempt('pass')).status).toBe('no-token')
    expect(board).not.toHaveBeenCalled()
    expect(sendStats).not.toHaveBeenCalled()
    await sender.stop()
  })

  it('returns no-friends when user has 0 friends and 0 groups', async () => {
    const sendStats = vi.fn()
    const sender = createMacSender({
      readToken: async () => 'ghu_tok',
      client: {
        board: async () => makeBoard({ friends: [], groups: [] }),
        sendStats,
        clearSession: vi.fn(),
      },
      vaults: async () => new Map([['yaseen/notes', '/vault/notes']]),
      count: async () => makeVault(2),
      stats: async () => friendStats([makeVault(2)], START, 'America/Denver'),
      state: { load: async () => null, save: async () => undefined },
      clock: fakeClock().clock,
    })
    const view = await sender.attempt('pass')
    expect(view.status).toBe('no-friends')
    expect(sendStats).not.toHaveBeenCalled()
    await sender.stop()
  })

  it('counts open vaults, sends stats via client.sendStats, enforces 5-min wait, and skips unchanged input', async () => {
    const { clock, advance } = fakeClock()
    let saved: MacSendSaved | null = null
    const sendStats = vi.fn(async (_stats: unknown, _zone?: string | null) => ({ ok: true as const, statsAt: new Date(clock.now()).toISOString() }))
    let cardCount = 2

    const sender = createMacSender({
      readToken: async () => 'ghu_tok',
      client: {
        board: async () => makeBoard(),
        sendStats,
        clearSession: vi.fn(),
      },
      vaults: async () => new Map([['yaseen/notes', '/vault/notes']]),
      count: async () => makeVault(cardCount),
      stats: async (_text, now, _closed, zone) => friendStats([makeVault(cardCount)], now, zone ?? undefined),
      state: { load: async () => saved, save: async (s) => void (saved = structuredClone(s)) },
      clock,
    })

    // First send succeeds
    const first = await sender.attempt('pass')
    expect(first.status).toBe('sent')
    expect(first.friends).toBe(1)
    expect(sendStats).toHaveBeenCalledTimes(1)
    expect(sendStats.mock.calls[0][1]).toBe('America/Denver')

    // Within 5 minutes -> waiting
    advance(60_000)
    expect((await sender.attempt('pass')).status).toBe('waiting')
    expect(sendStats).toHaveBeenCalledTimes(1)

    // After 5 minutes with same cards -> unchanged
    advance(PUBLISH_EVERY_MS)
    expect((await sender.attempt('pass')).status).toBe('unchanged')
    expect(sendStats).toHaveBeenCalledTimes(1)

    // After 5 minutes with new card -> sent again
    cardCount = 3
    advance(PUBLISH_EVERY_MS + 1)
    expect((await sender.attempt('pass')).status).toBe('sent')
    expect(sendStats).toHaveBeenCalledTimes(2)

    await sender.stop()
  })

  it('falls back to counting open vaults when board.me.vaults is empty (Mac-only user)', async () => {
    const { clock } = fakeClock()
    const sendStats = vi.fn(async (_stats: unknown, _zone?: string | null) => ({ ok: true as const, statsAt: new Date(clock.now()).toISOString() }))
    const sender = createMacSender({
      readToken: async () => 'ghu_tok',
      client: {
        board: async () => makeBoard({ me: { ...makeBoard().me, vaults: [] } }),
        sendStats,
        clearSession: vi.fn(),
      },
      vaults: async () => new Map([['yaseen/mac-vault', '/vault/mac']]),
      count: async () => makeVault(1),
      stats: async (_text, now, _closed, zone) => friendStats([makeVault(1)], now, zone ?? undefined),
      state: { load: async () => null, save: async () => undefined },
      clock,
    })
    expect((await sender.attempt('pass')).status).toBe('sent')
    expect(sendStats).toHaveBeenCalledTimes(1)
    await sender.stop()
  })

  it('reports missing-vaults when a configured vault is neither open nor closed on this Mac', async () => {
    const sender = createMacSender({
      readToken: async () => 'ghu_tok',
      client: {
        board: async () => makeBoard({ me: { ...makeBoard().me, vaults: ['yaseen/notes', 'yaseen/other'] } }),
        sendStats: vi.fn(),
        clearSession: vi.fn(),
      },
      vaults: async () => new Map([['yaseen/notes', '/vault/notes']]),
      closed: async () => new Map(),
      count: async () => makeVault(1),
      stats: async () => friendStats([makeVault(1)], START),
      state: { load: async () => null, save: async () => undefined },
      clock: fakeClock().clock,
    })
    const view = await sender.attempt('pass')
    expect(view.status).toBe('missing-vaults')
    expect(view.missing).toBe(1)
    await sender.stop()
  })

  it('backs off on failed counts and surfaces unreadable closed vaults', async () => {
    const { clock, advance } = fakeClock()
    let saved: MacSendSaved | null = null
    const sender = createMacSender({
      readToken: async () => 'ghu_tok',
      client: {
        board: async () => makeBoard(),
        sendStats: vi.fn(),
        clearSession: vi.fn(),
      },
      vaults: async () => new Map([['yaseen/notes', '/vault/notes']]),
      count: async () => makeVault(1),
      stats: async () => {
        throw new ClosedVaultsUnreadable([{ root: '/vault/closed', why: 'unreadable' }])
      },
      state: { load: async () => saved, save: async (s) => void (saved = structuredClone(s)) },
      clock,
    })
    const v1 = await sender.attempt('pass')
    expect(v1.status).toBe('missing-vaults')
    expect(v1.unreadable).toBe(1)
    expect(v1.retryAt).toBe(START + failWait(1))

    advance(60_000)
    const v2 = await sender.attempt('pass')
    expect(v2.status).toBe('missing-vaults')
    expect(v2.retryAt).toBe(START + failWait(1))
    await sender.stop()
  })

  it('maps API 401, 429, and network errors cleanly', async () => {
    const { clock } = fakeClock()
    const makeWithErr = (err: unknown) =>
      createMacSender({
        readToken: async () => 'ghu_tok',
        client: {
          board: async () => {
            throw err
          },
          sendStats: vi.fn(),
          clearSession: vi.fn(),
        },
        vaults: async () => new Map([['yaseen/notes', '/vault/notes']]),
        count: async () => makeVault(1),
        stats: async () => friendStats([makeVault(1)], START),
        state: { load: async () => null, save: async () => undefined },
        clock,
      })

    expect((await makeWithErr(new FriendsApiError(401, 'unauthorized')).attempt('pass')).status).toBe('sign-in-again')
    expect((await makeWithErr(new FriendsApiError(401, 'signed_out')).attempt('pass')).status).toBe('no-token')
    expect((await makeWithErr(new FriendsApiError(429, 'rate_limited')).attempt('pass')).status).toBe('slowed')
    expect((await makeWithErr(new TypeError('fetch failed')).attempt('pass')).status).toBe('offline')
  })

  it('clears cached session on tokenChanged', async () => {
    const clearSession = vi.fn()
    const sender = createMacSender({
      readToken: async () => 'ghu_tok',
      client: {
        board: async () => makeBoard(),
        sendStats: vi.fn(async () => ({ ok: true as const, statsAt: new Date(START).toISOString() })),
        clearSession,
      },
      vaults: async () => new Map([['yaseen/notes', '/vault/notes']]),
      count: async () => makeVault(1),
      stats: async (_t, now) => friendStats([makeVault(1)], now),
      state: { load: async () => null, save: async () => undefined },
      clock: fakeClock().clock,
    })
    sender.tokenChanged()
    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(countPayload([])).toBe('[]')
    await sender.stop()
  })
})
