/**
 * OPT-IN, NOT A TEST (YAZ-5083): runs the friends list logic for real on GitHub, with made-up data only. It never runs
 * in `npm test`.
 *
 *   npx vite-node --config mobile/vite.config.ts mobile/scripts/liveFriendsList.ts -- "<path to a file that holds the token>"
 *
 * It reads the first `github_pat_…` string of that file and never prints, logs or writes it. Every gist it makes is
 * SECRET, its description starts with "notecards-test", and it holds made-up numbers. At most 15 gist writes in all.
 * It deletes every gist it made before it ends, and checks that with a list call. It stops at once when the account
 * already has a friends file that it did not make.
 *
 * One token means one GitHub account, so "Bea" is simulated in the same account: ONE gist that holds her numbers file
 * and her pointer file (the pointer names that same gist as her numbers). Steps: make the list, paste Bea's link in a
 * messy shape (waiting), my own link (refused), Bea adds me (paired), a second read (304s), remove Bea in steps (a new
 * numbers gist), Bea's pointer gone ("No longer shares with you", no second call), the clean-up.
 */
import { readFileSync } from 'node:fs'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, ensureFriendsFiles, type WriteOptions } from '@shared/friendGists'
import { emptyBudget } from '@shared/friendSend'
import { friendLink, newListCache, pasteLink, pasteMessage, readFriends, removeFriend, type ListOptions } from '@shared/friendsList'
import type { FriendStats } from '@shared/friendStats'
import { GithubError, githubClient } from '../src/github/client'
import { gistsApi } from '../src/friends/gistsApi'

const MAX_WRITES = 15
const CLEANUP = 2 // the list and the new numbers gist
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
const opts: ListOptions & WriteOptions = {
  describe: (kind) => `${PREFIX} ${kind} (YAZ-5083 live run, made-up numbers)`,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const [w0, s0, t0] = [writes, statuses.length, performance.now()]
  try {
    const out = await run()
    log(`${name}: ${(performance.now() - t0).toFixed(0)} ms, answers ${statuses.slice(s0).join(' ') || '-'}, writes ${writes - w0}`)
    return out
  } catch (error) {
    if (error instanceof GithubError) log(`${name}: ${error.code} (${error.status}) "${error.said}"`)
    throw error
  }
}

const today = new Date().toISOString().slice(0, 10)
const bea: FriendStats = {
  v: 1,
  login: 'notecards-test-bea',
  name: 'Bea (test)',
  avatar: '',
  days: [{ day: today, cards: 7, seconds: 70, remembered: 6, forgot: 1, newCards: 2, done: true }],
  totals: { cards: 50, inReview: 40, newLeft: 10, mature: 5, dueLeft: 0, addedThisWeek: 2, streak: 3, bestStreak: 3, bestDay: 9, bestWeek: 20 },
  at: new Date().toISOString(),
}

try {
  const before = await step('0. list my gists', () => api.list())
  const real = before.filter((g) => [INDEX_FILE, NUMBERS_FILE, POINTER_FILE].some((f) => g.files.includes(f)) && !g.description.startsWith(PREFIX))
  if (real.length > 0) throw new Error(`the account has ${real.length} friends file(s) that this script did not make: stop`)

  const mine = await step('1. make my list and numbers gist', () => ensureFriendsFiles(api, { vaults: ['notecards-test/vault'], nickname: 'Me (test)' }, opts))
  if (mine.kind !== 'ok') throw new Error(mine.kind)

  // Bea: one gist with her numbers; her pointer names a made-up ID until she "adds me" (step 5) and names this gist.
  const beaGist = await step('2. Bea`s gist (numbers + pointer)', () =>
    api.create(opts.describe('numbers'), { [NUMBERS_FILE]: JSON.stringify(bea), [POINTER_FILE]: JSON.stringify({ v: 1, stats: '0123456789abcdef0123456789abcdef' }) }),
  )

  const pasted = await step('3. paste Bea`s link, messy', () => pasteLink(api, mine.handle, `  hi! ${friendLink(beaGist.id)}/  `, opts))
  log(`   ${pasted.kind}: "${pasteMessage(pasted)}"`)
  if (pasted.kind !== 'added') throw new Error(pasted.kind)
  const myPointer = pasted.handle.index.friends[0].mine
  const own = await step('4. paste my own link', () => pasteLink(api, pasted.handle, friendLink(myPointer), opts))
  log(`   ${own.kind}: "${pasteMessage(own)}"`)

  await step('5. Bea adds me (her pointer: her numbers, reads mine)', () => api.update(beaGist.id, { [POINTER_FILE]: JSON.stringify({ v: 1, stats: beaGist.id, reads: myPointer }) }))
  const cache = newListCache()
  const rows = await step('6. my rows', () => readFriends(api, pasted.handle, cache, Date.now()))
  log(`   ${rows.rows.map((r) => `${r.name}: ${r.state}${r.read?.kind === 'ok' ? `, today ${r.read.stats.days[0]?.cards} cards` : ''}`).join('; ')}`)
  await step('7. my rows again (ETags)', () => readFriends(api, pasted.handle, cache, Date.now()))

  const removed = await step('8. remove Bea (in steps)', () => removeFriend(api, pasted.handle, myPointer, emptyBudget(), opts))
  log(`   ${removed.kind}; numbers gist ${mine.handle.index.stats!.slice(0, 8)}… → ${removed.handle.index.stats!.slice(0, 8)}…; friends ${removed.handle.index.friends.length}`)

  // Bea's gist is a numbers gist of this same account, so the remove's last step deleted it as an extra one. For a
  // real Bea (another account) it stays; here it stands for "Bea removed me".
  const gone = await step('9. rows of the old list: Bea is gone', () => readFriends(api, pasted.handle, cache, Date.now()))
  log(`   ${gone.rows.map((r) => `${r.name}: ${r.state} "${r.label}"`).join('; ')}`)
  await step('10. rows again within the hour (no call)', () => readFriends(api, pasted.handle, cache, Date.now()))
} finally {
  cleaning = true
  const left0 = (await api.list()).filter((g) => made.has(g.id) || g.description.startsWith(PREFIX))
  for (const g of left0) {
    try {
      await api.remove(g.id)
    } catch (error) {
      if (!(error instanceof GithubError && error.code === 'NOT_FOUND')) log(`clean-up of ${g.id.slice(0, 8)}… failed: ${error instanceof GithubError ? error.code : 'error'}`)
    }
  }
  const left = (await api.list()).filter((g) => made.has(g.id) || g.description.startsWith(PREFIX))
  log(`clean-up: made ${made.size} gists; deleted ${left0.length} at the end; left after the clean-up: ${left.length}; gist writes in all: ${writes} (limit ${MAX_WRITES})`)
  if (left.length > 0) process.exitCode = 1
}
