/**
 * YAZ-5252, the scale of the closed-vault count. Made-up vaults in temp folders only, the REAL built count worker.
 * - YAZ-5390 (4E5i3): a closed vault of 100,000 files is counted inside the worker's limit (60 s); after that, a scan
 *   reads only the files that changed (its own cache of each file's cards, by time and size).
 * - The main thread (the checker measured 40 to 44 ms): the WHOLE path of one try of the Mac's sender (the real
 *   `knownClosedVaults` with real git, the real worker, an open vault of 20,000 cards and a closed one of 20,000 cards)
 *   holds the main thread less than 50 ms of CPU at a time. CPU time of THIS thread (`process.threadCpuUsage`), so the
 *   load of other work on the Mac does not move it; the wall time is logged next to it.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { cpus, loadavg, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CardRecord } from '@shared/cardLine'
import { ensureFriendsFiles, makePointer, writeFriendsIndex, type WriteOptions } from '@shared/friendGists'
import { fakeGistWorld } from '@shared/friendGistsFake'
import { PUBLISH_EVERY_MS } from '@shared/friendSend'
import type { FriendVault } from '@shared/friendStats'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { budgetMs, median } from '../../../../client/src/test-perf'
import { git, resolveGit } from '../git/exec'
import { gitFolderFacts, knownClosedVaults } from './closedVaults'
import { COUNT_LIMIT_MS, countPayload, makeCounter } from './countJob'
import { macGistsApi, readProfile } from './gistsHttp'
import { createMacSender, type MacSendSaved } from './macSender'
import { buildCountWorker, worldFetch } from './testing'

const TZ = process.env.TZ
beforeAll(() => void (process.env.TZ = 'America/New_York'))
afterAll(() => void (process.env.TZ = TZ))

const NOW = Date.parse('2026-11-14T15:00:00Z')
const RATINGS = ['again', 'hard', 'good', 'easy'] as const
let seed = 11
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
/** One card line with 0 to 10 answers in the last 90 days. */
function cardLine(id: string): string {
  const answers = Array.from({ length: Math.floor(rnd() * 11) }, () => `${new Date(NOW - Math.floor(rnd() * 90 * 86_400_000)).toISOString().slice(0, 16)}Z ${RATINGS[Math.floor(rnd() * 4)]} 5s`)
  return `<!-- card: ${[id, ...answers].join(', ')} -->`
}

let dir: string
let worker: string
beforeAll(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yd-scale-')))
  worker = await buildCountWorker()
}, 60_000)
afterAll(() => rm(dir, { recursive: true, force: true }), 300_000)

/** A made-up vault of `files` pages in folders of 100, `cards` cards in each page, IDs on. */
async function bigVault(name: string, files: number, cards: number): Promise<string> {
  const root = path.join(dir, name)
  await mkdir(path.join(root, '.yaseendocs'), { recursive: true })
  await writeFile(path.join(root, '.yaseendocs', 'ids.json'), '{"enabled":true,"letters":"WIKI"}')
  const jobs: (() => Promise<void>)[] = []
  for (let f = 0; f < files; f++) {
    const folder = path.join(root, `Folder ${Math.floor(f / 100)}`)
    const text = `# Page ${f}\n\nSome words of the page that the count never needs.\n\n${Array.from({ length: cards }, (_, c) => `\`\`\`card\nQuestion ${f}-${c}\n\`\`\`\n${cardLine(`WIKI-${f * cards + c + 1}`)}\n`).join('\n')}`
    jobs.push(async () => {
      if (f % 100 === 0) await mkdir(folder, { recursive: true })
      await writeFile(path.join(folder, `Page ${f}.md`), text)
    })
  }
  for (let i = 0; i < jobs.length; i += 100) {
    await jobs[i]()
    await Promise.all(jobs.slice(i + 1, i + 100).map((j) => j()))
  }
  return root
}

const time = async <T>(work: () => Promise<T>): Promise<[T, number]> => {
  const start = performance.now()
  const out = await work()
  return [out, performance.now() - start]
}

describe('a closed vault of 100,000 files (YAZ-5390)', () => {
  it('a closed vault of 100,000 files is counted inside the limit; then a scan reads only the files that changed', async () => {
    const root = await bigVault('huge', 100_000, 1)
    const count = makeCounter(worker, { scanDir: path.join(dir, 'scan-cache') })
    const [first, cold] = await time(() => count(countPayload([]), NOW, [{ root, key: 'a' }]))
    const coldScan = count.timing()
    expect(first.totals.cards).toBe(100_000)
    expect(count.read()).toBe(100_000)
    for (let i = 0; i < 10; i++) await writeFile(path.join(root, `Folder ${i * 7}`, `Page ${i * 700}.md`), `\`\`\`card\nQ\n\`\`\`\n<!-- card: WIKI-${i * 700 + 1}, 2026-11-14T14:00Z good 3s -->\n`)
    const [second, warm] = await time(() => count(countPayload([]), NOW, [{ root, key: 'b' }]))
    const warmScan = count.timing()
    expect(count.read()).toBe(10)
    expect(second.totals.cards).toBe(100_000)
    const [, same] = await time(() => count(countPayload([]), NOW, [{ root, key: 'b' }]))
    const sameScan = count.timing()
    expect(count.scanned()).toEqual([])
    const s = (ms: number) => `${(ms / 1000).toFixed(1)} s`
    console.info(
      `100,000 files (limit ${s(COUNT_LIMIT_MS)}; load ${loadavg()[0].toFixed(0)} on ${cpus().length} cores). The whole count: wall, worker CPU. The scan alone: wall, worker CPU.\n` +
        `  the first: ${s(cold)}, ${s(coldScan.cpuMs)}; scan ${s(coldScan.scanMs)}, ${s(coldScan.scanCpuMs)}\n` +
        `  after 10 changed files: ${s(warm)}, ${s(warmScan.cpuMs)}; scan ${s(warmScan.scanMs)}, ${s(warmScan.scanCpuMs)}\n` +
        `  the same key: ${s(same)}, ${s(sameScan.cpuMs)}; scan ${s(sameScan.scanMs)}, ${s(sameScan.scanCpuMs)}`,
    )
    // The whole count (the scan and `friendStats` of 100,000 cards) ends inside the worker's limit.
    expect(cold).toBeLessThan(COUNT_LIMIT_MS)
    expect(coldScan.cpuMs).toBeLessThan(COUNT_LIMIT_MS / 4)
    // The scan's own CPU time (not moved by the load of other work on the Mac): the reads are the cost, then only the stats.
    expect(coldScan.scanCpuMs).toBeLessThan(budgetMs(10_000))
    expect(warmScan.scanCpuMs).toBeLessThan(budgetMs(2_500))
    expect(sameScan.scanCpuMs).toBeLessThan(budgetMs(1_000))
  }, 600_000)
})

describe('the main thread, the whole path of one try (YAZ-5252)', () => {
  it('one try with an open vault of 20,000 cards and a closed vault of 20,000 cards: the main thread is busy less than 50 ms of CPU at a time', async () => {
    const bin = await resolveGit()
    expect(bin).not.toBeNull()
    const closedRoot = await bigVault('closed', 5_000, 4)
    const run = async (...args: string[]) => {
      const r = await git(bin!, closedRoot, args, { timeoutMs: 120_000 })
      if (r.code !== 0) throw new Error(r.stderr)
    }
    await run('init', '-q', '-b', 'main')
    await run('config', 'user.email', 'test@example.com')
    await run('config', 'user.name', 'Test')
    await run('add', '-A')
    await run('commit', '-q', '-m', 'cards')
    await run('remote', 'add', 'origin', 'git@github.com:yaseen/cards.git')
    // The open vault: 20,000 cards from the live index (in main's memory in the app).
    const open: FriendVault = {
      pages: Array.from({ length: 5000 }, (_, p) => ({
        cards: Array.from({ length: 4 }, (_, c): CardRecord => ({ id: `OPEN-${p * 4 + c + 1}`, off: false, next: false, reviews: Array.from({ length: Math.floor(rnd() * 11) }, () => ({ at: `${new Date(NOW - Math.floor(rnd() * 90 * 86_400_000)).toISOString().slice(0, 16)}Z`, rating: RATINGS[Math.floor(rnd() * 4)], seconds: 5 })) }) as unknown as CardRecord),
      })),
      settings: DEFAULT_REVIEW_SETTINGS,
    } as unknown as FriendVault
    const PHONE = 'github_pat_11SCALE_phone000000000000000000000000000000000000000000000000000000000000'
    const MAC = 'github_pat_11SCALE_mac00000000000000000000000000000000000000000000000000000000000000'
    const world = fakeGistWorld({ accounts: { [PHONE]: { login: 'yaseen' }, [MAC]: { login: 'yaseen' } }, start: NOW })
    const wire = worldFetch(world, { [MAC]: { login: 'yaseen', name: 'Y', avatar_url: 'https://avatars.githubusercontent.com/u/7' } })
    const opts: WriteOptions = { describe: (k) => `scale ${k}`, sleep: async () => {} }
    const made = await ensureFriendsFiles(world.api(PHONE), { vaults: ['yaseen/notes', 'yaseen/cards'], nickname: null }, opts)
    if (made.kind !== 'ok') throw new Error(made.kind)
    const p = await makePointer(world.api(PHONE), made.handle.index.stats!, opts)
    await writeFriendsIndex(world.api(PHONE), made.handle, { ...made.handle.index, friends: [{ name: 'F', theirs: p, mine: p }] })
    const saved: { value: MacSendSaved | null } = { value: null }
    const counter = makeCounter(worker, { scanDir: path.join(dir, 'scan-cache-main') })
    const sender = createMacSender({
      readToken: async () => MAC,
      api: (token) => macGistsApi(token, wire.fetch, () => world.now()),
      profile: (token) => readProfile(token, wire.fetch),
      vaults: async () => new Map([['yaseen/notes', '/open/notes']]),
      count: async () => open,
      state: { load: async () => saved.value, save: async (s) => void (saved.value = structuredClone(s)) },
      clock: { now: () => world.now(), setTimeout: () => 0, clearTimeout: () => undefined },
      sleep: async () => {},
      stats: (text, now, closed, zone) => counter(text, now, closed, zone),
      closed: () => knownClosedVaults([path.join(dir, 'gone'), closedRoot], new Set(), gitFolderFacts(bin!), new Set(['yaseen/cards'])),
    })
    const cpu: number[] = []
    const wall: number[] = []
    for (let i = 0; i < 3; i++) {
      // A new change in the closed vault each run (a new key: the worker scans it), and new numbers (a send).
      await writeFile(path.join(closedRoot, 'Folder 0', `New ${i}.md`), `\`\`\`card\nQ\n\`\`\`\n<!-- card: WIKI-${900_000 + i}, 2026-11-14T14:0${i}Z good 3s -->\n`)
      world.advance(PUBLISH_EVERY_MS + 1)
      const [view, block] = await longestBlock(() => sender.attempt('pass'))
      expect(view.status).toBe('sent')
      cpu.push(block.cpu)
      wall.push(block.wall)
    }
    await sender.stop()
    console.info(`the longest block on main, the whole try, 3 runs: CPU ${cpu.map((c) => c.toFixed(1)).join(', ')} ms; wall ${wall.map((w) => w.toFixed(1)).join(', ')} ms`)
    expect(median(cpu)).toBeLessThan(50)
  }, 300_000)
})

/** The longest time the main thread did not run a 2 ms interval while `work` ran: its CPU time on THIS thread, and its wall time. */
async function longestBlock<T>(work: () => Promise<T>): Promise<[T, { cpu: number; wall: number }]> {
  const cpuNow = () => {
    const u = process.threadCpuUsage()
    return (u.user + u.system) / 1000
  }
  let last = { wall: performance.now(), cpu: cpuNow() }
  const worst = { cpu: 0, wall: 0 }
  const mark = () => {
    const now = { wall: performance.now(), cpu: cpuNow() }
    worst.cpu = Math.max(worst.cpu, now.cpu - last.cpu)
    worst.wall = Math.max(worst.wall, now.wall - last.wall)
    last = now
  }
  const tick = setInterval(mark, 2)
  try {
    const out = await work()
    mark()
    return [out, worst]
  } finally {
    clearInterval(tick)
  }
}
