/**
 * LIVE PROOF of YAZ-5083 (the list in the vault repo), opt-in, ONCE: `LIVE_5083=1 npx vitest run -c mobile/vitest.config.ts
 * src/friends/check4/live5083.test.ts`. It runs the phone's REAL code (`githubClient`, `listRepo` on 3B's
 * `githubRemote.commit`, the shared `updateList`, the phone's `syncPass`) on the real GitHub API.
 *
 * - The token comes from `/Users/yasin/Desktop/mochi github app.env` (the string that matches `github_pat_…`), read in
 *   this process; it is never printed, never written to a file, a URL, a log or a comment.
 * - It reaches ONLY the demo vault `yaseenarshad/notecards-scratch-vault` and gists it makes itself (description
 *   "notecards-test …", made-up content, at most 20 gist writes, each deleted and checked with a list call). It never
 *   lists or reads another gist's content: it does not run the list's finder, which would find a real list.
 * - Repo writes only under `.yaseendocs/` of the demo vault; at the end ONE commit "demo: reset the friends test list"
 *   puts the file back as it was.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { INDEX_FILE, listFile, readListGist, type IndexHandle } from '@shared/friendGists'
import { handleOf, updateList } from '@shared/friendListHome'
import { LIST_PATH, createRepoList, listErrorCode, noteText, readNote, readRepoList, type RepoPort } from '@shared/friendListStore'
import { githubClient, repoPath } from '../../github/client'
import { memoryBackend, openVaultStore } from '../../store'
import { githubRemote } from '../../sync/githubRemote'
import { isIndexed } from '../../sync/plan'
import { syncPass } from '../../sync/pass'
import { INDEX_STATE, type PhoneIndex } from '../../sync/phoneIndex'
import { kindOnPhone } from '../../store/vaultStore'
import { gistsApi } from '../gistsApi'
import { listRepo } from '../listRepo'

const REPO = 'yaseenarshad/notecards-scratch-vault'
const live = process.env.LIVE_5083 === '1'

it.runIf(live)('YAZ-5083 live: two list commits at once compose (one 422), the file survives the phone\'s sync, the gists are checked and deleted', async () => {
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
  const port = listRepo(client, REPO, branch)
  const before = await readRepoList(port)
  const original = before.kind === 'missing' ? null : await port.read((await port.head() as { sha: string }).sha, LIST_PATH)
  say(`start: branch ${branch}; list file at start: ${before.kind}`)
  const store = { port, note: null }
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  const id = (n: number) => `${'c0ffee'}${n.toString(16).padStart(26, '0')}`
  let gistWrites = 0
  const api = gistsApi(client)
  const made: string[] = []
  try {
    // 1. The list file (made-up entries) in the demo vault, by a compare-and-swap create.
    const files = {
      [INDEX_FILE]: JSON.stringify({ v: 2, nickname: 'notecards-test', vaults: [REPO] }),
      [listFile.gen(0, id(1))]: JSON.stringify({ v: 1, stats: id(1), covers: [] }),
      [listFile.done(id(1))]: '{"v":1}',
    }
    const created = await createRepoList(port, files, 'friends (phone): friends.json', sleep)
    if (created.kind !== 'ok') throw new Error(`create: ${created.kind}`)
    say(`made the list file at ${created.snap.sha.slice(0, 7)}`)

    // 2. Two devices read the SAME copy, then each adds its own friend at the same moment.
    const stale: string[] = []
    const watched = (name: string): RepoPort => ({
      ...port,
      repo: port.repo,
      branch: port.branch,
      head: (e) => port.head(e),
      read: (c, p) => port.read(c, p),
      commit: async (parent, path, text, msg) => {
        try {
          return await port.commit(parent, path, text, msg)
        } catch (err) {
          if (listErrorCode(err) === 'STALE_HEAD') stale.push(`${name}: GitHub refused the ref move (422 "Update is not a fast forward")`)
          throw err
        }
      },
    })
    const h1: IndexHandle = handleOf({ port: watched('device 1'), note: null }, created.snap, null)
    const h2: IndexHandle = handleOf({ port: watched('device 2'), note: null }, created.snap, null)
    const add = (n: number) => (cur: IndexHandle) => ({ patch: { [listFile.friend(id(10 + n))]: JSON.stringify({ v: 1, name: `notecards-test ${n}`, theirs: id(20 + n) }) }, result: n })
    const [a, b] = await Promise.all([updateList(h1, add(1), { sleep }), updateList(h2, add(2), { sleep })])
    void a
    void b
    const after = await readRepoList(port)
    if (after.kind !== 'ok') throw new Error(`after: ${after.kind}`)
    const names = after.snap.read.value.friends.map((f) => f.name).sort()
    say(`two writes at once: refusals ${JSON.stringify(stale)}; the list now holds ${JSON.stringify(names)}`)
    expect(stale.length).toBeGreaterThanOrEqual(1)
    expect(names).toEqual(['notecards-test 1', 'notecards-test 2'])

    // 3. The phone's sync pass over the vault: the file is stored as a settings file, never indexed as a page or card.
    const vstore = await openVaultStore(memoryBackend())
    const vault = `${REPO}@${branch}`
    const pass = await syncPass({ remote: githubRemote(client, REPO, branch), store: vstore, vault })
    const index = await vstore.getState<PhoneIndex>(vault, INDEX_STATE)
    const stored = await vstore.read(vault, LIST_PATH)
    say(`phone sync pass: ${pass.kind}; stored ${stored === null ? 'no' : 'yes'} (${kindOnPhone(LIST_PATH)}); in the index: ${index !== undefined && LIST_PATH in index.records}; isIndexed: ${isIndexed(LIST_PATH)}`)
    expect(pass.kind).toBe('synced')
    expect(index !== undefined && LIST_PATH in index.records).toBe(false)
    expect(isIndexed(LIST_PATH)).toBe(false)
    expect(kindOnPhone(LIST_PATH)).toBe('settings')
    expect(typeof stored?.content === 'string' ? stored.content : '').toContain('notecards-test 2')

    // 4. Gists (test gists only): the note names only the vault; a gist of more than 300 files is read as cut.
    const note = await api.create('notecards-test note', { [INDEX_FILE]: noteText(REPO) })
    gistWrites++
    made.push(note.id)
    const noteBack = await api.read(note.id)
    if (noteBack === 'unchanged') throw new Error('note')
    say(`note gist: ${JSON.stringify(readNote(noteBack.files[INDEX_FILE]?.content))}`)
    expect(readNote(noteBack.files[INDEX_FILE]?.content)).toEqual({ kind: 'note', home: REPO })
    const big: Record<string, string> = { [INDEX_FILE]: JSON.stringify({ v: 2, nickname: null, vaults: [] }) }
    for (let i = 0; i < 305; i++) big[listFile.tomb(id(100 + i), 'fe')] = '{"v":1,"kinds":["shared"],"rekey":false,"at":""}'
    const cut = await api.create('notecards-test 305 files', big)
    gistWrites++
    made.push(cut.id)
    const cutBack = await api.read(cut.id)
    if (cutBack === 'unchanged') throw new Error('cut')
    say(`a gist of 306 files: GitHub gave ${Object.keys(cutBack.files).length} files, truncated ${cutBack.truncated === true}; the app reads it as ${readListGist(cutBack).kind}`)
    expect(cutBack.truncated).toBe(true)
    expect(readListGist(cutBack).kind).toBe('unreadable')
  } finally {
    for (const g of made) {
      await api.remove(g)
      gistWrites++
    }
    const left = (await api.list()).filter((g) => made.includes(g.id))
    say(`gist writes ${gistWrites}; test gists left after the deletes (list call): ${left.length}`)
    // 5. The demo vault as it was: ONE commit.
    const now = await port.head()
    if (now !== 'unchanged') {
      const text = await port.read(now.sha, LIST_PATH)
      if (text !== original) await port.commit(now.sha, LIST_PATH, original, 'demo: reset the friends test list')
    }
    const end = await readRepoList(port)
    say(`demo vault at the end: list file ${end.kind}`)
    if (process.env.OUT !== undefined) writeFileSync(`${process.env.OUT}/live5083.txt`, `${out.join('\n')}\n`)
    console.log(out.join('\n'))
    expect(left).toEqual([])
    expect(gistWrites).toBeLessThanOrEqual(20)
  }
}, 300_000)
