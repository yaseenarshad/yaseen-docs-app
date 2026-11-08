import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { searchRows } from '@shared/searchCandidates'
import { _evictAll } from '../vaultIndex/live'
import { resolveTarget, scopedCandidates, search } from './resources'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docs-checker-yaz-4510-'))
  await mkdir(join(root, '.yaseendocs'))
  await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: true, letters: 'TST' }))
  await writeFile(join(root, 'a.md'), '---\nid: TST-1\ntitle: Match\n---\n')
  await writeFile(join(root, 'z.md'), '---\nid: TST-2\ntitle: Match pinned\n---\n')
  await writeFile(join(root, '.yaseendocs/favorites.json'), JSON.stringify({ version: 1, favorites: ['z.md'] }))
})
afterEach(async () => { _evictAll(); await rm(root, { recursive: true, force: true }) })

it('keeps the UI pinned ordering when the same search runs through the CLI', async () => {
  const state = defaultAppState()
  const { rows } = await scopedCandidates(state, { root })
  const expected = [...new Set(searchRows(rows, 'Match', new Set([join(root, 'z.md')])).map(row => row.path))]
  const actual = (await search(state, { root, query: 'Match' })).items.map(row => row.path)
  console.log(JSON.stringify({ expected, actual }))
  expect(actual).toEqual(expected)
})

it('includes candidate paths when an exact name is ambiguous', async () => {
  await writeFile(join(root, 'z.md'), '---\nid: TST-2\ntitle: Match\n---\n')
  let failure: any
  try { await resolveTarget([root], { name: 'Match' }) } catch (error) { failure = error }
  console.log(JSON.stringify({ code: failure?.code, message: failure?.message, details: failure?.details }))
  expect(failure).toMatchObject({ code: 'AMBIGUOUS_TARGET', details: { candidates: expect.arrayContaining([join(root, 'a.md'), join(root, 'z.md')]) } })
})
