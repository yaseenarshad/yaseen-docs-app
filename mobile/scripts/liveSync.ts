/**
 * OPT-IN, NOT A TEST: runs the 3B sync pass for real against the private scratch repo
 * `yaseenarshad/notecards-scratch-vault` (YAZ-5072). It never runs in `npm test`.
 *
 *   npx vite-node --config mobile/vite.config.ts mobile/scripts/liveSync.ts -- "<path to a file that holds the token>"
 *
 * It reads the first `github_pat_…` string of that file and never prints, logs or writes it. It writes ONLY to the
 * scratch repo, and only under `.notecards-test/` (a dot-folder: the Mac's index and sidebar skip it), then deletes
 * what it wrote. Steps: first download, a free poll, a commit, a refresh that downloads it, a stale-head commit that
 * must give STALE_HEAD, the repeat on the new head, and the clean-up.
 */
import { readFileSync } from 'node:fs'
import { GithubError, githubClient } from '../src/github/client'
import { memoryBackend, openVaultStore } from '../src/store'
import { githubRemote } from '../src/sync/githubRemote'
import { INDEX_STATE, type PhoneIndex } from '../src/sync/phoneIndex'
import { syncPass } from '../src/sync/pass'

const REPO = 'yaseenarshad/notecards-scratch-vault'
const BRANCH = 'main'
const VAULT = `${REPO}@${BRANCH}`
const TEST_FILE = '.notecards-test/live.md'

const file = process.argv.slice(2).find((a) => a !== '--')
if (!file) throw new Error('Give the path of the token file')
const token = readFileSync(file, 'utf8').match(/github_pat_[A-Za-z0-9_]+/)?.[0]
if (!token) throw new Error('No github_pat_ token in that file')

const log = (...parts: unknown[]) => console.log(...parts.map((p) => String(p).split(token).join('[token]')))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
let calls = 0
const client = githubClient(token, { fetch: (url, init) => (calls++, fetch(url, init)) })
const remote = githubRemote(client, REPO, BRANCH)
const store = await openVaultStore(memoryBackend())

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const [c0, t0] = [calls, performance.now()]
  try {
    const out = await run()
    log(`${name}: ${(performance.now() - t0).toFixed(0)} ms, ${calls - c0} requests`)
    return out
  } catch (error) {
    if (error instanceof GithubError) log(`${name}: ${error.code} (${error.status}) "${error.said}" after ${(performance.now() - t0).toFixed(0)} ms, ${calls - c0} requests`)
    throw error
  }
}

const head = async () => {
  const h = await remote.head()
  if (h === 'unchanged') throw new Error('unexpected 304')
  return h.sha
}

let lastProgress = ''
const first = await step('1. first download', () => syncPass({ remote, store, vault: VAULT, onProgress: (p) => (lastProgress = `${p.done}/${p.total}`) }))
if (first.kind !== 'synced') throw new Error('expected a first download')
const records = Object.values(first.index.records)
log(`   progress ${lastProgress}; fetched ${first.fetched}; tree ${Object.keys((await store.checkpoint(VAULT))!.shas).length} files; stored ${(await store.list(VAULT)).length}; index ${records.length} records (${records.filter((r) => r.kind === 'card').length} card files, ${records.reduce((n, r) => n + (r.cards?.length ?? 0), 0)} cards, embeds ${records.flatMap((r) => r.embeds).join(' ')})`)
for (const r of records.filter((r) => r.kind === 'card')) log(`   card file ${r.path}: title "${r.title}", card ${r.cards?.[0]?.id}`)

const quiet = await step('2. poll again (expect 304)', () => syncPass({ remote, store, vault: VAULT }))
log(`   result: ${quiet.kind}`)

const h0 = await head()
const c1 = await step('3. commit (text inline, 3 writes + 1 read)', () => remote.commit(h0, [{ path: TEST_FILE, content: `# Live test\n\nWritten by the 3B live script at ${new Date().toISOString()}.\n` }], 'sync (phone): 3B live test'))
log(`   new head ${c1.slice(0, 7)}`)

const refresh = await step('4. refresh after the change', () => syncPass({ remote, store, vault: VAULT }))
log(`   result: ${refresh.kind}${refresh.kind === 'synced' ? `, added ${refresh.diff.added.join(' ')}, changed ${refresh.diff.changed.join(' ')}, fetched ${refresh.fetched}` : ''}`)
log(`   stored copy matches: ${(await store.read(VAULT, TEST_FILE))?.content === (await remote.blob((await store.checkpoint(VAULT))!.shas[TEST_FILE]).then((b) => new TextDecoder().decode(b)))}`)

await wait(1000)
const c2 = await step('5a. commit on the head (moves the branch)', () => remote.commit(c1, [{ path: TEST_FILE, content: '# Live test\n\nSecond write.\n' }], 'sync (phone): 3B live test 2'))
await wait(1000)
try {
  await step('5b. commit on the OLD parent (expect STALE_HEAD)', () => remote.commit(c1, [{ path: TEST_FILE, content: '# Live test\n\nStale write.\n' }], 'sync (phone): 3B stale'))
  log('   NOT REFUSED: unexpected')
} catch (error) {
  if (!(error instanceof GithubError) || error.code !== 'STALE_HEAD') throw error
}
await wait(1000)
const h2 = await head()
log(`   read again: head ${h2.slice(0, 7)} (5a was ${c2.slice(0, 7)})`)
await step('5c. repeat on the new head', () => remote.commit(h2, [{ path: TEST_FILE, content: '# Live test\n\nRepeat after STALE_HEAD.\n' }], 'sync (phone): 3B live test 3'))
await wait(1000)
await step('6. clean up (delete the test file)', async () => remote.commit(await head(), [{ path: TEST_FILE, delete: true }], 'sync (phone): 3B live test clean-up'))
const last = await step('7. refresh after the clean-up', () => syncPass({ remote, store, vault: VAULT }))
log(`   result: ${last.kind}${last.kind === 'synced' ? `, removed ${last.diff.removed.join(' ')}` : ''}; test file stored: ${(await store.read(VAULT, TEST_FILE)) !== null}`)
const index = await store.getState<PhoneIndex>(VAULT, INDEX_STATE)
log(`   index at ${index?.commit.slice(0, 7)}, ${Object.keys(index?.records ?? {}).length} records; total requests ${calls}`)
