import { expect, it } from 'vitest'
import { fakeGistWorld } from '@shared/friendGistsFake'
import { LIST_PATH, listErrorCode, readRepoList } from '@shared/friendListStore'
import { macRepoPort } from './repoHttp'
import { worldFetch } from './testing'

/** YAZ-5399 and YAZ-5398 (round 5): the Mac's read-only list port on a renamed repo, a deleted repo, and a replica that lags. */
const T = 'mac-token'
function setup() {
  const w = fakeGistWorld({ accounts: { [T]: { login: 'ali' } }, start: Date.parse('2026-11-14T08:00:00Z') })
  w.repos!.create('ali/vault', 'ali', { [LIST_PATH]: '{"v":1,"about":"x","rev":3,"head":{"v":2,"nickname":null,"vaults":["ali/vault"]},"records":{}}\n' })
  return { w, wire: worldFetch(w) }
}

it('a RENAMED repo: GitHub`s 301 to api.github.com is followed (with the token), and the port says the new name', async () => {
  const { w, wire } = setup()
  w.repos!.rename('ali/vault', 'ali/vault-new')
  const port = macRepoPort(T, wire.fetch, 'ali/vault', 'main')
  const read = await readRepoList(port)
  expect(read.kind).toBe('ok')
  expect(await port.canonical!()).toBe('ali/vault-new')
  expect(wire.requests.some((r) => r.url.includes('/repositories/'))).toBe(true)
  for (const r of wire.requests) expect(new URL(r.url).origin).toBe('https://api.github.com')
})

it('a redirect to ANOTHER host is never followed: the token never leaves GitHub`s API', async () => {
  const seen: string[] = []
  const fetch = async (url: string) => {
    seen.push(url)
    return new Response(JSON.stringify({ message: 'Moved' }), { status: 301, headers: { location: 'https://evil.example/repos/ali/vault/git/ref/heads/main' } })
  }
  const port = macRepoPort(T, fetch as never, 'ali/vault', 'main')
  await expect(port.head()).rejects.toThrow()
  expect(seen).toEqual(['https://api.github.com/repos/ali/vault/git/ref/heads/main'])
})

it('a DELETED repo: 404 is NO_LIST_ACCESS marked `gone` (the phone then offers the way out; the Mac sends nothing)', async () => {
  const { w, wire } = setup()
  w.repos!.remove('ali/vault')
  const err = await macRepoPort(T, wire.fetch, 'ali/vault', 'main').head().catch((e: unknown) => e)
  expect(listErrorCode(err)).toBe('NO_LIST_ACCESS')
  expect((err as { gone?: boolean }).gone).toBe(true)
})

it('`contents` 404 "No commit found" (a replica that lags) is STALE_READ, never a missing list', async () => {
  const { w, wire } = setup()
  const port = macRepoPort(T, wire.fetch, 'ali/vault', 'main')
  const head = await port.head()
  if (head === 'unchanged' || head.sha === null) throw new Error('no head')
  w.repos!.stale = { chance: 0, contents404: 1, rand: () => 0 }
  expect(listErrorCode(await port.read(head.sha, LIST_PATH).catch((e: unknown) => e))).toBe('STALE_READ')
  w.repos!.stale = null
  expect(await port.read(head.sha, LIST_PATH)).toMatch(/"rev":3/)
  expect(await port.read(head.sha, '.yaseendocs/none.json')).toBeNull()
})

it('YAZ-5464: a repo made again EMPTY (409 "Git Repository is empty"): no list file (missing), never an error; another 409 stays one', async () => {
  const { w, wire } = setup()
  w.repos!.remove('ali/vault')
  w.repos!.createEmpty('ali/vault', 'ali')
  const port = macRepoPort(T, wire.fetch, 'ali/vault', 'main')
  expect(await port.head()).toEqual({ sha: null, etag: null })
  expect(await readRepoList(port)).toEqual({ kind: 'missing', sha: null, etag: null })
  const other = async () => new Response(JSON.stringify({ message: 'Repository rule violations found' }), { status: 409, headers: { 'content-type': 'application/json' } })
  await expect(macRepoPort(T, other as never, 'ali/vault', 'main').head()).rejects.toThrow(/409/)
})
