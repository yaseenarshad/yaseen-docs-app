import { describe, expect, it } from 'vitest'
import { boardBaseName, canRenameWithoutConversion, fileKind, isAtomicTmp, isBoard, isDiagram, isDrawing, isMarkdown, isSkipped, isViewOnly } from '@shared/fileKind'
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

  it('the 18 code types of YAZ-3450 (D4) are text, each in the list once', () => {
    const added = ['.lua', '.r', '.dart', '.scala', '.hs', '.clj', '.pl', '.proto', '.diff', '.patch', '.gradle', '.groovy', '.ml', '.erl', '.jl', '.cmake', '.fs', '.elm']
    for (const ext of added) {
      expect(fileKind(`/vault/src/main${ext}`), ext).toBe('text')
      expect(isViewOnly(`main${ext}`), ext).toBe(true)
    }
    // They follow `.tex`, in that order, and no extension is in the list twice.
    const list = TEXT_VIEW_EXTENSIONS as readonly string[]
    expect(list.slice(list.indexOf('.tex') + 1)).toEqual(added)
    expect(new Set(list).size).toBe(list.length)
  })

  it('YAZ-3505: the well-known names with no extension are text, exactly as on disk, wherever they are', () => {
    for (const name of ['Dockerfile', 'Makefile', 'Procfile', 'Gemfile', 'Jenkinsfile', 'Vagrantfile', 'LICENSE', 'CODEOWNERS']) {
      expect(fileKind(name), name).toBe('text')
      expect(fileKind(`/vault/app/${name}`), name).toBe('text')
      expect(isViewOnly(name), name).toBe(true)
    }
    for (const name of ['Dockerfile.dev', '/vault/deploy/Dockerfile.prod', 'Dockerfile.x']) expect(fileKind(name), name).toBe('text')
  })

  it('YAZ-3505: near misses are not: another case, another name, a suffix; an extension that is a kind wins; dot-files stay skipped', () => {
    for (const name of ['makefile.bak', 'makefile', 'dockerfile', 'MAKEFILE', 'License', 'LICENSE.bak', 'Makefile.old', 'Dockerfile.', 'CMakeLists', 'Gemfile2', '/vault/.r', '/vault/.lua']) expect(fileKind(name), name).toBeNull()
    // `CMakeLists.txt` and `LICENSE.txt` are text by their `.txt`, as before; `Dockerfile.md` is a note.
    expect(fileKind('CMakeLists.txt')).toBe('text')
    expect(fileKind('LICENSE.txt')).toBe('text')
    expect(fileKind('Dockerfile.md')).toBe('markdown')
    expect(isSkipped('.gitignore')).toBe(true)
    expect(isSkipped('.env')).toBe(true)
    expect(isSkipped('Dockerfile')).toBe(false)
  })

  it('YAZ-3505: renames keep working: the names are text, so text to text needs no conversion', () => {
    expect(canRenameWithoutConversion('Dockerfile', 'Dockerfile.dev')).toBe(true)
    expect(canRenameWithoutConversion('Makefile', 'build.mk.txt')).toBe(true)
    expect(canRenameWithoutConversion('notes.txt', 'LICENSE')).toBe(true)
    expect(canRenameWithoutConversion('Makefile', 'makefile')).toBe(false)
    expect(canRenameWithoutConversion('LICENSE', 'photo.png')).toBe(false)
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

  it('classifies boards case-insensitively: .excalidraw a drawing, .drawio a diagram (YAZ-3028 D2)', () => {
    expect(fileKind('Sketch.excalidraw')).toBe('drawing')
    expect(fileKind('/vault/assets/drawings/SKETCH.EXCALIDRAW')).toBe('drawing')
    expect(fileKind('Flow.drawio')).toBe('diagram')
    expect(fileKind('/vault/Flow.DrawIO')).toBe('diagram')
    expect(isDrawing('a.Excalidraw')).toBe(true)
    expect(isDiagram('a.excalidraw')).toBe(false)
    expect(isBoard('a.drawio') && isBoard('a.excalidraw')).toBe(true)
    expect(isBoard('a.md')).toBe(false)
    // Never semantic: a wikilink to a board is navigation-only, and it is no note.
    expect(isMarkdown('a.excalidraw')).toBe(false)
    expect(isViewOnly('a.excalidraw') && isViewOnly('a.drawio')).toBe(true)
    // `.drawio.svg` / `.drawio.png` stay unsupported, the same as Draw; the final suffix decides.
    expect(fileKind('Flow.drawio.svg')).toBeNull()
    expect(fileKind('Flow.drawio.png')).toBe('image')
    expect(fileKind('.excalidraw')).toBeNull()
    expect(boardBaseName('Flow.DRAWIO')).toBe('Flow')
    expect(boardBaseName('Note.md')).toBe('Note.md')
  })

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

describe('canRenameWithoutConversion', () => {
  it('lets Markdown and text move between spellings of their own kind, and never across kinds', () => {
    expect(canRenameWithoutConversion('a.md', 'b.markdown')).toBe(true)
    expect(canRenameWithoutConversion('data.json', 'data.yaml')).toBe(true)
    // S4 (YAZ-3450): a code file may change its language; both are the text kind.
    expect(canRenameWithoutConversion('a.ts', 'a.py')).toBe(true)
    expect(canRenameWithoutConversion('build.gradle', 'build.groovy')).toBe(true)
    expect(canRenameWithoutConversion('a.lua', 'a.md')).toBe(false)
    expect(canRenameWithoutConversion('a.md', 'a.txt')).toBe(false)
    expect(canRenameWithoutConversion('a.pdf', 'a.png')).toBe(false)
  })

  it('a board keeps its kind: .excalidraw ↔ .drawio and board ↔ note fail before the disk changes (YAZ-3028 D2)', () => {
    expect(canRenameWithoutConversion('a.excalidraw', 'b.EXCALIDRAW')).toBe(true)
    expect(canRenameWithoutConversion('a.drawio', 'b.drawio')).toBe(true)
    expect(canRenameWithoutConversion('a.excalidraw', 'a.drawio')).toBe(false)
    expect(canRenameWithoutConversion('a.drawio', 'a.excalidraw')).toBe(false)
    expect(canRenameWithoutConversion('a.excalidraw', 'a.md')).toBe(false)
    expect(canRenameWithoutConversion('a.excalidraw', 'a.json')).toBe(false)
  })

  it('keeps raster images at their real encoding; .jpg/.jpeg is the one equivalent pair', () => {
    expect(canRenameWithoutConversion('photo.jpg', 'photo.JPEG')).toBe(true)
    expect(canRenameWithoutConversion('photo.png', 'photo.webp')).toBe(false)
  })

  it('a file with no viewer may be renamed or moved only with its exact extension (YAZ-1577 D5)', () => {
    expect(canRenameWithoutConversion('book.epub', 'novel.epub')).toBe(true)
    expect(canRenameWithoutConversion('book.EPUB', 'book.epub')).toBe(true)
    expect(canRenameWithoutConversion('/v/a/book.epub', '/v/b/book.epub')).toBe(true)
    expect(canRenameWithoutConversion('book.epub', 'book.mobi')).toBe(false)
    expect(canRenameWithoutConversion('book.epub', 'book')).toBe(false)
    expect(canRenameWithoutConversion('book', 'book.epub')).toBe(false)
    expect(canRenameWithoutConversion('book.epub', 'book.md')).toBe(false)
  })
})

describe('isAtomicTmp (YAZ-2179)', () => {
  it('matches only the `<name>.tmp-<12 lowercase hex>` shape an atomic write leaves', () => {
    expect(isAtomicTmp('a.md.tmp-0123456789ab')).toBe(true)
    expect(isAtomicTmp('/vault/assets/images/p.png.tmp-abcdef012345')).toBe(true)
    for (const name of ['notes.tmp', 'draft.tmp.md', 'report.tmp-draft.md', 'x.tmp-0123456789ab.md', 'a.md.tmp-0123456789AB', 'a.md.tmp-0123456789a', 'a.md.tmp-0123456789abc', 'a.md.tmp-']) {
      expect(isAtomicTmp(name), name).toBe(false)
    }
  })
})
