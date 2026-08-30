import { describe, expect, it } from 'vitest'
import { fileKind, isViewOnly } from '@shared/fileKind'
import { TEXT_VIEW_EXTENSIONS } from '@shared/types'

describe('fileKind', () => {
  it('classifies markdown files by extension, case-insensitively', () => {
    expect(fileKind('a.md')).toBe('markdown')
    expect(fileKind('a.markdown')).toBe('markdown')
    expect(fileKind('A.MD')).toBe('markdown')
    expect(fileKind('.hidden.md')).toBe('markdown')
  })

  it.each(TEXT_VIEW_EXTENSIONS)('classifies %s as view-only text', (ext) => {
    expect(fileKind(`example${ext}`)).toBe('text')
    expect(fileKind(`/vault/Example${ext.toUpperCase()}`)).toBe('text')
  })

  it('classifies PDFs case-insensitively', () => {
    expect(fileKind('report.pdf')).toBe('pdf')
    expect(fileKind('/vault/REPORT.PDF')).toBe('pdf')
  })

  it.each(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp'])(
    'classifies %s as a view-only raster image',
    (ext) => {
      expect(fileKind(`example${ext}`)).toBe('image')
      expect(fileKind(`/vault/Example${ext.toUpperCase()}`)).toBe('image')
      expect(isViewOnly(`example${ext}`)).toBe(true)
    },
  )

  it('returns null for leading-dot-only names, extensionless files, compound unknown suffixes, and binaries', () => {
    expect(fileKind('markdown')).toBeNull()
    expect(fileKind('.md')).toBeNull()
    expect(fileKind('.json')).toBeNull()
    expect(fileKind('.pdf')).toBeNull()
    expect(fileKind('a.md.bak')).toBeNull()
    expect(fileKind('data.json.gz')).toBeNull()
    expect(fileKind('archive.zip')).toBeNull()
    expect(fileKind('vector.svg')).toBeNull()
    expect(fileKind('program.exe')).toBeNull()
    expect(fileKind('/abs/dir.md/file')).toBeNull()
    expect(fileKind('')).toBeNull()
  })
})
