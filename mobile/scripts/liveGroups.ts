/**
 * OPT-IN, NOT A TEST (YAZ-5084): runs the group logic for real on GitHub, with made-up data only. It never runs in
 * `npm test`.
 *
 *   npx vite-node --config mobile/vite.config.ts mobile/scripts/liveGroups.ts -- "<path to a file that holds the token>"
 *
 * It reads the first `github_pat_…` string of that file and never prints, logs or writes it. Every gist it makes is
 * SECRET, its description starts with "notecards-test", and it holds made-up data. At most 15 gist writes in all. It
 * deletes every gist it made before it ends, and checks that with a list call. It stops at once when the account already
 * has a friends file that it did not make.
 *
 * One token is one account, so "Bea" is simulated in the same account: ONE gist with her numbers and her group pointer.
 * Steps: make my list, "New group", Bea's join request read by the admin, Add, read the group (then 304s), Remove Bea,
 * read again. "Delete group" costs about 8 writes; the suite tests it with 10 stop points.
 */
import { readFileSync } from 'node:fs'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, ensureFriendsFiles, type WriteOptions } from '@shared/friendGists'
import { newListCache, type ListOptions } from '@shared/friendsList'
import { GROUP_FILE, addMember, createGroup, groupLink, joinLink, readGroup, readJoinRequest, removeMember } from '@shared/friendGroups'
import type { FriendStats } from '@shared/friendStats'
import { GithubError, githubClient } from '../src/github/client'
import { gistsApi } from '../src/friends/gistsApi'

const MAX_WRITES = 15
const CLEANUP = 5 // the list, the numbers gist, my group pointer, the group file, Bea's gist
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
  describe: (kind) => `${PREFIX} ${kind} (YAZ-5084 live run, made-up numbers)`,
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
  const real = before.filter((g) => [INDEX_FILE, NUMBERS_FILE, POINTER_FILE, GROUP_FILE].some((f) => g.files.includes(f)) && !g.description.startsWith(PREFIX))
  if (real.length > 0) throw new Error(`the account has ${real.length} friends file(s) that this script did not make: stop`)

  const mine = await step('1. make my list and numbers gist', () => ensureFriendsFiles(api, { vaults: ['notecards-test/vault'], nickname: 'Me (test)' }, opts))
  if (mine.kind !== 'ok') throw new Error(mine.kind)
  const club = await step('2. New group', () => createGroup(api, mine.handle, '  Test club (notecards-test)  ', 'notecards-test-admin', opts))
  if (club.kind !== 'ok') throw new Error(club.kind)
  log(`   link ${groupLink(club.group).replace(club.group, club.group.slice(0, 8) + '…')}; members 1`)

  const beaGist = await step('3. Bea`s gist (numbers)', () => api.create(opts.describe('numbers'), { [NUMBERS_FILE]: JSON.stringify(bea) }))
  await step('4. Bea`s group pointer (names her numbers)', () => api.update(beaGist.id, { [POINTER_FILE]: JSON.stringify({ v: 1, stats: beaGist.id }) }))
  const request = await step('5. the admin reads Bea`s join request', () => readJoinRequest(api, club.handle, `  ${joinLink(club.group, beaGist.id)}/ `))
  log(`   ${request.kind}${request.kind === 'request' ? `: ${request.name} (${request.login}) asks to join ${request.groupName}` : ''}`)
  const added = await step('6. Add', () => addMember(api, club.handle, club.group, joinLink(club.group, beaGist.id), opts))
  log(`   ${added.kind}${added.kind === 'done' ? `, members ${added.file.members.length}` : ''}`)

  const cache = newListCache()
  const view = await step('7. read the group', () => readGroup(api, club.handle, club.group, cache, Date.now()))
  log(`   ${view.kind}${view.kind === 'ok' ? `: ${view.members.map((m) => `${m.name} ${m.state} ${m.mark ?? '-'}`).join('; ')}; streak ${view.streak}` : ''}`)
  await step('8. read again (ETags)', () => readGroup(api, club.handle, club.group, cache, Date.now()))

  const removed = await step('9. Remove Bea', () => removeMember(api, club.handle, club.group, beaGist.id, opts))
  log(`   ${removed.kind}`)
  const after = await step('10. read the group again', () => readGroup(api, club.handle, club.group, cache, Date.now()))
  log(`   ${after.kind}${after.kind === 'ok' ? `: members ${after.members.length}` : ''}`)
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
