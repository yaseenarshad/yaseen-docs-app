/**
 * LIVE PROOF of round 5, part 2 (YAZ-5083, the friends list and AutoSync), opt-in, ONCE, right after part 1
 * (`mobile/src/friends/check5/live5.test.ts`): `LIVE_R5=1 OUT=<folder> npx vitest run desktop/src/main/git/live5.test.ts`.
 * A real clone of `yaseenarshad/notecards-scratch-vault` in a temp folder; the Mac changes `.yaseendocs/friends.json` by
 * hand; the "phone" writes the list on GitHub (the shared CAS writer `updateList`, its commit by the git data API); Docs'
 * own `syncPass` runs. Expected: GitHub's bytes at the path, no conflict copy anywhere, and the rest of the vault syncs
 * (one test file under `.yaseendocs/`). Then ONE commit "demo: reset the friends test list" puts the start tree back.
 * The token (`github_pat_…` of `/Users/yasin/Desktop/mochi github app.env`) is read in this process: git gets it by
 * environment variables only (`GIT_CONFIG_*`, an HTTP header), never in a file, a URL, a log or the clone's config.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { listFile } from '@shared/friendGists'
import { handleOf, updateList } from '@shared/friendListHome'
import { LIST_PATH, ListError, readRepoList, type RepoPort } from '@shared/friendListStore'
import { git, resolveGit } from './exec'
import { syncPass } from './sync'

const REPO = 'yaseenarshad/notecards-scratch-vault'
const live = process.env.LIVE_R5 === '1'

it.runIf(live)('round 5 live: a hand edit of the list on the Mac while the phone writes it: GitHub`s bytes, no conflict copy, the vault syncs; then one reset commit', async () => {
  const env = readFileSync('/Users/yasin/Desktop/mochi github app.env', 'utf8')
  const token = (env.match(/github_pat_[A-Za-z0-9_]+/) ?? [])[0]
  if (token === undefined) throw new Error('no token')
  const out: string[] = []
  const say = (line: string) => {
    if (line.includes(token)) throw new Error('a line would hold the token')
    out.push(line)
  }
  const api = async (method: string, p: string, body?: unknown, accept = 'application/vnd.github+json') => {
    const res = await fetch(`https://api.github.com${p}`, { method, headers: { authorization: `Bearer ${token}`, accept, 'x-github-api-version': '2022-11-28', 'user-agent': 'YaseenDocs-test', ...(body !== undefined && { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, text: await res.text() }
  }
  const start = JSON.parse(readFileSync(`${process.env.OUT}/live5-start.json`, 'utf8')) as { head: string; tree: string; branch: string }
  const branch = start.branch
  // The phone's list port (the shared CAS writer runs on it): the git data API, as 3B's commit does.
  const headOf = async () => {
    const r = await api('GET', `/repos/${REPO}/git/ref/heads/${branch}`)
    return { sha: (JSON.parse(r.text) as { object: { sha: string } }).object.sha, etag: null }
  }
  const port: RepoPort = {
    repo: REPO,
    branch,
    async head() {
      const r = await api('GET', `/repos/${REPO}/git/ref/heads/${branch}`)
      return { sha: (JSON.parse(r.text) as { object: { sha: string } }).object.sha, etag: null }
    },
    async read(c, p) {
      const r = await api('GET', `/repos/${REPO}/contents/${p}?ref=${c}`, undefined, 'application/vnd.github.raw+json')
      return r.status === 404 ? null : r.text
    },
    async commit(parent, p, text, message) {
      const base = JSON.parse((await api('GET', `/repos/${REPO}/git/commits/${parent}`)).text) as { tree: { sha: string } }
      const tree = JSON.parse((await api('POST', `/repos/${REPO}/git/trees`, { base_tree: base.tree.sha, tree: [{ path: p, mode: '100644', type: 'blob', content: text }] })).text) as { sha: string }
      const made = JSON.parse((await api('POST', `/repos/${REPO}/git/commits`, { message, tree: tree.sha, parents: [parent] })).text) as { sha: string }
      const moved = await api('PATCH', `/repos/${REPO}/git/refs/heads/${branch}`, { sha: made.sha, force: false })
      if (moved.status === 422) throw new ListError('STALE_HEAD', 'The branch moved')
      if (moved.status !== 200) throw new Error(`ref move ${moved.status}`)
      return made.sha
    },
  }
  const bin = await resolveGit()
  if (bin === null) throw new Error('no git')
  const dir = await mkdtemp(path.join(tmpdir(), 'yd-live5-'))
  const saved = { ...process.env }
  // git reads the header from the environment only (never written to the clone's config).
  Object.assign(process.env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`, GIT_TERMINAL_PROMPT: '0' })
  const testFile = '.yaseendocs/notecards-test-round5.txt'
  try {
    const root = path.join(dir, 'vault')
    expect((await git(bin, dir, ['clone', '-q', '--depth', '20', '--branch', branch, `https://github.com/${REPO}.git`, root], { timeoutMs: 600_000 })).code).toBe(0)
    for (const [k, v] of [['user.name', 'notecards-test'], ['user.email', 'notecards-test@example.invalid'], ['commit.gpgsign', 'false']]) await git(bin, root, ['config', k, v])
    expect(readFileSync(path.join(root, '.git', 'config'), 'utf8').includes(token)).toBe(false)
    const list0 = await readFile(path.join(root, LIST_PATH), 'utf8')
    // The Mac: a hand edit of the list (the friend's name), and a new test file under .yaseendocs/.
    await writeFile(path.join(root, LIST_PATH), list0.replace('notecards-test C', 'notecards-test C by hand on the Mac'))
    await writeFile(path.join(root, testFile), 'round 5 live\n')
    // The phone at the same moment: one more record, by the shared CAS writer.
    const now = await readRepoList(port)
    if (now.kind !== 'ok') throw new Error(`list: ${now.kind}`)
    const phone = await updateList(handleOf({ port, note: null }, now.snap, null), () => ({ patch: { [listFile.shared('ab'.repeat(16))]: JSON.stringify({ v: 1, at: new Date().toISOString() }) }, result: null }), { sleep: async () => {} })
    const phoneText = (await port.read(phone.handle.sha!, LIST_PATH))!
    const status = await syncPass(root)
    const atPath = await readFile(path.join(root, LIST_PATH), 'utf8')
    const head = await headOf()
    const ghList = await port.read(head.sha, LIST_PATH)
    const ghTest = await port.read(head.sha, testFile)
    const tree = JSON.parse((await api('GET', `/repos/${REPO}/git/trees/${head.sha}?recursive=1`)).text) as { tree: { path: string }[] }
    const copies = tree.tree.filter((e) => e.path.startsWith('.yaseendocs/') && /conflict/i.test(e.path)).map((e) => e.path)
    const local = readdirSync(path.join(root, '.yaseendocs')).filter((n) => /conflict/i.test(n))
    say(`Docs syncPass: ${status.state}${'attention' in status && status.attention ? ` (${status.attention})` : ''}; the Mac's list = the phone's: ${atPath === phoneText}; GitHub's list = the phone's: ${ghList === phoneText}; conflict copies on GitHub: ${copies.length}, on the Mac: ${local.length}; the test file reached GitHub: ${ghTest === 'round 5 live\n'}`)
    expect(status.state).toBe('synced')
    expect(atPath).toBe(phoneText)
    expect(ghList).toBe(phoneText)
    expect(copies).toEqual([])
    expect(local).toEqual([])
    expect(ghTest).toBe('round 5 live\n')
  } finally {
    process.env = saved
    // ONE commit puts the start tree back (the list file and the test file go; nothing else changed).
    const head = await headOf()
    if (head.sha !== start.head) {
      const made = JSON.parse((await api('POST', `/repos/${REPO}/git/commits`, { message: 'demo: reset the friends test list', tree: start.tree, parents: [head.sha] })).text) as { sha: string }
      const moved = await api('PATCH', `/repos/${REPO}/git/refs/heads/${branch}`, { sha: made.sha, force: false })
      const endTree = (JSON.parse((await api('GET', `/repos/${REPO}/git/commits/${made.sha}`)).text) as { tree: { sha: string } }).tree.sha
      const between = JSON.parse((await api('GET', `/repos/${REPO}/compare/${start.head}...${made.sha}`)).text) as { files?: { filename: string }[]; total_commits?: number }
      say(`reset: ${moved.status}; the end tree equals the start tree: ${endTree === start.tree}; files changed from start to end: ${(between.files ?? []).length}; commits in this run: ${between.total_commits}`)
      expect(endTree).toBe(start.tree)
    }
    await rm(dir, { recursive: true, force: true })
    expect(existsSync(dir)).toBe(false)
    if (process.env.OUT !== undefined) writeFileSync(`${process.env.OUT}/live5-sync.txt`, `${out.join('\n')}\n`)
    console.log(out.join('\n'))
  }
}, 900_000)
