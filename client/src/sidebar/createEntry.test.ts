import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { entryPath, targetDirFor, validateEntryName } from './createEntry'

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
