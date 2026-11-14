import { groupLink } from '@shared/friendGroups'
import { FRIEND_LINK_BASE } from '@shared/friendsList'
import type { FriendDay, FriendStats } from '@shared/friendStats'
import { localFriends } from '../../app/friendsPort'
import type { VaultStore } from '../../store'
import type { ShareResult, Unavailable } from '../list'
import { addDays, localDay } from './board'
import type { GroupMemberRow, GroupView, GroupsPort } from './groups'
import type { MarkKind, MarkSend, OutMark } from './marks'
import type { Board, FriendEntry, FriendsService, FriendsServices, Me, PasteAnswer } from './service'

/**
 * TEST AND FIXTURE HELP ONLY (YAZ-5085): made-up friends and a fake service, for the screen tests and the screenshot
 * fixtures (`--mode fixtures`). No real name, no network.
 */
export const DEMO_AVATAR = 'https://avatars.githubusercontent.com/u/1?v=4'

export function demoStats(now: number, name: string, days: [number, Partial<FriendDay>][], totals: Partial<FriendStats['totals']> = {}): FriendStats {
  const today = localDay(now)
  return {
    v: 1,
    login: name.toLowerCase(),
    name,
    avatar: '',
    days: days
      .map(([o, d]) => ({
        day: addDays(today, o),
        cards: 0,
        seconds: 0,
        remembered: 0,
        forgot: 0,
        newCards: 0,
        done: false,
        ...d,
      }))
      .sort((a, b) => (a.day < b.day ? 1 : -1)),
    totals: {
      cards: 0,
      inReview: 0,
      newLeft: 0,
      mature: 0,
      dueLeft: 0,
      addedThisWeek: 0,
      streak: 0,
      bestStreak: 0,
      bestDay: 0,
      bestWeek: 0,
      ...totals,
    },
    at: new Date(now).toISOString(),
  }
}

let next = 0
const hex = (seed: string) => (seed.replace(/[^0-9a-f]/g, '') + (++next).toString(16).padStart(8, '0') + 'a'.repeat(32)).slice(0, 32)

export function demoFriend(
  now: number,
  name: string,
  patch: Partial<FriendEntry> & {
    days?: [number, Partial<FriendDay>][]
    totals?: Partial<FriendStats['totals']>
  } = {},
): FriendEntry {
  const { days, totals, ...rest } = patch
  return {
    theirs: hex(`f${name}`),
    mine: hex(`m${name}`),
    name,
    avatar: null,
    state: 'ok',
    label: null,
    sendBack: null,
    stats: demoStats(now, name, days ?? [[0, { cards: 10, seconds: 600 }]], totals),
    updatedAt: now - 2 * 3600_000,
    mark: undefined,
    ...rest,
  }
}

export function demoMe(now: number): Me {
  return {
    name: 'Demo Person',
    avatar: null,
    stats: demoStats(
      now,
      'Demo Person',
      [
        [
          0,
          {
            cards: 31,
            newCards: 9,
            seconds: 55 * 60,
            remembered: 40,
            forgot: 6,
          },
        ],
        [
          -1,
          {
            cards: 42,
            newCards: 12,
            seconds: 61 * 60,
            done: true,
            remembered: 50,
            forgot: 3,
          },
        ],
        [-2, { cards: 20, done: true }],
        [-3, { cards: 18, done: true }],
        [-4, { cards: 30, done: false }],
        [-5, { cards: 12, done: true }],
        [-6, { cards: 25, done: true }],
      ],
      {
        cards: 2199,
        inReview: 1689,
        newLeft: 510,
        mature: 940,
        dueLeft: 6,
        addedThisWeek: 35,
        streak: 2,
        bestDay: 88,
      },
    ),
  }
}

/** The mockup's friends (version 9), made up: Sam cheered you; Priya started; Leo has no update yet. */
export function demoBoard(now: number, more: Partial<Extract<Board, { kind: 'ok' }>> = {}): Extract<Board, { kind: 'ok' }> {
  return {
    kind: 'ok',
    me: demoMe(now),
    friends: [
      demoFriend(now, 'Sam', {
        days: [
          [
            0,
            {
              cards: 44,
              newCards: 14,
              seconds: 66 * 60,
              done: true,
              remembered: 60,
              forgot: 5,
            },
          ],
          [-1, { cards: 38, done: true }],
          [-2, { cards: 22, done: true }],
          [-3, { cards: 9 }],
          [-4, { cards: 30, done: true }],
          [-5, { cards: 15, done: true }],
          [-6, { cards: 11, done: true }],
        ],
        totals: {
          cards: 1840,
          inReview: 1310,
          newLeft: 530,
          mature: 810,
          addedThisWeek: 60,
          streak: 8,
          bestDay: 96,
        },
        mark: { kind: 'cheer', at: new Date(now - 3600_000).toISOString() },
      }),
      demoFriend(now, 'Priya', {
        days: [
          [0, { cards: 12, seconds: 49 * 60 }],
          [-1, { cards: 51, done: true }],
        ],
        totals: { dueLeft: 20 },
        updatedAt: now - 43 * 60_000,
      }),
      demoFriend(now, 'Leo', { days: [[-1, { cards: 20 }]], updatedAt: null }),
    ],
    shared: [],
    groups: [],
    seen: {},
    outbox: {},
    offline: false,
    ...more,
  }
}

export function demoGroup(now: number, view: Partial<Extract<GroupView, { kind: 'ok' }>> = {}): Extract<GroupView, { kind: 'ok' }> {
  const member = (name: string, me: boolean, cards: number, done: boolean, admin = false): GroupMemberRow => ({
    login: name.toLowerCase(),
    name,
    pointer: hex(`g${name}`),
    me,
    admin,
    state: 'ok',
    read: {
      kind: 'ok',
      stats: demoStats(now, name, [[0, { cards, seconds: cards * 80, done }]]),
      pointer: { v: 1, stats: hex('s') },
      updatedAt: now - 5 * 60_000,
    },
    label: null,
    mark: done ? 'done' : cards > 0 ? 'started' : 'not-started',
  })
  return {
    kind: 'ok',
    group: hex('group'),
    name: 'Study group',
    admin: 'demo',
    iAmAdmin: true,
    members: [member('Demo Person', true, 31, false, true), member('Mina', false, 36, true), member('Sam', false, 44, true)],
    streak: 4,
    firstSeen: false,
    ...view,
  }
}

/** What a fake service was asked to do. */
export interface FakeCalls {
  share: number
  paste: string[]
  remove: string[]
  mark: { mine: string; kind: MarkKind }[]
  see: string[]
  groups: string[]
}

export interface FakeService extends FriendsService {
  calls: FakeCalls
  /** The board the next read gives. */
  next: Board
  shareAnswer: ShareResult | Unavailable
  pasteAnswer: PasteAnswer
  markAnswer: (mine: string, kind: MarkKind) => Promise<MarkSend>
  /** An answer for an action instead of `done`: `friend` (remove a friend or a link), and the groups calls by name. */
  answers: Partial<Record<'friend' | 'remove' | 'leave' | 'delete' | 'add', () => Promise<unknown>>>
}

export function fakeService(board: Board, options: { groups?: boolean } = {}): FakeService {
  const calls: FakeCalls = {
    share: 0,
    paste: [],
    remove: [],
    mark: [],
    see: [],
    groups: [],
  }
  const groupCall =
    (name: string, answer: unknown = { kind: 'done' }) =>
    async (...args: unknown[]) => {
      calls.groups.push(`${name}:${args.join(',')}`)
      const set = service.answers[name as keyof FakeService['answers']]
      return (set !== undefined ? await set() : answer) as never
    }
  const groups: GroupsPort = {
    create: groupCall('create', {
      kind: 'ok',
      group: 'a'.repeat(32),
      link: groupLink('a'.repeat(32)),
      title: 'Notecards group link',
      text: 'Join my group.',
    }),
    join: groupCall('join'),
    request: groupCall('request'),
    add: groupCall('add'),
    remove: groupCall('remove'),
    leave: groupCall('leave'),
    delete: groupCall('delete'),
    read: groupCall('read', { kind: 'not-found' }),
    all: groupCall('all', []),
  }
  const service: FakeService = {
    calls,
    answers: {},
    next: board,
    shareAnswer: {
      kind: 'ok',
      link: `${FRIEND_LINK_BASE}#${'b'.repeat(32)}`,
      title: 'Notecards friend link',
      text: 'Add me as a friend on Notecards.',
      whatFriendsSee: 'Friends see your review numbers only.',
    },
    pasteAnswer: { kind: 'not-a-link' },
    markAnswer: async (_mine, kind) => ({
      kind: 'sent',
      mark: { kind, at: new Date(Date.UTC(2026, 10, 13, 12)).toISOString() },
    }),
    groups: options.groups === false ? null : groups,
    whatFriendsSee: 'Friends see your review numbers only: cards, minutes and streaks. Never your cards or your pages.',
    board: async () => service.next,
    async share() {
      calls.share++
      return service.shareAnswer
    },
    async paste(text) {
      calls.paste.push(text)
      return service.pasteAnswer
    },
    async remove(mine) {
      calls.remove.push(mine)
      const set = service.answers.friend
      return (set !== undefined ? await set() : { kind: 'done' }) as never
    },
    async mark(mine, kind) {
      calls.mark.push({ mine, kind })
      return service.markAnswer(mine, kind)
    },
    async see(marks) {
      calls.see.push(...marks.map((m) => `${m.theirs}:${m.mark.at}`))
    },
  }
  return service
}

/** 4A's port with this fake service (as `lazyFriends` gives the real one). */
export function fakeServices(store: VaultStore, service: FriendsService, hasFriends = true): FriendsServices {
  return {
    ...localFriends(store),
    hasFriends: async () => hasFriends,
    service: async () => service,
    stop: async () => undefined,
  }
}

export type { OutMark }
