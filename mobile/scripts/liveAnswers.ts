/**
 * OPT-IN, NOT A TEST: runs the 3C send of the answer list (YAZ-5073) for real against the private scratch repo
 * `yaseenarshad/notecards-scratch-vault`. It never runs in `npm test`.
 *
 *   npx vite-node --config mobile/vite.config.ts mobile/scripts/liveAnswers.ts -- "<path to a file that holds the token>"
 *
 * It reads the first `github_pat_…` string of that file and never prints, logs or writes it. It writes ONLY to the
 * scratch repo, and only under `.notecards-test/`, then deletes what it wrote. A dot-folder is not in the phone's index
 * (as on the Mac), so the script's pass adds the test card file's record to the index after each real pass: the send
 * then finds the card by ID as it finds any card. Steps: a test card file; four actions in ONE commit; the same answer
 * again (no write); a Mac commit between the pass and the commit (STALE_HEAD, then the repeat); a lost action; clean-up.
 */
import { readFileSync } from 'node:fs'
import { GithubError, githubClient } from '../src/github/client'
import { memoryBackend, openVaultStore } from '../src/store'
import { openOutbox } from '../src/answers/outbox'
import type { CardOp } from '../src/answers/ops'
import { sendOutbox, type SendReport } from '../src/answers/send'
import { githubRemote, type GithubRemote } from '../src/sync/githubRemote'
import { syncPass } from '../src/sync/pass'
import { INDEX_STATE, phoneRecord, type PhoneIndex } from '../src/sync/phoneIndex'

const REPO = 'yaseenarshad/notecards-scratch-vault'
const BRANCH = 'main'
const VAULT = `${REPO}@${BRANCH}`
const CARD_FILE = '.notecards-test/live-answers-nct-1.md'
const MAC_FILE = '.notecards-test/live-answers-mac.md'
const ID = 'NCT-1'

const file = process.argv.slice(2).find((a) => a !== '--')
if (!file) throw new Error('Give the path of the token file')
const token = readFileSync(file, 'utf8').match(/github_pat_[A-Za-z0-9_]+/)?.[0]
if (!token) throw new Error('No github_pat_ token in that file')

const log = (...parts: unknown[]) => console.log(...parts.map((p) => String(p).split(token).join('[token]')))
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
let calls = 0
let writes = 0
const client = githubClient(token, {
  fetch: (url, init) => {
    calls++
    if ((init.method ?? 'GET') !== 'GET') writes++
    return fetch(url, init)
  },
})
const remote = githubRemote(client, REPO, BRANCH)
const store = await openVaultStore(memoryBackend())
const box = await openOutbox(store, VAULT)

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  const [c0, w0, t0] = [calls, writes, performance.now()]
  try {
    const out = await run()
    log(`${name}: ${(performance.now() - t0).toFixed(0)} ms, ${calls - c0} requests (${writes - w0} writes)`)
    return out
  } catch (error) {
    if (error instanceof GithubError) log(`${name}: ${error.code} (${error.status}) "${error.said}" after ${(performance.now() - t0).toFixed(0)} ms`)
    throw error
  }
}
/** A real pass, then the test card file's record in the index (a dot-folder is not indexed). */
async function pass() {
  const result = await syncPass({ remote, store, vault: VAULT })
  const index = (await store.getState<PhoneIndex>(VAULT, INDEX_STATE))!
  const stored = await store.read(VAULT, CARD_FILE)
  if (stored !== null && typeof stored.content === 'string') {
    index.records[CARD_FILE] = phoneRecord(CARD_FILE, stored.size, stored.content, { ctime: 0, mtime: 0 })
    await store.setState(VAULT, INDEX_STATE, index)
  }
  return result
}
const send = (r: GithubRemote = remote) => sendOutbox({ remote: r, store, vault: VAULT, outbox: box, pass })
const show = (r: SendReport) => log(`   ${r.result}: sent ${r.sent}, lost ${r.lost}, stale heads ${r.staleHeads}, files ${r.files.join(' ') || '-'}, commit ${r.commit?.slice(0, 7) ?? '-'}`)
const remoteLine = async () => {
  const h = await remote.head()
  if (h === 'unchanged') throw new Error('unexpected 304')
  const tree = await remote.tree(h.sha)
  const text = new TextDecoder().decode(await remote.blob(tree.get(CARD_FILE)!))
  return text.split('\n').find((l) => l.startsWith('<!-- card:'))
}
const add = (...ops: CardOp[]) => box.add(ops.map((op) => ({ op, path: CARD_FILE, title: 'Live test card' })), Date.now())
const minute = (n: number) => `${new Date(Date.now() + n * 60_000).toISOString().slice(0, 16)}Z`

await step('1. first download', pass)
const h0 = (await store.checkpoint(VAULT))!.commit
await step('2. a test card file (direct commit)', () =>
  remote.commit(h0, [{ path: CARD_FILE, content: `---\nkind: card\ntitle: Live test card\n---\n\n\`\`\`card\nLive test card\n---\nWritten by the 3C live script\n\`\`\`\n<!-- card: ${ID} -->\n` }], 'sync (phone): 3C live test card'),
)
await wait(1000)
const r1 = minute(0)
await add({ kind: 'next', id: ID, on: true }, { kind: 'review', id: ID, review: { at: r1, rating: 'good', seconds: 12 } }, { kind: 'fix', id: ID, on: true }, { kind: 'off', id: ID, on: true })
show(await step('3. four actions: ONE commit', () => send()))
log(`   GitHub's line: ${await remoteLine()}`)

await wait(1000)
await add({ kind: 'review', id: ID, review: { at: r1, rating: 'good', seconds: 12 } })
show(await step('4. the same answer again (expect no write)', () => send()))

await wait(1000)
let macDone = false
const racing: GithubRemote = {
  ...remote,
  async commit(parent, changes, message) {
    if (!macDone) {
      macDone = true
      await remote.commit(parent, [{ path: MAC_FILE, content: '# A Mac commit\n' }], 'sync (mac): 3C live test')
      log('   (a "Mac" commit moved the branch between the pass and the commit)')
    }
    return remote.commit(parent, changes, message)
  },
}
await add({ kind: 'review', id: ID, review: { at: minute(1), rating: 'again' } })
show(await step('5. a moved branch: STALE_HEAD, read again, repeat', () => send(racing)))
log(`   GitHub's line: ${await remoteLine()}`)

await wait(1000)
// YAZ-5180: Undo while the send is on its way. The review host does this: `removeGroup` (refused once the send has
// tried the action), then an `unreview` that names the review. The next send must take the review off GitHub.
const undone = { at: minute(3), rating: 'hard' as const }
const group = await add({ kind: 'review', id: ID, review: undone })
let removed: number | null = null
const undoDuringSend: GithubRemote = {
  ...remote,
  async commit(parent, changes, message) {
    removed = (await box.removeGroup(group)).length // the person taps Undo now
    if (removed === 0) await add({ kind: 'unreview', id: ID, at: undone.at, rating: undone.rating })
    return remote.commit(parent, changes, message)
  },
}
show(await step('5b. Undo while the send is on its way (YAZ-5180)', () => send(undoDuringSend)))
log(`   Undo removed ${removed} actions from the list (0: the send had tried them, so it sent an unreview); waiting now ${box.waiting().map((w) => w.op.kind).join(' ')}`)
log(`   GitHub's line after the send: ${await remoteLine()}`)
await wait(1000)
show(await step('5c. the next send (the unreview)', () => send()))
log(`   GitHub's line: ${await remoteLine()}`)

await wait(1000)
await add({ kind: 'review', id: 'NCT-404', review: { at: minute(2), rating: 'good' } })
show(await step('6. a card that is gone (expect lost, no write)', () => send()))
log(`   lost list: ${box.lost().map((l) => `${l.op.kind} ${l.op.id} "${l.title}"`).join('; ')}`)

await wait(1000)
await step('7. clean up (delete the test files)', async () => {
  const h = await remote.head()
  if (h === 'unchanged') throw new Error('unexpected 304')
  return remote.commit(h.sha, [{ path: CARD_FILE, delete: true }, { path: MAC_FILE, delete: true }], 'sync (phone): 3C live test clean-up')
})
const h = await remote.head()
const left = h === 'unchanged' ? [] : [...(await remote.tree(h.sha)).keys()].filter((p) => p.startsWith('.notecards-test/'))
log(`   files left under .notecards-test/: ${left.length}; total requests ${calls} (${writes} writes)`)
