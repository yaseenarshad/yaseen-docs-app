import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { TEST_RECORDS } from './testRecords'
import { byFolder, folderName, foldersTaking, pageColumns, selfAndAncestors, takesFrom } from './columnInheritance'

/** A folder's `.folder.md` record declaring `columns` (YAZ-4713 C2). */
const folderMd = (folder: string, columns?: Record<string, unknown>, title = folder.slice(folder.lastIndexOf('/') + 1)): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${folder}/.folder.md`,
  name: '.folder.md',
  title,
  folder,
  properties: columns === undefined ? {} : { folder_settings: { columns } },
})

const domain = { kind: 'select', options: ['Billing', 'Payments'] }
const FOLDERS = byFolder([folderMd('schema', { domain, owner: { kind: 'text' } }, 'Schema'), folderMd('schema/orders', { type: { kind: 'text' } })])

describe('columns flow down (YAZ-4713 C2)', () => {
  it('selfAndAncestors: the folder, then each folder above it, nearest first, the vault root last', () => {
    expect(selfAndAncestors('a/b/c')).toEqual(['a/b/c', 'a/b', 'a', ''])
    expect(selfAndAncestors('')).toEqual([''])
  })

  it('Schema declares Domain: the Orders page shows it, with Schema as its owner, after its own columns', () => {
    const own = { type: { kind: 'text' as const } }
    expect(pageColumns(own, 'schema/orders', FOLDERS, true, true)).toEqual({
      type: { decl: { kind: 'text' }, owner: 'schema/orders' },
      domain: { decl: domain, owner: 'schema' },
      owner: { decl: { kind: 'text' }, owner: 'schema' },
    })
  })

  it('the nearest declaration of a key wins: Orders’ own Domain options on the Orders page; Schema keeps its own', () => {
    const override = { domain: { kind: 'select' as const, options: ['Orders only'] } }
    // C6: Orders' own over Schema's names Schema, for "Use Schema's".
    expect(pageColumns(override, 'schema/orders', FOLDERS, true, true).domain).toEqual({ decl: override.domain, owner: 'schema/orders', over: 'schema' })
    expect(pageColumns({ domain: domain as never }, 'schema', FOLDERS, true, true).domain.owner).toBe('schema')
  })

  it('"Show parent folders’ columns" off: the folder’s own columns alone', () => {
    expect(Object.keys(pageColumns({ type: { kind: 'text' } }, 'schema/orders', FOLDERS, true, false))).toEqual(['type'])
  })

  it('"Separate value on this page" (C3) is each page’s own: an inherited column never carries it', () => {
    const folders = [folderMd('schema', { domain: { ...domain, separate: true } })]
    expect(pageColumns({}, 'schema/orders', byFolder(folders), true, true).domain.decl).toEqual(domain)
  })

  it('a folder with no `.folder.md`, or none saved, adds nothing (C5)', () => {
    expect(pageColumns({}, 'notes/a', byFolder([folderMd('notes')]), true, true)).toEqual({})
  })

  it('folderName: the owner’s title; the vault’s name at the root', () => {
    expect(folderName(FOLDERS, 'schema', 'vault')).toBe('Schema')
    expect(folderName(FOLDERS, 'elsewhere/x', 'vault')).toBe('x')
    expect(folderName(FOLDERS, '', 'My vault')).toBe('My vault')
  })

  it('takesFrom and foldersTaking: a subfolder that declares the key itself, and every folder below it, take it from no one above; a read-only page is left out (7A 9, 2)', () => {
    const folders = byFolder([
      folderMd('schema', { domain }),
      folderMd('schema/orders'),
      folderMd('schema/billing', { domain: { kind: 'text' } }),
      folderMd('schema/billing/old'),
      { ...folderMd('schema/locked'), properties: { readonly: true } },
    ])
    expect(takesFrom(folders, true, 'schema/orders', 'schema', 'domain')).toBe(true)
    expect(takesFrom(folders, true, 'schema/billing/old', 'schema', 'domain')).toBe(false)
    expect(foldersTaking(folders, true, 'schema', 'domain').map((r) => r.folder)).toEqual(['schema/orders'])
  })
})
