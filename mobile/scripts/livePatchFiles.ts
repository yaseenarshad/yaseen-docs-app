/**
 * OPT-IN, NOT A TEST (YAZ-5312): proves on GitHub that a gist PATCH changes ONLY the files it names, the fact that the
 * version 2 friends list (one file per entry, in the same gist) stands on. It never runs in `npm test`.
 *
 *   npx vite-node --config mobile/vite.config.ts mobile/scripts/livePatchFiles.ts -- "<path to a file that holds the token>"
 *
 * It reads the first `github_pat_…` string of that file and never prints, logs or writes it. It makes ONE secret gist
 * whose description starts with "notecards-test", with made-up text only. At most 20 gist writes in all (it uses 9 or 10).
 * It deletes the gist at the end and checks that with a list call.
 *
 * Steps: make the gist (head, a, b); device 1 writes `a` only; device 2, from its stale copy of the first read, writes
 * `b` only; a new file `c`; delete `b` with null; two writes AT ONCE on different files (`d` and `e`). After each, a
 * fresh read checks every file: each named file has the new text, and each other file is exactly as it was.
 *
 * Found in the first run: two PATCHes of one gist at the same moment can get 409 for one of them (the whole write
 * refused, nothing of it kept). `gistsApi.update` sends such a write again (step 6 counts the 409s).
 */
import { readFileSync } from 'node:fs'
import { GithubError, githubClient } from '../src/github/client'
import { gistsApi } from '../src/friends/gistsApi'
import type { GistDoc } from '@shared/friendGists'

const MAX_WRITES = 20
const PREFIX = 'notecards-test'

const file = process.argv.slice(2).find((a) => a !== '--')
if (!file) throw new Error('Give the path of the token file')
const token = readFileSync(file, 'utf8').match(/github_pat_[A-Za-z0-9_]+/)?.[0]
if (!token) throw new Error('No github_pat_ token in that file')

const log = (...parts: unknown[]) => console.log(...parts.map((p) => String(typeof p === 'object' ? JSON.stringify(p) : p).split(token).join('[token]')))
const made = new Set<string>()
let writes = 0
let conflicts = 0
const client = githubClient(token, {
  fetch: async (url, init) => {
    const method = (init.method ?? 'GET').toUpperCase()
    if (method !== 'GET') {
      if (writes >= MAX_WRITES) throw new Error(`live script: write budget reached (${writes})`)
      writes++
    }
    const res = await fetch(url, init)
    if (res.status === 409) conflicts++
    if (method === 'POST' && res.status === 201) made.add(((await res.clone().json()) as { id: string }).id)
    return res
  },
})
const api = gistsApi(client)

const textOf = (g: GistDoc) => Object.fromEntries(Object.entries(g.files).map(([n, f]) => [n, f.content]))
let failed = 0
async function check(name: string, id: string, want: Record<string, string>) {
  const g = await api.read(id)
  if (g === 'unchanged') throw new Error('no read')
  const got = textOf(g)
  const ok = JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(want).sort())
  if (!ok) failed++
  log(`${ok ? 'ok  ' : 'FAIL'} ${name}: files ${Object.keys(got).sort().join(', ')}${ok ? '' : ` (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`}`)
}

try {
  const want: Record<string, string> = { 'notecards-test.head.json': '{"v":2,"test":true}', 'notecards-test.a.json': '{"a":1}', 'notecards-test.b.json': '{"b":1}' }
  const g = await api.create(`${PREFIX} YAZ-5312 live proof: a PATCH changes only the files it names (made-up text)`, want)
  await check('1. made with head, a, b', g.id, want)
  const stale = await api.read(g.id) // device 2's copy, read before device 1 writes
  await api.update(g.id, { 'notecards-test.a.json': '{"a":2}' })
  want['notecards-test.a.json'] = '{"a":2}'
  await check('2. device 1 writes a only', g.id, want)
  if (stale === 'unchanged') throw new Error('no read')
  await api.update(g.id, { 'notecards-test.b.json': '{"b":2,"from":"a stale copy"}' })
  want['notecards-test.b.json'] = '{"b":2,"from":"a stale copy"}'
  await check('3. device 2 (stale copy) writes b only: a keeps device 1`s text', g.id, want)
  await api.update(g.id, { 'notecards-test.c.json': '{"c":1}' })
  want['notecards-test.c.json'] = '{"c":1}'
  await check('4. a new file c: the others stay', g.id, want)
  await api.update(g.id, { 'notecards-test.b.json': null })
  delete want['notecards-test.b.json']
  await check('5. b deleted with null: only b goes', g.id, want)
  await Promise.all([api.update(g.id, { 'notecards-test.d.json': '{"d":1}' }), api.update(g.id, { 'notecards-test.e.json': '{"e":1}' })])
  want['notecards-test.d.json'] = '{"d":1}'
  want['notecards-test.e.json'] = '{"e":1}'
  await check(`6. two writes at once on different files: both stay (GitHub refused ${conflicts} with 409; the app sent it again)`, g.id, want)
} catch (error) {
  failed++
  log(`stopped: ${error instanceof GithubError ? `${error.code} (${error.status})` : error instanceof Error ? error.message : 'error'}`)
} finally {
  const left0 = (await api.list()).filter((g) => made.has(g.id) || g.description.startsWith(PREFIX))
  for (const g of left0) {
    try {
      await api.remove(g.id)
    } catch (error) {
      if (!(error instanceof GithubError && error.code === 'NOT_FOUND')) log(`clean-up of ${g.id.slice(0, 8)}… failed`)
    }
  }
  const left = (await api.list()).filter((g) => made.has(g.id) || g.description.startsWith(PREFIX))
  log(`clean-up: made ${made.size} gist; deleted ${left0.length}; left after the clean-up (list call): ${left.length}; gist writes in all: ${writes} (limit ${MAX_WRITES})`)
  if (left.length > 0 || failed > 0) process.exitCode = 1
}
