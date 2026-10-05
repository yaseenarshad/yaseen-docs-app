import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { datedSeed, plainEntryName, renamedPath, targetDirFor, validateEntryName } from './createEntry'

const dir = (path: string): TreeNode => ({ type: 'dir', name: path.split('/').pop()!, path, children: [] })
const file = (path: string): TreeNode => ({ type: 'file', name: path.split('/').pop()!, path, size: 0, mtime: 1, kind: 'markdown' })

describe('validateEntryName', () => {
  it('accepts plain names', () => {
    expect(validateEntryName('Notes')).toBeNull()
    expect(validateEntryName('my file.md')).toBeNull()
  })

  it('rejects slashes, leading dots, and NUL', () => {
    expect(validateEntryName('a/b')).toMatch(/\//)
    expect(validateEntryName('.hidden')).toMatch(/hidden/i)
    expect(validateEntryName('a\0b')).not.toBeNull()
  })
})

describe('datedSeed (YAZ-1604; notes too since YAZ-2242)', () => {
  it('is MM_DD of the given day, zero-padded, then "- " so the title lands one space after the dash', () => {
    expect(datedSeed(new Date(2026, 5, 22))).toBe('06_22- ')
    expect(datedSeed(new Date(2026, 11, 3))).toBe('12_03- ')
  })

  it('defaults to today', () => {
    expect(datedSeed()).toMatch(/^\d{2}_\d{2}- $/)
  })
})

describe('targetDirFor', () => {
  it('dir row → itself, file row → its parent, blank space → root', () => {
    expect(targetDirFor(dir('/r/sub'), '/r')).toBe('/r/sub')
    expect(targetDirFor(file('/r/sub/a.md'), '/r')).toBe('/r/sub')
    expect(targetDirFor(null, '/r')).toBe('/r')
  })

  it('a shortcut row → the folder it stands in, not the folder its note lives in (YAZ-2290 D2)', () => {
    expect(targetDirFor({ type: 'file', path: '/r/areas/a.md', shortcutIn: '/r/sub' }, '/r')).toBe('/r/sub')
  })
})

describe('renamedPath (Links E1, GRO-2194): a view-only file', () => {
  it('round-trips unchanged JSON and PDF names without duplicating their extensions', () => {
    expect(renamedPath('/r/data.json', 'data.json')).toBe('/r/data.json')
    expect(renamedPath('/r/report.PDF', 'report.PDF')).toBe('/r/report.PDF')
  })

  it('same parent dir; appends the current suffix when a bare basename is typed', () => {
    expect(renamedPath('/r/sub/data.json', '  profile  ')).toBe('/r/sub/profile.json')
    expect(renamedPath('/r/report.PDF', 'brief')).toBe('/r/brief.PDF')
  })

  it('respects explicit supported extensions, including mixed-case same-kind text extensions', () => {
    expect(renamedPath('/r/data.JSON', 'profile.json')).toBe('/r/profile.json')
    expect(renamedPath('/r/data.JSON', 'profile.Py')).toBe('/r/profile.Py')
    expect(renamedPath('/r/report.pdf', 'brief.PDF')).toBe('/r/brief.PDF')
  })

  it.each(['Release.1.json', 'report.final.PDF', 'schema.graphql.ts', 'report.json.pdf'])('round-trips an unchanged dotted or compound filename exactly: %s', (name) => {
    expect(renamedPath(`/r/${name}`, name)).toBe(`/r/${name}`)
  })

  it('renames dotted basenames while preserving the old exact suffix', () => {
    expect(renamedPath('/r/Release.1.json', 'Release.2')).toBe('/r/Release.2.json')
    expect(renamedPath('/r/report.final.PDF', 'summary.final')).toBe('/r/summary.final.PDF')
  })

  it('still honors intentional compound-name renames with an explicit supported suffix', () => {
    expect(renamedPath('/r/schema.graphql.ts', 'schema.py')).toBe('/r/schema.py')
    expect(renamedPath('/r/report.json.pdf', 'summary.PDF')).toBe('/r/summary.PDF')
  })

  it('appends the current suffix to unrecognized dotted names but leaves recognized cross-kind suffixes explicit', () => {
    expect(renamedPath('/r/data.json', 'profile.bin')).toBe('/r/profile.bin.json')
    expect(renamedPath('/r/data.json', 'profile.pdf')).toBe('/r/profile.pdf')
  })
})

describe('plainEntryName (YAZ-2523 V3): the one rule for a name typed in a vault that does not use IDs', () => {
  it('a note takes the name typed, with `.md` unless a Markdown suffix was typed; any other suffix is part of the name', () => {
    expect(plainEntryName('  Meeting notes  ', 'file')).toBe('Meeting notes.md')
    expect(plainEntryName('v1.2', 'file')).toBe('v1.2.md')
    expect(plainEntryName('talk.pdf', 'file')).toBe('talk.pdf.md')
    expect(plainEntryName('Old name.md', 'file')).toBe('Old name.md')
    expect(plainEntryName('Old name.markdown', 'file')).toBe('Old name.markdown')
  })

  it('a note that is renamed keeps the Markdown suffix it has', () => {
    expect(plainEntryName('Meeting notes', 'file', '.markdown')).toBe('Meeting notes.markdown')
  })

  it('a folder takes the name typed whole: no suffix is added, and one that reads as an extension is kept', () => {
    expect(plainEntryName(' Q3 Plans ', 'dir')).toBe('Q3 Plans')
    expect(plainEntryName('Archive.json', 'dir')).toBe('Archive.json')
  })

  it('a name a file cannot hold is refused with the reason', () => {
    expect(() => plainEntryName('a/b', 'file')).toThrow('Name cannot contain "/"')
    expect(() => plainEntryName('.git', 'dir')).toThrow('Names starting with "." are hidden')
  })
})
