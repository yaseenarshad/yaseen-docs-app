/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it } from 'vitest'
import { INDEX_FILE, NUMBERS_FILE, POINTER_FILE, emptyNumbers, isListFile, readListFiles } from '@shared/friendGists'
import { LIST_CUT } from '@shared/friendsList'
import { LIST_PATH } from '@shared/friendListStore'
import { noRealWaits } from '../check4/run4.testing'
import { Model5 } from './model5.testing'

noRealWaits()
const K0 = { pStale: 0, p502: 0, pSecondary: 0, pContents404: 0 }

it('M1: a v1 list (old app: C paired, 3 shared links, B paired, a remove waiting) moved by TWO new phones at the same moment: nothing readable is dropped', async () => {
  const m = new Model5(9191, K0)
  m.hookRepos()
  await m.setup4(2, 1, 1, false, false, true)
  // More old-app state: shares, a paste of B, then a remove started by the old app that waits (offline after its first write).
  for (const op of ['share', 'share', 'share']) await m.oldOp(op)
  const b = m.devs.B[0] as any
  const share = await b.list.share()
  m.give('B', 'A', share.link.split('#')[1])
  await m.oldOp('paste')
  const before = m.world.owned('ali').find((g) => INDEX_FILE in g.files)!
  const oldHead = JSON.parse(before.files[INDEX_FILE]) as { v: number; friends: { mine: string }[]; shared?: { mine: string }[]; groups: { mine: string }[] }
  const oldMines = new Set([...oldHead.friends.map((f) => f.mine), ...(oldHead.shared ?? []).map((s) => s.mine), ...oldHead.groups.map((g) => g.mine)])
  const [a0, a1] = m.devs.A as any[]
  const [r0, r1] = await Promise.all([a0.list.rows(), a1.list.rows()])
  const text = m.world.repos!.file('ali/vault', LIST_PATH)
  const read = text === null ? null : readListFiles(JSON.parse(JSON.stringify(m.repoFiles('ali', null))))
  const live = read !== null && read.kind === 'ok' ? new Set([...read.value.friends.map((f) => f.mine), ...(read.value.shared ?? []).map((s) => s.mine), ...read.value.groups.map((g) => g.mine)]) : new Set<string>()
  const lost = [...oldMines].filter((x) => !live.has(x))
  const notes = m.world.owned('ali').filter((g) => INDEX_FILE in g.files)
  const leftFiles = notes.flatMap((g) => Object.keys(g.files).filter((n) => n !== INDEX_FILE && isListFile(n)))
  console.log('MIGRATE', JSON.stringify({ oldV: oldHead.v, oldEntries: oldMines.size, r0: r0.kind, r1: r1.kind, movedEntries: live.size, lost, notes: notes.map((g) => JSON.parse(g.files[INDEX_FILE]).v), oldFilesLeft: leftFiles.length, commits: m.world.repos!.parents('ali/vault', m.world.repos!.head('ali/vault')!).length }))
  expect(lost).toEqual([])
  expect(notes.length).toBe(1)
})

// CHECKER round 5 (YAZ-5400), with the fix of the builder of the round 5 fixes: the checker's versions (301 files) failed
// with `{"rows":"ok","gistFiles":301,"repoList":false}` (M2) and `{"listCallNamesHead":false,…,"share":"ok",
// "friendsInNewList":0,…}` (M3): the app took the cut list for "no list" and started a new, empty one. Now 306 files.
const T_ALI = `github_pat_11CHECK3_${'ali'.padEnd(70, '0')}`
async function cutList(seed: number, n: number) {
  const m = new Model5(seed, K0)
  m.hookRepos()
  m.devs.A.push(await m.device('A', 0))
  m.devs.B.push(await m.device('B', 0))
  // A's pointers for its old friends exist (each friend reads A's numbers through one).
  const numbers = m.world.seed('ali', { [NUMBERS_FILE]: JSON.stringify({ ...emptyNumbers(Date.parse('2026-11-14T08:00:00Z')), login: 'ali', name: 'Ali' }) })
  const files: Record<string, string> = { [INDEX_FILE]: JSON.stringify({ v: 2, nickname: null, vaults: ['ali/vault'] }) }
  const pointers: string[] = []
  for (let i = 0; i < n; i++) {
    const p = m.world.seed('ali', { [POINTER_FILE]: JSON.stringify({ v: 1, stats: numbers }) })
    pointers.push(p)
    files[`notecards-friends.f.${p}.json`] = JSON.stringify({ v: 1, name: `F${i}`, theirs: 'b'.repeat(32) })
  }
  files[`notecards-friends.n.0-${numbers}.json`] = JSON.stringify({ v: 1, stats: numbers, covers: [] })
  const id = m.world.seed('ali', files)
  return { m, id, numbers, pointers, a: m.devs.A[0] as any }
}

it('M2: a v2 list of 306 files (GitHub cuts it at 300): not moved, nothing written, no new list; plain words and the way out', async () => {
  const { m, id, a } = await cutList(9292, 304)
  const listed = await m.world.http('GET', '/gists', new URLSearchParams({ per_page: '100' }), T_ALI, undefined, null, null)
  const item = (listed!.body as any[]).find((g) => g.id === id)
  // As GitHub (proved live in round 5): the list call names 300 files, and not the head.
  expect(Object.keys(item.files).length).toBe(300)
  expect(INDEX_FILE in item.files).toBe(false)
  const r = await a.list.rows()
  const share = await a.list.share()
  const g = m.world.owned('ali').find((x) => x.id === id)!
  console.log('CUT', JSON.stringify({ rows: r, share: share.kind, gistFiles: Object.keys(g.files).length, repoList: m.world.repos!.file('ali/vault', LIST_PATH) !== null }))
  expect(r).toEqual({ kind: 'list-cut', vaults: ['ali/vault'] })
  expect(LIST_CUT).toMatch(/more than 300 files.*Nothing was changed, and no new list was started/)
  expect(share.kind).toBe('list-cut')
  expect(Object.keys(g.files).length).toBe(306)
  expect(m.world.repos!.file('ali/vault', LIST_PATH)).toBeNull()
  expect(m.world.owned('ali').filter((x) => INDEX_FILE in x.files || Object.keys(x.files).some(isListFile)).map((x) => x.id)).toEqual([id])
})

it('M3: the same cut list: the way out ends ALL sharing (every pointer and numbers gist of mine), then starts a new list with a note', async () => {
  const { m, id, numbers, pointers, a } = await cutList(9393, 304)
  expect((await a.list.rows()).kind).toBe('list-cut')
  expect(await a.list.restart('ali/vault')).toEqual({ kind: 'done', vault: 'ali/vault' })
  for (const p of pointers) expect(m.gist(p)).toBeUndefined()
  expect(m.gist(numbers)).toBeUndefined()
  expect(m.gist(id)).toBeUndefined()
  const repo = m.repoFiles('ali', null)
  const read = repo === null ? null : readListFiles(repo)
  expect(read?.kind === 'ok' && read.value.friends).toEqual([])
  const notes = m.world.owned('ali').filter((g) => INDEX_FILE in g.files).map((g) => JSON.parse(g.files[INDEX_FILE]) as { v: number; home: string })
  expect(notes).toEqual([expect.objectContaining({ v: 3, home: 'ali/vault' })])
  expect((await a.list.rows()).kind).toBe('ok')
})
