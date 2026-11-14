/**
 * OPT-IN, NOT A TEST (YAZ-5086): the Mac's send of the numbers, for real on GitHub, with made-up numbers only. It
 * never runs in `npm test`.
 *
 *   npx vite-node --config desktop/vitest.config.ts desktop/scripts/liveMacSend.ts -- "<path to a file that holds the token>"
 *
 * It reads the first `github_pat_…` string of that file and never prints, logs or writes it. Every gist it makes is
 * SECRET and its description starts with "notecards-test". At most 10 gist writes in all. It deletes every gist it
 * made, then checks that with a list call. It stops at once when the account already has a friends file.
 * Steps: the friends files and one friend (as the phone makes them), the Mac's send (one PATCH), the same numbers
 * again (no write), the numbers read back (only the allowed fields), the clean-up.
 */
import { readFileSync } from 'node:fs'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, ensureFriendsFiles, makePointer, writeFriendsIndex, type WriteOptions } from '@shared/friendGists'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import type { FriendVault } from '@shared/friendStats'
import { macGistsApi, readProfile } from '../src/main/friends/gistsHttp'
import { createMacSender, type MacSendSaved } from '../src/main/friends/macSender'

const file = process.argv.slice(2).filter((a) => a !== '--')[0]
const token = /github_pat_[A-Za-z0-9_]+/.exec(readFileSync(file, 'utf8'))?.[0]
if (token === undefined) throw new Error('no github_pat_ token in that file')

let writes = 0
const MAX_WRITES = 10
const real = macGistsApi(token, globalThis.fetch)
const api: typeof real = {
  ...real,
  async create(d, f) {
    if (++writes > MAX_WRITES) throw new Error('write budget')
    return real.create(d, f)
  },
  async update(id, f) {
    if (++writes > MAX_WRITES) throw new Error('write budget')
    return real.update(id, f)
  },
  async remove(id) {
    if (++writes > MAX_WRITES) throw new Error('write budget')
    return real.remove(id)
  },
}
const opts: WriteOptions = { describe: (kind) => `notecards-test ${kind} (YAZ-5086 live)`, sleep: (ms) => new Promise((d) => setTimeout(d, ms)) }
const made: string[] = []
const log = (step: string, result: string) => console.log(`${step.padEnd(44)} ${result}`)

const before = await real.list()
if (before.some((g) => g.files.includes(INDEX_FILE) || g.files.includes(NUMBERS_FILE) || g.files.includes(POINTER_FILE))) {
  console.log('The account already has a friends file. Stop: this script never touches a real one.')
  process.exit(1)
}

try {
  let t = Date.now()
  const ensured = await ensureFriendsFiles(api, { vaults: ['test/made-up-vault'], nickname: null }, opts)
  if (ensured.kind !== 'ok') throw new Error(ensured.kind)
  let handle = ensured.handle
  made.push(handle.id, handle.index.stats!)
  const pointer = await makePointer(api, handle.index.stats!, opts)
  made.push(pointer)
  handle = await writeFriendsIndex(api, handle, { ...handle.index, friends: [{ name: 'Test friend', theirs: pointer, mine: pointer }] })
  log('The phone side: list, numbers, one friend', `${writes} writes, ${((Date.now() - t) / 1000).toFixed(1)} s`)

  let saved: MacSendSaved | null = null
  let now = Date.now()
  const at = new Date(now - 60_000).toISOString().slice(0, 16) + ':00Z'
  const vault = { pages: [{ cards: [{ id: 'TEST-1', off: false, next: false, reviews: [{ at, rating: 'good', seconds: 7 }] }] }], settings: DEFAULT_REVIEW_SETTINGS } as unknown as FriendVault
  const sender = createMacSender({
    readToken: async () => token,
    api: () => api,
    profile: (tk) => readProfile(tk, globalThis.fetch),
    vaults: async () => new Map([['test/made-up-vault', '/made/up']]),
    count: async () => vault,
    state: { load: async () => saved, save: async (s) => void (saved = structuredClone(s)) },
    clock: { now: () => now, setTimeout: () => 0, clearTimeout: () => undefined },
  })
  const w0 = writes
  t = Date.now()
  const first = await sender.attempt('pass')
  const remaining = saved?.budget.seen?.remaining
  log("The Mac's send", `${first.status}, ${writes - w0} write, ${((Date.now() - t) / 1000).toFixed(1)} s, gist_update remaining ${String(remaining)}`)
  now += 6 * 60_000
  const w1 = writes
  const again = await sender.attempt('pass')
  log('The same numbers, 6 minutes later', `${again.status}, ${writes - w1} writes`)
  const doc = await real.read(handle.index.stats!)
  if (doc === 'unchanged') throw new Error('no ETag was sent')
  const numbers = JSON.parse(doc.files[NUMBERS_FILE].content ?? '{}') as Record<string, unknown>
  log('The numbers gist holds', Object.keys(numbers).sort().join(', '))
  log('Today on the gist', JSON.stringify((numbers.days as { cards: number }[])[0]?.cards ?? null) + ' card')
  await sender.stop()
} finally {
  for (const id of made.reverse()) await api.remove(id).catch(() => undefined)
  const after = await real.list()
  const left = after.filter((g) => g.description.startsWith('notecards-test')).length
  log('Clean-up', `${made.length} gists made, ${left} left (a list call). ${writes} gist writes in all (limit ${MAX_WRITES})`)
}
