import { describe, expect, it } from 'vitest'
import { fileKind } from '@shared/fileKind'

describe('fileKind', () => {
  it('classifies markdown files by extension, case-insensitively', () => {
    expect(fileKind('a.md')).toBe('markdown')
    expect(fileKind('a.markdown')).toBe('markdown')
    expect(fileKind('A.MD')).toBe('markdown')
    expect(fileKind('.hidden.md')).toBe('markdown')
  })

  it('returns null for anything else', () => {
    expect(fileKind('a.txt')).toBeNull()
    expect(fileKind('markdown')).toBeNull()
    expect(fileKind('.md')).toBeNull()
    expect(fileKind('a.md.bak')).toBeNull()
    expect(fileKind('/abs/dir.md/file')).toBeNull()
    expect(fileKind('')).toBeNull()
  })
})
