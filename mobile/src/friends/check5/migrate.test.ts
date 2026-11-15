/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it } from 'vitest'
import { INDEX_FILE, isListFile, readListFiles } from '@shared/friendGists'
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

it('M2: a v2 list of 301 files (GitHub cuts it at 300): not moved, nothing written, "needs repair"', async () => {
  const m = new Model5(9292, K0)
  m.hookRepos()
  m.devs.A.push(await m.device('A', 0))
  const files: Record<string, string> = { [INDEX_FILE]: JSON.stringify({ v: 2, nickname: null, vaults: ['ali/vault'] }) }
  for (let i = 0; i < 300; i++) files[`notecards-friends.f.${i.toString(16).padStart(32, '0')}.json`] = JSON.stringify({ v: 1, name: `F${i}`, theirs: 'b'.repeat(32) })
  const id = m.world.seed('ali', files)
  const r = await (m.devs.A[0] as any).list.rows()
  const g = m.world.owned('ali').find((x) => x.id === id)!
  console.log('CUT', JSON.stringify({ rows: r.kind, gistFiles: Object.keys(g.files).length, repoList: m.world.repos!.file('ali/vault', LIST_PATH) !== null }))
  expect(r.kind).toBe('needs-repair')
  expect(Object.keys(g.files).length).toBe(301)
})

it('M3: the same cut list (the head file is the 301st name): the first share makes a NEW list; the old friends are gone from the app', async () => {
  const m = new Model5(9393, K0)
  m.hookRepos()
  m.devs.A.push(await m.device('A', 0))
  const files: Record<string, string> = { [INDEX_FILE]: JSON.stringify({ v: 2, nickname: null, vaults: ['ali/vault'] }) }
  for (let i = 0; i < 300; i++) files[`notecards-friends.f.${i.toString(16).padStart(32, '0')}.json`] = JSON.stringify({ v: 1, name: `F${i}`, theirs: 'b'.repeat(32) })
  const id = m.world.seed('ali', files)
  const listed = await m.world.http('GET', '/gists', new URLSearchParams(), `github_pat_11CHECK3_${'ali'.padEnd(70, '0')}`, undefined, null, null)
  const item = (listed!.body as any[]).find((g) => g.id === id)
  const s = await (m.devs.A[0] as any).list.share()
  const r = await (m.devs.A[0] as any).list.rows()
  const notes = m.world.owned('ali').filter((g) => INDEX_FILE in g.files)
  const repo = m.repoFiles('ali', null)
  const read = repo === null ? null : readListFiles(repo)
  console.log('CUT2', JSON.stringify({ listCallNamesHead: item ? INDEX_FILE in item.files : null, listCallFiles: item ? Object.keys(item.files).length : null, share: s.kind, rows: r.kind, friendsInNewList: read?.kind === 'ok' ? read.value.friends.length : null, listGists: notes.map((g) => `${g.id === id ? 'OLD' : 'new'}:v${JSON.parse(g.files[INDEX_FILE]).v}:${Object.keys(g.files).length} files`) }))
  expect(s.kind).not.toBe('ok')
})
