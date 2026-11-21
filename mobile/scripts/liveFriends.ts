/**
 * OPT-IN, NOT A TEST (YAZ-5082): runs the friends gist logic for real on GitHub, with made-up numbers only. It never
 * runs in `npm test`.
 *
 *   npx vite-node --config mobile/vite.config.ts mobile/scripts/liveFriends.ts -- "<path to a file that holds the token>"
 *
 * It reads the first `github_pat_…` string of that file and never prints, logs or writes it. Every gist it makes is
 * SECRET and its description starts with "notecards-test". It makes at most 15 gist writes (create, update, delete)
 * in all, and deletes every gist it made before it ends, then checks that with a list call. It stops at once when the
 * account already has a friends file that it did not make (it never touches a real one).
 * Steps: make or find (and a second find: no duplicate), a pointer, a send (one update, GitHub's gist_update count),
 * a send of the same numbers (no write), a friend read through the pointer and its free 304, the numbers gist
 * deleted and made again (pointer and list updated), a read of the new numbers, the clean-up.
 */
import { readFileSync } from 'node:fs'
import {
  INDEX_FILE,
  NUMBERS_FILE,
  POINTER_FILE,
  agoLabel,
  ensureFriendsFiles,
  makePointer,
  readFriend,
  replaceNumbersGist,
  updatedAgo,
  writeFriendsIndex,
  type FriendReadCache,
  type WriteOptions,
} from '@shared/friendGists'
import { emptyBudget, sendNumbers, type GistBudget } from '@shared/friendSend'
import type { FriendStats } from '@shared/friendStats'
import { GithubError, githubClient } from '../src/github/client'
import { gistsApi } from '../src/friends/gistsApi'

const MAX_WRITES = 15
/** Writes kept for the clean-up: the list, the numbers gist, the pointer. */
const CLEANUP = 3
const PREFIX = 'notecards-test'

const file = process.argv.slice(2).find((a) => a !== '--')
if (!file) throw new Error('Give the path of the token file')
const token = readFileSync(file, 'utf8').match(/github_pat_[A-Za-z0-9_]+/)?.[0]
if (!token) throw new Error('No github_pat_ token in that file')

const log = (...parts: unknown[]) => console.log(...parts.map((p) => String(typeof p === 'object' ? JSON.stringify(p) : p).split(token).join('[token]')))
const made = new Set<string>()
let writes = 0
let cleaning = false
const statuses: number[] = []
const client = githubClient(token, {
  fetch: async (url, init) => {
    const method = (init.method ?? 'GET').toUpperCase()
    if (method !== 'GET') {
      if (writes >= MAX_WRITES || (!cleaning && writes >= MAX_WRITES - CLEANUP)) throw new Error(`live script: write budget reached (${writes})`)
      writes++
    }
    const res = await fetch(url, init)
    statuses.push(res.status)
    if (method === 'POST' && res.status === 201) made.add(((await res.clone().json()) as { id: string }).id)
    return res
  },
})
const api = gistsApi(client)
const opts: WriteOptions = { describe: (kind) => `${PREFIX} ${kind} (YAZ-5082 live run, made-up numbers)`, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const [w0, s0, t0] = [writes, statuses.length, performance.now()]
  try {
    const out = await run()
    log(`${name}: ${(performance.now() - t0).toFixed(0)} ms, answers ${statuses.slice(s0).join(' ')}, writes ${writes - w0}`)
    return out
  } catch (error) {
    if (error instanceof GithubError) log(`${name}: ${error.code} (${error.status}) "${error.said}"`)
    throw error
  }
}

const today = new Date().toISOString().slice(0, 10)
const numbers = (cards: number): FriendStats => ({
  v: 1,
  login: 'notecards-test',
  name: 'Test numbers',
  avatar: '',
  days: [{ day: today, cards, seconds: cards * 7, remembered: cards, forgot: 1, newCards: 2, done: cards > 5 }],
  totals: { cards: 123, inReview: 100, newLeft: 20, mature: 40, dueLeft: 0, addedThisWeek: 3, streak: 2, bestStreak: 5, bestDay: 30, bestWeek: 90 },
  at: new Date().toISOString(),
})

try {
  const before = await step('0. list my gists', () => api.list())
  const real = before.filter((g) => (g.files.includes(INDEX_FILE) || g.files.includes(NUMBERS_FILE) || g.files.includes(POINTER_FILE)) && !g.description.startsWith(PREFIX))
  if (real.length > 0) throw new Error(`the account has ${real.length} friends file(s) that this script did not make: stop`)
  log(`   ${before.length} gists before`)

  const first = await step('1. make or find (a new person)', () => ensureFriendsFiles(api, { vaults: ['notecards-test/vault'], nickname: null }, opts))
  if (first.kind !== 'ok') throw new Error(first.kind)
  log(`   list ${first.handle.id.slice(0, 8)}…, numbers ${first.handle.index.stats!.slice(0, 8)}…`)
  const again = await step('2. make or find again (a reinstall)', () => ensureFriendsFiles(api, { vaults: ['other/vault'], nickname: 'x' }, opts))
  if (again.kind !== 'ok' || again.handle.id !== first.handle.id || again.handle.index.stats !== first.handle.index.stats) throw new Error('a second find made or found another file')
  log(`   the same list and numbers gist; vaults kept: ${again.handle.index.vaults.join(',')}`)

  const pointer = await step('3. one pointer', () => makePointer(api, first.handle.index.stats!, opts))
  let handle = await step('4. the list names one friend', () => writeFriendsIndex(api, again.handle, { ...again.handle.index, friends: [{ name: 'Test friend', theirs: pointer, mine: pointer }] }))

  let budget: GistBudget = emptyBudget()
  const sent = await step('5. send (one update)', () => sendNumbers(api, { statsId: handle.index.stats!, fresh: numbers(9), budget, reserve: 6, now: Date.now() }))
  budget = sent.budget
  log(`   outcome ${sent.outcome.kind}; GitHub's gist_update: ${JSON.stringify(budget.seen)}`)
  const same = await step('6. send the same numbers', () => sendNumbers(api, { statsId: handle.index.stats!, fresh: numbers(4), budget, reserve: 6, now: Date.now() }))
  log(`   outcome ${same.outcome.kind} (never lower: 4 < 9)`)

  const cache: FriendReadCache = new Map()
  const read = await step('7. read the friend through the pointer', () => readFriend(api, pointer, cache))
  log(`   ${read.kind}${read.kind === 'ok' ? `: today ${read.stats.days[0]?.cards} cards, updated ${agoLabel(updatedAgo(read.updatedAt, Date.now()))}` : ''}`)
  await step('8. read again with the ETags (304s)', () => readFriend(api, pointer, cache))

  const old = handle.index.stats!
  await step('9. delete the numbers gist (as on GitHub)', () => api.remove(old))
  const gone = await step('10. send: the numbers gist is gone', () => sendNumbers(api, { statsId: old, fresh: numbers(11), budget, reserve: 6, now: Date.now() }))
  if (gone.outcome.kind !== 'numbers-gone') throw new Error(`expected numbers-gone, got ${gone.outcome.kind}`)
  const remade = await step('11. make it again; the pointer and the list follow', () => replaceNumbersGist(api, handle, JSON.stringify(numbers(11)), opts))
  handle = remade.handle
  log(`   new numbers ${handle.index.stats!.slice(0, 8)}…, pointers updated ${remade.pointers.updated.length}, gone ${remade.pointers.gone.length}`)
  const after = await step('12. read the friend again', () => readFriend(api, pointer, new Map()))
  log(`   ${after.kind}${after.kind === 'ok' ? `: today ${after.stats.days[0]?.cards} cards, pointer names the new gist: ${after.pointer.stats === handle.index.stats}` : ''}`)
  const unknown = await step('13. a link that does not exist', () => readFriend(api, '0123456789abcdef0123456789abcdef', new Map()))
  log(`   ${unknown.kind}`)
} finally {
  cleaning = true
  for (const id of made) {
    try {
      await api.remove(id)
    } catch (error) {
      if (!(error instanceof GithubError && error.code === 'NOT_FOUND')) log(`clean-up of ${id.slice(0, 8)}… failed: ${error instanceof GithubError ? error.code : 'error'}`)
    }
  }
  const left = (await api.list()).filter((g) => made.has(g.id) || g.description.startsWith(PREFIX))
  log(`clean-up: made ${made.size} gists; left after the clean-up: ${left.length}; gist writes in all: ${writes} (limit ${MAX_WRITES})`)
  if (left.length > 0) process.exitCode = 1
}
