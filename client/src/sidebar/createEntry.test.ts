import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { entryPath, renamedPath, targetDirFor, validateEntryName } from './createEntry'

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

describe('entryPath', () => {
  it('appends .md to file names without a markdown extension', () => {
    expect(entryPath('/r', 'note', 'file')).toBe('/r/note.md')
    expect(entryPath('/r', 'note.txt', 'file')).toBe('/r/note.txt.md')
  })

  it('keeps existing markdown extensions, case-insensitive', () => {
    expect(entryPath('/r', 'note.md', 'file')).toBe('/r/note.md')
    expect(entryPath('/r', 'note.MARKDOWN', 'file')).toBe('/r/note.MARKDOWN')
  })

  it('gives a folder page the note extension — it IS a note, just born flagged (🔒 D1, YAZ-841)', () => {
    expect(entryPath('/r', 'Growth', 'folderPage')).toBe('/r/Growth.md')
    expect(entryPath('/r', 'Growth.md', 'folderPage')).toBe('/r/Growth.md')
    expect(entryPath('/r', '  Growth ', 'folderPage')).toBe('/r/Growth.md')
  })

  it('uses dir names as-is and trims whitespace', () => {
    expect(entryPath('/r', 'Folder', 'dir')).toBe('/r/Folder')
    expect(entryPath('/r', '  note ', 'file')).toBe('/r/note.md')
  })
})

describe('targetDirFor', () => {
  it('dir row → itself, file row → its parent, blank space → root', () => {
    expect(targetDirFor(dir('/r/sub'), '/r')).toBe('/r/sub')
    expect(targetDirFor(file('/r/sub/a.md'), '/r')).toBe('/r/sub')
    expect(targetDirFor(null, '/r')).toBe('/r')
  })
})

describe('renamedPath (Links E1, GRO-2194)', () => {
  it('same parent dir; the OLD file extension re-appends when no markdown one is typed', () => {
    expect(renamedPath('/r/sub/B.md', 'C')).toBe('/r/sub/C.md')
    expect(renamedPath('/r/sub/B.markdown', 'C')).toBe('/r/sub/C.markdown')
    expect(renamedPath('/r/B.md', '  C  ')).toBe('/r/C.md')
  })

  it('a typed markdown extension is kept as typed', () => {
    expect(renamedPath('/r/B.md', 'C.md')).toBe('/r/C.md')
    expect(renamedPath('/r/B.markdown', 'C.md')).toBe('/r/C.md')
    expect(renamedPath('/r/B.md', 'C.MD')).toBe('/r/C.MD')
  })

  it('an unchanged name round-trips to the same path (the caller treats it as a no-op)', () => {
    expect(renamedPath('/r/B.md', 'B')).toBe('/r/B.md')
  })

  it('a DIRECTORY renames with no extension logic at all (E1b, GRO-2241)', () => {
    expect(renamedPath('/r/sub/Old', 'New', 'dir')).toBe('/r/sub/New')
    expect(renamedPath('/r/Old', ' Notes.md ', 'dir')).toBe('/r/Notes.md') // a folder may be NAMED like a file
    expect(renamedPath('/r/Old', 'Old', 'dir')).toBe('/r/Old') // unchanged → caller no-op
  })
})
