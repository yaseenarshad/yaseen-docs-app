import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { VaultStore } from '../store'
import { loadFilesOrder } from './filesOrder'
import type { VaultData } from './vaultData'
import { buildTree, visibleRows } from './vaultTree'

/**
 * The Mac's Files sort on the phone (YAZ-5916 D4, Q4): the vault's newest `files-order.<mac id>.json` says the sort;
 * Manual draws each folder in the saved order (folders and files mixed, unnamed items last), Name and Last updated as that.
 */
const rec = (path: string, mtime = 0): IndexRecord => ({ path, name: path.slice(path.lastIndexOf('/') + 1), title: '', mtime }) as unknown as IndexRecord
const records = [rec('a.md', 3), rec('b.md', 1), rec('c.md', 2), rec('Work/w.md', 5), rec('Zed/z.md', 0)]
const labels = (view: Parameters<typeof buildTree>[2]) => visibleRows(buildTree(records, [], view), new Set()).map((r) => r.label)

function storeOf(files: Record<string, unknown>): VaultStore {
  return { read: async (_vault: string, path: string) => (path in files ? { content: JSON.stringify(files[path]) } : null) } as unknown as VaultStore
}
const dataOf = (files: string[]): VaultData => ({ vault: 'v', files }) as unknown as VaultData

describe('the phone reads the Mac\'s Files sort (YAZ-5916)', () => {
  it('the newest valid file is the sort and the order; another Mac\'s older file is passed over', async () => {
    const older = '.yaseendocs/files-order.aaaaaaaaaaaa.json'
    const newer = '.yaseendocs/files-order.bbbbbbbbbbbb.json'
    const store = storeOf({
      [older]: { version: 1, at: '2026-11-18T10:00:00.000Z', sort: 'updated', reverse: false, folders: {} },
      [newer]: { version: 1, at: '2026-11-18T11:00:00.000Z', sort: 'manual', reverse: false, folders: { '': ['c.md', 'Zed', 'a.md'] } },
    })
    const view = await loadFilesOrder(store, dataOf([older, newer, 'a.md']))
    expect(view).toEqual({ sort: { by: 'manual', reverse: false }, folders: { '': ['c.md', 'Zed', 'a.md'] } })
    // Manual: the saved order, then the unnamed items in the Name order (folders first).
    expect(labels(view)).toEqual(['c', 'Zed', 'a', 'Work', 'b'])
  })

  it('Name and Last updated sort as the Mac says; no file is Name, A to Z, as before', async () => {
    expect(labels({ sort: { by: 'name', reverse: true }, folders: {} })).toEqual(['Zed', 'Work', 'c', 'b', 'a'])
    expect(labels({ sort: { by: 'updated', reverse: false }, folders: { '': ['b.md'] } })).toEqual(['Work', 'Zed', 'a', 'c', 'b'])
    expect(await loadFilesOrder(storeOf({}), dataOf(['a.md']))).toBeNull()
    expect(labels(null)).toEqual(['Work', 'Zed', 'a', 'b', 'c'])
  })
})

/** Checker test for PR #278 (YAZ-5916 D4): the phone follows the Mac's order inside a folder too, by names on disk. */
describe('checker: the phone\'s Files list follows the Mac\'s Manual order in every folder', () => {
  it('a sub-folder draws its own saved order by the names on disk, also when a folder shows its title; folders and pages mix; a folder with no list keeps the Name order', () => {
    const recs = [rec('Work/b.md'), rec('Work/a.md'), rec('Work/Zeta/z.md'), rec('Work/Alpha/x.md'), rec('Other/o2.md'), rec('Other/o1.md')]
    const folders = [{ path: 'Work/Zeta/.folder.md', title: 'Last folder' }] as unknown as IndexRecord[]
    const view = { sort: { by: 'manual' as const, reverse: false }, folders: { '': ['Other', 'Work'], Work: ['b.md', 'Zeta', 'a.md'] } }
    const rows = visibleRows(buildTree(recs, folders, view), new Set(['Work', 'Other']))
    expect(rows.map((r) => r.label)).toEqual(['Other', 'o1', 'o2', 'Work', 'b', 'Last folder', 'a', 'Alpha'])
  })
})
