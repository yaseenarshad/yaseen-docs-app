import { describe, expect, it } from 'vitest'
import { fileKind } from '@shared/fileKind'

describe('fileKind', () => {
  it('classifies markdown and base files by extension, case-insensitively', () => {
    expect(fileKind('a.md')).toBe('markdown')
    expect(fileKind('a.markdown')).toBe('markdown')
    expect(fileKind('A.MD')).toBe('markdown')
    expect(fileKind('/abs/dir/Topics.base')).toBe('base')
    expect(fileKind('T.BASE')).toBe('base')
    expect(fileKind('.hidden.md')).toBe('markdown')
  })

  it('returns null for anything else', () => {
    expect(fileKind('a.txt')).toBeNull()
    expect(fileKind('base')).toBeNull()
    expect(fileKind('.base')).toBeNull()
    expect(fileKind('a.md.bak')).toBeNull()
    expect(fileKind('/abs/dir.md/file')).toBeNull()
    expect(fileKind('')).toBeNull()
  })
})
