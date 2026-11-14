import { cardDueAt } from '@shared/cardSchedule'
import { cardTime } from '@shared/cardLine'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { describe, expect, it, vi } from 'vitest'
import { budgetMs } from '../../../client/src/test-perf'
import { GithubError, githubClient } from '../github/client'
import { fakeGit, fakeGithub } from '../github/testing'
import { memoryBackend, openVaultStore, tokenStoreOn, vaultId, type PhoneVault, type VaultStore } from '../store'
import type { Backend } from '../store/backend'
import { limitedBackend } from '../store/testing'
import { POLL_MS } from '../sync/cadence'
import { isEager } from '../sync/plan'
import { createSyncEngine, type SyncEvent } from '../sync/engine'
import { githubRemote, type GithubRemote } from '../sync/githubRemote'
import { BRANCH, REPO, TOKEN, VAULT, fakeClock } from '../sync/testing'
import { MEDIA_URL_IDLE_CAP, createMediaAhead, type MediaAhead } from './ahead'
import { MEDIA_AHEAD_MAX_BYTES } from './plan'

const START = Date.UTC(2026, 10, 14, 6, 0, 0)
const DAY = 86_400_000
const S = DEFAULT_REVIEW_SETTINGS

/** One card block with its line. */
const block = (id: string, body: string, line: string[] = []) => `\`\`\`card\n${body}\n\`\`\`\n<!-- card: ${[id, ...line].join(', ')} -->`
const page = (title: string, blocks: string[], extra = '') => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${extra}${blocks.join('\n\n')}\n`
/** A review two days ago: due in a few days, inside the window. */
const NEAR = [`${cardTime(START - 2 * DAY)} good`]
/** Reviews that put the next one months away: outside the window. */
const FAR = ['2026-01-05T10:00Z easy', '2026-03-20T10:00Z easy', `${cardTime(START - DAY)} easy`]
const dueOf = (line: string[]) => cardDueAt(line.map((l) => ({ at: l.split(' ')[0], rating: l.split(' ')[1] as 'good' })), S)
const png = (n: number, size = 8) => new Uint8Array(size).fill(n)

/** The bytes the phone holds, counted as `limitedBackend` counts them. */
async function usage(backend: Backend): Promise<number> {
  let n = 0
  for (const v of (await backend.all('files')) as { content: string | Uint8Array }[]) n += typeof v.content === 'string' ? new TextEncoder().encode(v.content).length : v.content.byteLength
  for (const table of ['state', 'checkpoints'] as const) for (const v of await backend.all(table)) n += JSON.stringify(v ?? null).length
  return n
}

const OTHER_REPO = 'yaseen/second-vault'
const OTHER: PhoneVault = { repo: OTHER_REPO, branch: BRANCH, addedAt: 1 }
const MAIN: PhoneVault = { repo: REPO, branch: BRANCH, addedAt: 0 }
const OTHER_ID = vaultId(OTHER)

/** A lock that runs one holder at a time, per name, as `navigator.locks` does; it records who holds it. */
function memoryLock() {
  const tails = new Map<string, Promise<void>>()
  const lock = {
    holders: 0,
    max: 0,
    run: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const before = tails.get(name) ?? Promise.resolve()
      let release!: () => void
      tails.set(name, before.then(() => new Promise<void>((r) => (release = r))))
      await before
      lock.holders++
      lock.max = Math.max(lock.max, lock.holders)
      try {
        return await fn()
      } finally {
        lock.holders--
        release()
      }
    },
  }
  return lock
}

interface Options {
  other?: Record<string, string | Uint8Array>
  /** The phone's room in bytes (`limitedBackend`), asked at each write. */
  limit?: () => number
  /** Called when a pass writes its checkpoint. */
  onCheckpoint?: (vault: string) => void
  /** False: no 3D runner (a test makes its own). */
  runner?: boolean
  /** Runs before each blob download: may wait, or throw. */
  beforeBlob?: (sha: string, background: boolean) => Promise<void> | void
  store?: VaultStore
  parallel?: number
  /** The browser's own `URL.createObjectURL` and `URL.revokeObjectURL` (3D6 counts them). */
  realUrls?: boolean
}

async function setup(files: Record<string, string | Uint8Array>, options: Options = {}) {
  const git = await fakeGit(files, BRANCH)
  const otherGit = await fakeGit(options.other ?? { 'o.md': page('O', []) }, BRANCH)
  const github = fakeGithub({
    tokens: { [TOKEN]: { login: 'yaseen', repos: { [REPO]: 'write', [OTHER_REPO]: 'write' } } },
    repos: [
      { fullName: REPO, git },
      { fullName: OTHER_REPO, git: otherGit },
    ],
  })
  const raw = memoryBackend()
  const backend = options.limit === undefined ? raw : limitedBackend(raw, options.limit)
  const store = options.store ?? (await openVaultStore(backend, { now: () => clock.now() }))
  const tokens = tokenStoreOn(backend)
  await tokens.write(VAULT, TOKEN)
  await tokens.write(OTHER_ID, TOKEN)
  const clock = fakeClock(START)
  const lock = memoryLock()
  const log: string[] = []
  const blobsInFlight = { now: 0, max: 0 }
  // The pass writes through a store session (YAZ-5193): the hook goes on the plain store and on each session.
  const hookCheckpoint = (on: VaultStore) => {
    const checkpointOf = on.setCheckpoint.bind(on)
    on.setCheckpoint = async (vault, cp) => {
      log.push(`checkpoint ${vault}`)
      await checkpointOf(vault, cp)
      options.onCheckpoint?.(vault)
    }
  }
  hookCheckpoint(store)
  const sessionOf = store.session.bind(store)
  store.session = async (scope) => {
    const session = await sessionOf(scope)
    hookCheckpoint(session)
    return session
  }
  const eagerShas = () => {
    const out = new Set<string>()
    for (const g of [git, otherGit]) for (const tree of g.trees.values()) for (const [path, sha] of tree) if (isEager(path)) out.add(sha)
    return out
  }
  const wrap = (remote: GithubRemote, vault: string): GithubRemote => ({
    ...remote,
    async blob(sha) {
      // A picture download: 3D's work (the pass gets only eager files). `locked`: the vault's lock is held meanwhile.
      const background = !eagerShas().has(sha)
      const locked = lock.holders > 0
      blobsInFlight.now++
      blobsInFlight.max = Math.max(blobsInFlight.max, blobsInFlight.now)
      try {
        await options.beforeBlob?.(sha, background)
        const bytes = await remote.blob(sha)
        log.push(`blob ${vault} ${sha.slice(0, 7)}${background ? ' media' : ''}${locked ? ' locked' : ''}`)
        return bytes
      } finally {
        blobsInFlight.now--
      }
    },
  })
  const engine = createSyncEngine({
    store,
    tokens,
    clock,
    lock: lock.run,
    yieldToUi: async () => {},
    makeRemote: (vault, token, onActivity) => wrap(githubRemote(githubClient(token, { fetch: github.fetch, now: clock.now, onActivity }), vault.repo, vault.branch), vaultId(vault)),
  })
  const events: SyncEvent[] = []
  engine.subscribe((e) => events.push(e))
  const urls: string[] = []
  const media: MediaAhead = createMediaAhead({
    engine,
    store,
    clock,
    yieldToUi: async () => {},
    parallel: options.parallel,
    ...(options.realUrls === true
      ? {}
      : {
          makeUrl: (bytes: Uint8Array, type: string) => {
            const url = `blob:test/${urls.length}#${type}#${bytes.byteLength}`
            urls.push(url)
            return url
          },
          revokeUrl: () => {},
        }),
  })
  if (options.runner === false) media.stop()
  const settle = async () => {
    for (let i = 0; i < 5; i++) {
      await engine.idle()
      await media.idle()
    }
  }
  const open = async (vault: PhoneVault = MAIN) => {
    await engine.open(vault)
    await settle()
  }
  const tick = async (ms: number) => {
    clock.advance(ms)
    await settle()
  }
  const shaOf = async (path: string, g = git) => {
    const head = g.branches.get(BRANCH)!
    return g.trees.get(g.commits.get(head)!.tree)!.get(path)!
  }
  const has = async (path: string, vault = VAULT) => (await store.read(vault, path)) !== null
  const pictureBlobs = () => log.filter((l) => l.startsWith('blob') && l.includes(' media')).length
  return { raw, git, otherGit, github, store, tokens, clock, lock, log, engine, media, events, open, tick, settle, shaOf, has, pictureBlobs, blobsInFlight }
}

const DEMO = {
  'world.md': page('World', [block('NC-1', 'Flag of France ![](flags/fr.png)', NEAR), block('NC-2', 'Far ![](flags/far.png)', FAR)]),
  'music.md': page('Music', [block('NC-3', 'A fifth\n---\n![[fifth.mp3]]', NEAR)]),
  '.yaseendocs/review.json': '{"newPerDay":10}',
  'flags/fr.png': png(1),
  'flags/far.png': png(2),
  'fifth.mp3': png(3),
  'unused.png': png(4),
}

describe('3D: media ahead of time (decision 6)', () => {
  it('the test`s reviews: NEAR is due inside 7 days, FAR outside', () => {
    expect(dueOf(NEAR)).toBeLessThan(START + 7 * DAY)
    expect(dueOf(FAR)).toBeGreaterThan(START + 9 * DAY)
  })

  it('after the sync pass, it downloads the media of the cards due in the window, and nothing else', async () => {
    const t = await setup(DEMO)
    await t.open()
    expect(await t.has('flags/fr.png')).toBe(true)
    expect(await t.has('fifth.mp3')).toBe(true)
    expect(await t.has('flags/far.png')).toBe(false)
    expect(await t.has('unused.png')).toBe(false)
    expect(t.media.state()).toMatchObject({ vault: VAULT, done: 2, total: 2, waiting: null })
  })

  it('downloads only after the pass wrote its checkpoint, a few at a time; the lock is NOT held while a download waits on the network (YAZ-5186)', async () => {
    const pics: Record<string, Uint8Array> = {}
    const cards: string[] = []
    for (let i = 0; i < 12; i++) {
      pics[`p/${i}.png`] = png(10 + i)
      cards.push(block(`NC-${10 + i}`, `![](p/${i}.png)`, NEAR))
    }
    const t = await setup({ 'a.md': page('A', cards), ...pics }, { beforeBlob: () => new Promise((r) => setTimeout(r, 1)) })
    await t.open()
    const first = t.log.indexOf(`checkpoint ${VAULT}`)
    const pictures = t.log.map((l, i) => [l, i] as const).filter(([l]) => l.includes(' media'))
    expect(pictures).toHaveLength(12)
    expect(pictures.every(([, i]) => i > first)).toBe(true)
    expect(pictures.filter(([l]) => l.endsWith('locked'))).toEqual([])
    expect(t.lock.max).toBe(1)
    expect(t.blobsInFlight.max).toBeLessThanOrEqual(3)
    expect(t.blobsInFlight.max).toBeGreaterThan(1)
  })

  it('progress for 4A: "pictures 12 of 40" (done of total), told to subscribers as it goes', async () => {
    const pics: Record<string, Uint8Array> = {}
    const cards: string[] = []
    for (let i = 0; i < 40; i++) {
      pics[`p/${i}.png`] = png(i)
      cards.push(block(`NC-${100 + i}`, `![](p/${i}.png)`, NEAR))
    }
    const t = await setup({ 'a.md': page('A', cards), ...pics })
    const seen: string[] = []
    t.media.subscribe((s) => seen.push(`${s.done}/${s.total}`))
    await t.open()
    expect(seen).toContain('12/40')
    expect(seen.at(-1)).toBe('40/40')
  })

  it('the same picture in 20 cards downloads ONCE; a card with 30 pictures gets all 30', async () => {
    const files: Record<string, string | Uint8Array> = { 'shared.png': png(9) }
    const twenty = Array.from({ length: 20 }, (_, i) => block(`NC-${200 + i}`, `Card ${i} ![](shared.png)`, NEAR))
    const thirty = Array.from({ length: 30 }, (_, i) => `![](many/${i}.png)`).join(' ')
    for (let i = 0; i < 30; i++) files[`many/${i}.png`] = png(100 + i)
    const t = await setup({ ...files, 'twenty.md': page('Twenty', twenty), 'thirty.md': page('Thirty', [block('NC-1', thirty, NEAR)]) })
    await t.open()
    expect(t.pictureBlobs()).toBe(31)
    expect(t.media.state()).toMatchObject({ done: 31, total: 31 })
  })

  it('names with spaces, #, % and non-ASCII letters download and show', async () => {
    const t = await setup({
      'a.md': page('A', [block('NC-1', '![](<my pic.png>) ![](a%23b.png) ![](100%.png) ![](café/größe.png)', NEAR)]),
      'my pic.png': png(1),
      'a#b.png': png(2),
      '100%.png': png(3),
      'café/größe.png': png(4),
    })
    await t.open()
    for (const p of ['my pic.png', 'a#b.png', '100%.png', 'café/größe.png']) expect(await t.has(p)).toBe(true)
    const shown = await t.media.showLink('café/gr%C3%B6%C3%9Fe.png', 'a.md')
    expect(shown).toMatchObject({ status: 'ready', path: 'café/größe.png', type: 'image/png' })
  })

  it('a very large file (over MEDIA_AHEAD_MAX_BYTES, 10 MB) is not fetched ahead, also after a restart; it downloads when it shows', async () => {
    const big = new Uint8Array(MEDIA_AHEAD_MAX_BYTES + 1)
    const files = { 'a.md': page('A', [block('NC-1', '![](small.png) ![[talk.mp3]]', NEAR)]), 'small.png': png(1), 'talk.mp3': big }
    const t = await setup(files)
    await t.open()
    expect(await t.has('small.png')).toBe(true)
    expect(await t.has('talk.mp3')).toBe(false)
    expect(t.media.state()).toMatchObject({ done: 1, total: 1, tooLarge: 1 })
    // The next start: the head did not move, so no pass gives sizes; the kept sizes (MEDIA_STATE) still say "too large".
    t.engine.stop()
    t.media.stop()
    const again = await setup(files, { store: t.store })
    await again.open()
    expect(again.media.state()).toMatchObject({ done: 1, total: 1, tooLarge: 1 })
    expect(await again.has('talk.mp3')).toBe(false)
    const shown = await again.media.show('talk.mp3')
    expect(shown).toMatchObject({ status: 'ready', type: 'audio/mpeg', bytes: MEDIA_AHEAD_MAX_BYTES + 1 })
  })

  // YAZ-5186 (3D1): a failure that is not a 404 or a rate limit was fetched again at each pass (41 times in 10 minutes).
  it('a picture that never finishes in time (a slow connection) is not downloaded again at every pass, without end', async () => {
    const files = { 'a.md': page('A', [block('NC-1', '![](slow.png) ![](ok.png)', NEAR)]), 'slow.png': png(9, 64), 'ok.png': png(1) }
    let slowSha = ''
    let tries = 0
    const t = await setup(files, {
      beforeBlob: (sha) => {
        if (sha === slowSha) {
          tries++
          throw new GithubError('OFFLINE', null, 'GitHub did not answer in time') // what the 30 s time limit gives
        }
      },
    })
    slowSha = await t.shaOf('slow.png')
    await t.open()
    expect(await t.has('ok.png')).toBe(true)
    for (let i = 0; i < 40; i++) await t.tick(POLL_MS) // 10 minutes
    expect(t.engine.state().status).toBe('synced')
    expect(tries).toBeLessThanOrEqual(5) // before the fix: 41
    expect(tries).toBeGreaterThan(1) // it does try again later
  })

  it('a 403 (NO_ACCESS) for a picture: it gives up, also after a restart, until the SHA changes or the person opens it', async () => {
    const files = { 'a.md': page('A', [block('NC-1', '![](one.png) ![](two.png)', NEAR)]), 'one.png': png(1), 'two.png': png(2) }
    const t = await setup(files)
    const refusedShas = new Set([await t.shaOf('one.png'), await t.shaOf('two.png')])
    let refused = 0
    const interrupt = (call: { url: string }) => {
      if ([...refusedShas].some((sha) => call.url.includes(`/git/blobs/${sha}`))) {
        refused++
        return new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403, headers: { 'x-ratelimit-remaining': '4999' } })
      }
      return undefined
    }
    t.github.interrupt = interrupt
    await t.open()
    for (let i = 0; i < 40; i++) await t.tick(POLL_MS)
    expect(refused).toBe(2) // one try for each file; before the fix: 41 each
    expect(t.engine.state().status).toBe('synced')
    // The next start: the give-up is kept.
    t.engine.stop()
    t.media.stop()
    const again = await setup(files, { store: t.store })
    again.github.interrupt = interrupt
    await again.open()
    await again.tick(POLL_MS)
    expect(refused).toBe(2)
    // The person opens one.png: it is tried at once, and kept.
    refusedShas.clear()
    const shown = await again.media.show('one.png')
    expect(shown).toMatchObject({ status: 'ready' })
    if (shown.status === 'ready') expect(await shown.kept).toBe(true)
    // two.png gets a new SHA on GitHub: tried again ahead at the next pass.
    await again.git.push({ 'two.png': png(20) })
    await again.tick(POLL_MS)
    expect((await again.store.read(VAULT, 'two.png'))?.content).toEqual(png(20))
  })

  // YAZ-5187 (3D2)
  it('a file over 10 MB is never fetched ahead, also when the app closed before the media round kept the sizes', async () => {
    const big = new Uint8Array(MEDIA_AHEAD_MAX_BYTES + 1)
    const files = { 'a.md': page('A', [block('NC-1', '![](small.png) ![[talk.mp3]]', NEAR)]), 'small.png': png(1), 'talk.mp3': big }
    const t = await setup(files, { runner: false }) // the pass ran; the app closed before the media round
    await t.open()
    t.engine.stop()
    const again = await setup(files, { store: t.store }) // the next start: the head did not move
    await again.open()
    expect(await again.has('small.png')).toBe(true)
    expect(await again.has('talk.mp3')).toBe(false) // before the fix: true
  })

  // YAZ-5188 (3D3)
  it('the first pass of a new session never drops a window file of the open vault', async () => {
    let room = 1_000_000
    let tick = 0
    const raw = memoryBackend()
    const lb = limitedBackend(raw, () => room)
    const base = { 'a.md': page('A', [block('NC-1', '![](w1.png)', NEAR)]), 'w1.png': png(1, 100), 'u.png': png(2, 100), '.yaseendocs/review.json': '{}' }
    const t1 = await setup(base, { store: await openVaultStore(lb, { now: () => ++tick }) })
    await t1.open()
    await t1.media.show('u.png') // viewed after w1.png
    await t1.settle()
    t1.engine.stop()
    t1.media.stop()
    const s2 = await openVaultStore(lb, { now: () => ++tick }) // the next start
    room = (await usage(raw)) + 60
    const dropped: string[] = []
    const write = s2.write.bind(s2)
    s2.write = async (v, p, c) => {
      const r = await write(v, p, c)
      dropped.push(...r.dropped.map((d) => d.path))
      return r
    }
    const t2 = await setup({ ...base, 'b.md': page('B', [], 'x'.repeat(60)) }, { store: s2 })
    await t2.open()
    expect(dropped).not.toContain('w1.png') // before the fix: ['w1.png', …]
    // The room came from u.png (the media no window card needs), by whichever write of the pass needed it first.
    expect(await s2.read(VAULT, 'u.png')).toBeNull()
    expect(await s2.read(VAULT, 'w1.png')).not.toBeNull()
  })

  // The checker's mutation (YAZ-5074 verdict): without the SHA check before a write, no test turned red.
  it('a picture changed on GitHub between two groups of one round: the old bytes are never kept', async () => {
    const pics: Record<string, Uint8Array> = {}
    const cards: string[] = []
    for (let i = 0; i < 30; i++) {
      const n = String(i).padStart(2, '0')
      pics[`p/${n}.png`] = png(i)
      cards.push(block(`NC-${10 + i}`, `![](p/${n}.png)`, NEAR))
    }
    let n = 0
    const holder: { t?: Awaited<ReturnType<typeof setup>> } = {}
    const t = await setup({ 'a.md': page('A', cards), ...pics }, {
      parallel: 1,
      beforeBlob: async (_sha, background) => {
        if (background && ++n === 2) {
          await holder.t!.git.push({ 'p/29.png': png(250) })
          void holder.t!.engine.syncNow()
        }
      },
    })
    holder.t = t
    await t.open()
    await t.settle()
    expect((await t.store.read(VAULT, 'p/29.png'))?.content).toEqual(png(250))
  })

  it('resumes: a closed app picks up where it stopped; a file is stored whole or not at all', async () => {
    const pics: Record<string, Uint8Array> = {}
    const cards: string[] = []
    for (let i = 0; i < 10; i++) {
      pics[`p/${i}.png`] = png(i, 64)
      cards.push(block(`NC-${10 + i}`, `![](p/${i}.png)`, NEAR))
    }
    let fetched = 0
    const t = await setup({ 'a.md': page('A', cards), ...pics }, {
      parallel: 1,
      beforeBlob: (_sha, background) => {
        if (background && ++fetched > 4) throw new GithubError('OFFLINE', null, 'No connection to GitHub') // the app is closed after 4 files
      },
    })
    await t.open()
    const stored = (await t.store.list(VAULT)).filter((e) => e.kind === 'media')
    expect(stored).toHaveLength(4)
    for (const e of stored) expect((await t.store.read(VAULT, e.path))!.content).toHaveLength(64)
    expect(t.media.state().waiting).toBe('offline')
    t.engine.stop()
    t.media.stop()

    // The next start: a new engine and a new runner on the same storage.
    const again = await setup({ 'a.md': page('A', cards), ...pics }, { store: t.store })
    await again.tokens.write(VAULT, TOKEN)
    await again.open()
    expect(again.pictureBlobs()).toBe(6)
    expect(again.media.state()).toMatchObject({ done: 10, total: 10, waiting: null })
  })

  it('R7: a picture changed on GitHub (a new blob SHA) is fetched again at the next pass', async () => {
    const t = await setup(DEMO)
    await t.open()
    await t.git.push({ 'flags/fr.png': png(77) })
    await t.tick(POLL_MS)
    expect((await t.store.read(VAULT, 'flags/fr.png'))!.content).toEqual(png(77))
  })

  it('a card that becomes due within 7 days: its media downloads at the next pass, also when only the day changed (local midnight)', async () => {
    const due = dueOf(FAR)
    const t = await setup(DEMO)
    await t.open()
    expect(await t.has('flags/far.png')).toBe(false)
    // Move the clock to the local day 7 days before FAR's due day, at 23:59, then past midnight.
    const d = new Date(due)
    d.setDate(d.getDate() - 8)
    d.setHours(23, 59, 0, 0)
    await t.tick(d.getTime() - t.clock.now())
    expect(await t.has('flags/far.png')).toBe(false)
    await t.tick(2 * 60_000 + POLL_MS)
    expect(await t.has('flags/far.png')).toBe(true)
  })

  it('errors are quiet: a 404, GitHub`s "slow down" and no signal never change the sync dot; "slow down" waits, a 404 gives up until the file shows', async () => {
    const t = await setup(DEMO)
    const fr = await t.shaOf('flags/fr.png')
    const mp3 = await t.shaOf('fifth.mp3')
    let mode: 'missing' | 'slow' | 'ok' = 'missing'
    t.github.interrupt = (call) => {
      if (mode === 'missing' && call.url.includes(`/git/blobs/${fr}`)) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
      if (mode === 'slow' && call.url.includes(`/git/blobs/${mp3}`))
        return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor((t.clock.now() + 10 * 60_000) / 1000)) } })
      return undefined
    }
    await t.open()
    expect(await t.has('flags/fr.png')).toBe(false) // 404: skipped
    expect(await t.has('fifth.mp3')).toBe(true)
    expect(t.engine.state().status).toBe('synced')

    mode = 'slow'
    await t.store.remove(VAULT, 'fifth.mp3')
    await t.git.push({ 'world.md': `${DEMO['world.md']}\n` }) // a new commit, but fr.png has the same SHA
    await t.tick(POLL_MS)
    expect(t.media.state()).toMatchObject({ waiting: 'slowed' })
    expect(t.media.state().retryAt).toBeGreaterThan(t.clock.now())
    expect(await t.has('flags/fr.png')).toBe(false) // a 404 does not heal by waiting: given up on this SHA (YAZ-5186)
    expect(await t.has('fifth.mp3')).toBe(false)
    expect(t.events.filter((e) => e.type === 'state' && (e.state.status === 'slowed' || e.state.status === 'attention' || e.state.status === 'off'))).toEqual([])
    const blobsWhileWaiting = t.pictureBlobs()
    await t.tick(POLL_MS) // a pass before the reset time: the media waits
    expect(t.pictureBlobs()).toBe(blobsWhileWaiting)
    mode = 'ok'
    await t.tick(10 * 60_000)
    expect(await t.has('fifth.mp3')).toBe(true)
    expect(t.media.state().waiting).toBeNull()
    expect((await t.media.show('flags/fr.png')).status).toBe('ready') // the person opens it: tried at once
  })

  it('no signal in the middle: the media waits quietly and continues after the next pass', async () => {
    let drop = true
    const t = await setup(DEMO, {
      parallel: 1,
      beforeBlob: (_sha, media) => {
        if (drop && media) throw new GithubError('OFFLINE', null, 'No connection to GitHub')
      },
    })
    await t.open()
    expect(t.media.state().waiting).toBe('offline')
    expect(t.engine.state().status).toBe('synced')
    drop = false
    await t.tick(POLL_MS)
    expect(t.media.state()).toMatchObject({ waiting: null, done: 2, total: 2 })
  })

  it('the vault switched in the middle: the old vault`s downloads stop, nothing lands in the wrong vault, the new vault gets its own', async () => {
    const pics: Record<string, Uint8Array> = {}
    const cards: string[] = []
    for (let i = 0; i < 20; i++) {
      pics[`p/${i}.png`] = png(i)
      cards.push(block(`NC-${10 + i}`, `![](p/${i}.png)`, NEAR))
    }
    const gate: { open?: () => void } = {}
    let held = 0
    const t = await setup(
      { 'a.md': page('A', cards), ...pics },
      {
        other: { 'b.md': page('B', [block('NC-1', '![](theirs.png)', NEAR)]), 'theirs.png': png(200) },
        parallel: 1,
        beforeBlob: (_sha, background) => {
          if (background && ++held === 3) return new Promise<void>((r) => (gate.open = r))
        },
      },
    )
    void t.engine.open(MAIN)
    for (let i = 0; i < 200 && gate.open === undefined; i++) await new Promise((r) => setTimeout(r, 1))
    expect(gate.open).toBeDefined()
    const switching = t.engine.open(OTHER)
    gate.open!()
    await switching
    await t.settle()
    const mine = (await t.store.list(VAULT)).filter((e) => e.kind === 'media').length
    expect(mine).toBeLessThanOrEqual(3)
    expect(await t.has('theirs.png', OTHER_ID)).toBe(true)
    expect(await t.has('p/5.png', OTHER_ID)).toBe(false)
    expect(t.media.state()).toMatchObject({ vault: OTHER_ID, done: 1, total: 1 })
  })

  it('the phone full in the middle (night pick): old pictures of OTHER vaults go, oldest first; the open vault`s due files, pages and the answer list never', async () => {
    const pics: Record<string, Uint8Array> = {}
    const cards: string[] = []
    for (let i = 0; i < 6; i++) {
      pics[`p/${i}.png`] = png(i, 100)
      cards.push(block(`NC-${10 + i}`, `![](p/${i}.png)`, NEAR))
    }
    const files = { 'a.md': page('A', cards), ...pics }
    let limit = Number.POSITIVE_INFINITY
    const t = await setup(files, {
      other: { 'b.md': page('B', [block('NC-1', '![](b1.png) ![](b2.png)', NEAR)]), 'b1.png': png(201, 100), 'b2.png': png(202, 100) },
      limit: () => limit,
      // The phone fills up right after vault A's pass: room for about 3 more pictures, with B's 2 that may go.
      onCheckpoint: (vault) => {
        if (vault === VAULT && limit === Number.POSITIVE_INFINITY) void usage(t.raw).then((used) => (limit = used + 350))
      },
    })
    // Vault B was open last week: its pictures are on the phone.
    await t.open(OTHER)
    expect(await t.has('b1.png', OTHER_ID)).toBe(true)
    await t.store.setState(VAULT, 'answers', [{ id: 'NC-10', rating: 'good' }])
    await t.tick(DAY)
    await t.open(MAIN)
    const kept = (await t.store.list(VAULT)).filter((e) => e.kind === 'media').map((e) => e.path)
    expect(await t.has('b1.png', OTHER_ID)).toBe(false) // the oldest of the other vault went first
    expect(kept.length).toBeGreaterThan(0)
    expect(await t.has('a.md')).toBe(true)
    expect(await t.store.getState(VAULT, 'answers')).toEqual([{ id: 'NC-10', rating: 'good' }])
    if (kept.length < 6) expect(t.media.state().waiting).toBe('full')
    // The open vault's due files are protected: an answer-list write that needs room never drops them.
    const before = kept.length
    await t.store.setState(VAULT, 'answers', [{ id: 'NC-10', rating: 'good' }, { id: 'NC-11', rating: 'good' }]).catch(() => undefined)
    expect((await t.store.list(VAULT)).filter((e) => e.kind === 'media')).toHaveLength(before)
    expect(t.engine.state().status).not.toBe('attention')
  })
})

describe('3D: "show this picture" (C1, N3), store first, then the network', () => {
  // YAZ-5200 (3D6): each URL was kept until the vault closed: 500 pictures held 500 blobs.
  it('500 pictures shown, then let go (`releaseUrl`): their object URLs are revoked, except a few recent ones; a URL in use stays', async () => {
    const files: Record<string, string | Uint8Array> = { 'a.md': page('A', []) }
    for (let i = 0; i < 500; i++) files[`p/${i}.png`] = png(i % 256, 32)
    const t = await setup(files, { realUrls: true })
    await t.open()
    const made = vi.spyOn(URL, 'createObjectURL')
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    try {
      const held = await t.media.show('p/0.png') // a picture still on the screen: never let go
      expect(held.status).toBe('ready')
      for (let i = 1; i < 500; i++) {
        const shown = await t.media.show(`p/${i}.png`)
        expect(shown.status).toBe('ready')
        t.media.releaseUrl(`p/${i}.png`)
      }
      expect(made).toHaveBeenCalledTimes(500)
      expect(made.mock.calls.length - revoked.mock.calls.length).toBeLessThanOrEqual(1 + MEDIA_URL_IDLE_CAP)
      expect(revoked.mock.calls.map((c) => c[0])).not.toContain(held.status === 'ready' ? held.url : '')
      expect(t.media.urlNow('p/0.png')).not.toBeNull()
      // A recent one shows again with no new URL; an old one gets a new URL.
      const recent = await t.media.show('p/499.png')
      expect(made).toHaveBeenCalledTimes(500)
      expect(recent.status).toBe('ready')
      await t.media.show('p/1.png')
      expect(made).toHaveBeenCalledTimes(501)
    } finally {
      made.mockRestore()
      revoked.mockRestore()
    }
  })

  it('a stored file shows from storage with no network call, and counts as viewed', async () => {
    const t = await setup(DEMO)
    await t.open()
    await t.tick(60_000)
    const calls = t.github.calls.length
    t.clock.advance(1_000) // no poll is due in this second
    const shown = await t.media.show('flags/fr.png')
    expect(shown).toMatchObject({ status: 'ready', path: 'flags/fr.png', type: 'image/png', bytes: 8 })
    expect(t.github.calls.length).toBe(calls)
    expect((await t.store.list(VAULT)).find((e) => e.path === 'flags/fr.png')!.viewedAt).toBe(t.clock.now())
    expect(t.media.urlNow('flags/fr.png')).toBe(shown.status === 'ready' ? shown.url : null)
  })

  it('C1: a file outside the window downloads the first time it shows, then is kept', async () => {
    const t = await setup(DEMO)
    await t.open()
    const shown = await t.media.show('unused.png')
    expect(shown.status).toBe('ready')
    if (shown.status === 'ready') await shown.kept
    expect(await t.has('unused.png')).toBe(true)
  })

  it('N3: not stored and no signal: a calm "needs a connection" answer, never a throw; the sync dot does not change', async () => {
    const t = await setup(DEMO)
    await t.open()
    t.github.offline = true
    expect(await t.media.show('unused.png')).toEqual({ status: 'missing', path: 'unused.png', why: 'offline' })
    expect(await t.media.show('no/such.png')).toEqual({ status: 'missing', path: 'no/such.png', why: 'not-in-vault' })
    expect(await t.media.showLink('nothing.png', 'world.md')).toEqual({ status: 'missing', path: null, why: 'not-in-vault' })
    expect(t.engine.state().status).toBe('synced')
  })

  it('a link resolves by the shared lookup from the holder file; a PDF has its type for the iPhone`s own viewer (round 12)', async () => {
    const t = await setup({ ...DEMO, 'docs/guide.pdf': png(5) })
    await t.open()
    expect(t.media.resolve('fr.png', 'flags/page.md')).toBe('flags/fr.png')
    const pdf = await t.media.showLink('guide.pdf', 'world.md')
    expect(pdf).toMatchObject({ status: 'ready', path: 'docs/guide.pdf', type: 'application/pdf' })
  })
})

describe('3D: 2,000 files to fetch, no long task on the UI thread', () => {
  // YAZ-5190 (3D5): the hold is the CPU time of 3D's own work between two yields (`process.cpuUsage`), not the wall
  // clock: another process on a busy machine does not count, and a long task of this code always does. No skip.
  it('plans and downloads 2,000 pictures; no slice of its work holds the thread past budgetMs(50); the numbers are printed', async () => {
    const files: Record<string, string | Uint8Array> = { '.yaseendocs/review.json': '{"newPerDay":null}' }
    for (let p = 0; p < 100; p++) {
      const cards = Array.from({ length: 10 }, (_, c) => block(`NC-${p * 10 + c + 1}`, `Q ![](img/${p}-${c}-a.png)\n---\n![](img/${p}-${c}-b.png)`, NEAR))
      files[`pages/p${p}.md`] = page(`Page ${p}`, cards)
      for (let c = 0; c < 10; c++) {
        files[`img/${p}-${c}-a.png`] = png((p + c) % 256, 16)
        files[`img/${p}-${c}-b.png`] = png((p + c + 1) % 256, 16)
      }
    }
    const cpuMs = () => {
      const u = process.cpuUsage()
      return (u.user + u.system) / 1000
    }
    let best = { cpu: Infinity, wall: 0, ms: 0, slices: 0 }
    // Best of up to 3 runs: a GC pause can land in one slice of one run.
    for (let run = 0; run < 3 && (best.cpu >= budgetMs(50) || best.wall >= budgetMs(50)); run++) {
      const t = await setup(files, { runner: false })
      await t.engine.open(MAIN)
      await t.engine.idle()
      const holds: { cpu: number; wall: number }[] = []
      let cpuMark = cpuMs()
      let wallMark = performance.now()
      const slice = () => {
        holds.push({ cpu: cpuMs() - cpuMark, wall: performance.now() - wallMark })
        return new Promise<void>((r) =>
          setTimeout(() => {
            cpuMark = cpuMs()
            wallMark = performance.now()
            r()
          }, 0),
        )
      }
      const runner = createMediaAhead({ engine: t.engine, store: t.store, clock: t.clock, yieldToUi: slice, makeUrl: () => 'blob:x', revokeUrl: () => {} })
      const t0 = performance.now()
      cpuMark = cpuMs()
      wallMark = performance.now()
      await runner.refresh()
      await runner.idle()
      holds.push({ cpu: cpuMs() - cpuMark, wall: performance.now() - wallMark })
      expect(runner.state()).toMatchObject({ done: 2000, total: 2000 })
      const cpu = Math.max(...holds.map((h) => h.cpu))
      const wall = Math.max(...holds.map((h) => h.wall))
      if (Math.max(cpu, wall) < Math.max(best.cpu, best.wall)) best = { cpu, wall, ms: performance.now() - t0, slices: holds.length }
      runner.stop()
      t.engine.stop()
    }
    // The wall clock too: a wait that burns no CPU (a busy loop on a busy machine gets little CPU) still holds the thread.
    // An idle probe as long as the work shows what the machine alone adds; only that skips the wall check.
    const idle = await (async () => {
      let longest = 0
      let last = performance.now()
      const end = last + Math.max(200, best.ms)
      while (performance.now() < end) {
        await new Promise((r) => setTimeout(r, 0))
        const now = performance.now()
        longest = Math.max(longest, now - last)
        last = now
      }
      return longest
    })()
    console.log(`[3D perf] 1,000 cards, 2,000 pictures: ${best.ms.toFixed(0)} ms, ${best.slices} slices; longest slice ${best.cpu.toFixed(1)} ms CPU, ${best.wall.toFixed(1)} ms wall; idle probe ${idle.toFixed(1)} ms`)
    expect(best.cpu).toBeLessThan(budgetMs(50))
    if (idle < budgetMs(50)) expect(best.wall).toBeLessThan(budgetMs(50))
    else console.log('[3D perf] the idle probe alone is over the budget: the wall-clock check is skipped (the CPU check ran)')
  }, 120_000)
})
