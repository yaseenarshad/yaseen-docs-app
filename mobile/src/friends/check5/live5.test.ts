/**
 * LIVE PROOF of round 5, part 1 (YAZ-5398), opt-in, ONCE: `LIVE_R5=1 OUT=<folder> npx vitest run -c mobile/vitest.config.ts
 * src/friends/check5/live5.test.ts`. The phone's REAL code (`githubClient`, `listRepo` on 3B's commit, `gistsApi`, the
 * shared remove saga with this device's `ListMemory`) on the real GitHub API:
 * - every branch read right after this device's own write is checked against that write (a stale answer is counted);
 * - a whole remove (tombstone, pointer delete, intent, a new numbers gist, pointer move, proof, done) ends `done` only
 *   from reads at or after this device's writes, and the removed friend's pointer and the old numbers gist are gone.
 * The token comes from `/Users/yasin/Desktop/mochi github app.env` (the `github_pat_…` string), read in this process;
 * never printed or written. Only `yaseenarshad/notecards-scratch-vault` (writes only under `.yaseendocs/`) and test gists
 * ("notecards-test …", at most 15 writes, each deleted and checked by its own read). It never lists the account's gists.
 * It does NOT reset the vault: part 2 (`desktop/src/main/git/live5.test.ts`) runs next and ends with ONE reset commit
 * to the tree this part saw at its start (`OUT/live5-start.json`: a commit and a tree SHA, nothing secret).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, emptyNumbers, listFile, type IndexHandle } from '@shared/friendGists'
import { handleOf } from '@shared/friendListHome'
import { LIST_PATH, createRepoList, listMemory, readRepoList, type RepoPort } from '@shared/friendListStore'
import { removeFriend } from '@shared/friendsList'
import { emptyBudget } from '@shared/friendSend'
import { githubClient, repoPath } from '../../github/client'
import { gistsApi } from '../gistsApi'
import { listRepo } from '../listRepo'

const REPO = 'yaseenarshad/notecards-scratch-vault'
const live = process.env.LIVE_R5 === '1'

it.runIf(live)('round 5 live: reads right after my own writes, and a whole remove that says done only from fresh reads', async () => {
  const env = readFileSync('/Users/yasin/Desktop/mochi github app.env', 'utf8')
  const token = (env.match(/github_pat_[A-Za-z0-9_]+/) ?? [])[0]
  if (token === undefined) throw new Error('no token')
  const out: string[] = []
  const say = (line: string) => {
    if (line.includes(token)) throw new Error('a line would hold the token')
    out.push(line)
  }
  const client = githubClient(token, { fetch: (u, i) => globalThis.fetch(u, i) })
  const meta = (await client.request(repoPath(REPO))).data as { default_branch: string }
  const branch = meta.default_branch
  const raw = listRepo(client, REPO, branch)
  const start = await raw.head()
  if (start === 'unchanged' || start.sha === null) throw new Error('head')
  const startTree = ((await client.request(repoPath(REPO, 'git', 'commits', start.sha))).data as { tree: { sha: string } }).tree.sha
  if (process.env.OUT !== undefined) writeFileSync(`${process.env.OUT}/live5-start.json`, JSON.stringify({ head: start.sha, tree: startTree, branch }))
  say(`start: branch ${branch}; head ${start.sha.slice(0, 7)}; list file: ${(await readRepoList(raw)).kind}`)
  // Every head read is compared with this device's own last write: an older answer is a stale read.
  let mine: string | null = null
  const reads = { all: 0, afterWrite: 0, stale: 0 }
  const port: RepoPort = {
    ...raw,
    repo: raw.repo,
    branch: raw.branch,
    async head(e) {
      const h = await raw.head(e)
      reads.all++
      if (mine !== null && h !== 'unchanged' && h.sha !== null) {
        reads.afterWrite++
        if (h.sha !== mine) {
          const parents = ((await client.request(repoPath(REPO, 'git', 'commits', mine))).data as { parents: { sha: string }[] }).parents.map((p) => p.sha)
          if (parents.includes(h.sha)) reads.stale++
        }
      }
      return h
    },
    read: (c, p) => raw.read(c, p),
    async commit(parent, path, text, msg) {
      const sha = await raw.commit(parent, path, text, msg)
      mine = sha
      return sha
    },
  }
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  const memory = listMemory()
  const opts = { describe: (k: string) => `notecards-test round 5 ${k}`, sleep, now: Date.now, device: 'plive5', memory }
  const api = gistsApi(client)
  const made: string[] = []
  let gistWrites = 0
  const create = async (files: Record<string, string>) => {
    const g = await api.create('notecards-test round 5', files)
    gistWrites++
    made.push(g.id)
    return g.id
  }
  try {
    // 1. Made-up data: my numbers gist, my pointer for "B" (to remove) and for "C" (kept), each naming the numbers.
    const n0 = await create({ [NUMBERS_FILE]: JSON.stringify({ ...emptyNumbers(Date.now()), login: 'notecards-test', name: 'notecards-test' }) })
    const pB = await create({ [POINTER_FILE]: JSON.stringify({ v: 1, stats: n0 }) })
    const pC = await create({ [POINTER_FILE]: JSON.stringify({ v: 1, stats: n0 }) })
    const nobody = '0'.repeat(31) + '1'
    const created = await createRepoList(
      port,
      {
        [INDEX_FILE]: JSON.stringify({ v: 2, nickname: 'notecards-test', vaults: [REPO] }),
        [listFile.gen(0, n0)]: JSON.stringify({ v: 1, stats: n0, covers: [] }),
        [listFile.done(n0)]: '{"v":1}',
        [listFile.friend(pB)]: JSON.stringify({ v: 1, name: 'notecards-test B', theirs: nobody }),
        [listFile.friend(pC)]: JSON.stringify({ v: 1, name: 'notecards-test C', theirs: nobody }),
      },
      'friends (phone): friends.json',
      sleep,
      { memory, now: Date.now, sleep },
    )
    if (created.kind !== 'ok') throw new Error(`create: ${created.kind}`)
    say(`made the list at ${created.snap.sha.slice(0, 7)} (rev ${created.snap.rev})`)
    // 2. A whole remove of B with the phone's code.
    const handle: IndexHandle = handleOf({ port, note: null, guard: { memory, now: Date.now, sleep } }, created.snap, null)
    const r = await removeFriend(api, handle, pB, emptyBudget(), opts)
    const after = await readRepoList(raw)
    if (after.kind !== 'ok') throw new Error(`after: ${after.kind}`)
    const n1 = after.snap.read.value.stats
    const gone = async (id: string) => api.read(id).then(() => false, (e: unknown) => e instanceof Error && (e as { code?: string }).code === 'NOT_FOUND')
    const pCNames = JSON.parse((await api.read(pC).then((g) => (g === 'unchanged' ? null : g.files[POINTER_FILE]?.content))) ?? '{}') as { stats?: string }
    gistWrites += 4 // the remove: a new numbers gist, C's pointer moved, B's pointer and the old numbers gist deleted
    if (n1 !== null) made.push(n1)
    say(`remove: ${r.kind}; list rev ${after.snap.rev}; friends ${JSON.stringify(after.snap.read.value.friends.map((f) => f.name))}; B's pointer gone ${await gone(pB)}; old numbers gone ${await gone(n0)}; C's pointer names the new numbers ${pCNames.stats === n1 && n1 !== n0}`)
    say(`head reads: ${reads.all} (${reads.afterWrite} right after one of my writes); stale answers: ${reads.stale}; my memory: rev ${memory.floor(`${REPO}@${branch}`)?.rev}`)
    expect(r.kind).toBe('done')
    expect(after.snap.read.value.friends.map((f) => f.name)).toEqual(['notecards-test C'])
    expect(await gone(pB)).toBe(true)
    expect(await gone(n0)).toBe(true)
    expect(pCNames.stats).toBe(n1)
    expect(after.snap.read.list.pending).toEqual([])
  } finally {
    for (const g of made) {
      try {
        await api.remove(g)
        gistWrites++
      } catch (e) {
        // Deleted by the remove itself (B's pointer, the old numbers gist).
        if ((e as { code?: string }).code !== 'NOT_FOUND') throw e
      }
    }
    let left = 0
    for (const g of made) if (await api.read(g).then(() => true, () => false)) left++
    say(`gist writes ${gistWrites}; test gists left (each read by its ID): ${left}`)
    if (process.env.OUT !== undefined) writeFileSync(`${process.env.OUT}/live5.txt`, `${out.join('\n')}\n`)
    console.log(out.join('\n'))
    expect(left).toBe(0)
    expect(gistWrites).toBeLessThanOrEqual(15)
  }
}, 300_000)
