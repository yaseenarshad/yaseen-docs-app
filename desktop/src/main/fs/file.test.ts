import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readdir, readFile as fsReadFile, utimes, writeFile as fsWriteFile } from 'node:fs/promises'
import path from 'node:path'
import { readFile, writeFile } from './file'
import { failure, makeFixture } from './testFixture'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES } from '@shared/types'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (p: Promise<unknown>) => (await failure(p)).code

describe('readFile', () => {
  it('returns content, mtime, size', async () => {
    const body = await readFile(path.join(root, 'A.md'))
    expect(body).toMatchObject({ path: path.join(root, 'A.md'), content: '# A\n', size: 4 })
    expect(body.mtime).toBeGreaterThan(0)
  })

  it('reads supported view-only text without normalizing Unicode, CRLF, or a UTF-8 BOM', async () => {
    const cases = [
      ['data.json', '{\r\n  "message": "Hello 🌍"\r\n}\r\n'],
      ['script.py', 'print("Ünicode")\n'],
      ['notes.txt', '\ufefffirst\r\nsecond\r\n'],
    ] as const

    for (const [name, content] of cases) {
      const file = path.join(root, name)
      await fsWriteFile(file, Buffer.from(content, 'utf8'))
      const response = await readFile(file)
      expect(response).toMatchObject({ path: file, content, size: Buffer.byteLength(content) })
    }
  })

  it.each([
    ['malformed UTF-8', 'broken.json', Buffer.from([0xc3, 0x28])],
    ['NUL content', 'binary.py', Buffer.from('before\0after', 'utf8')],
  ])('rejects %s instead of returning lossy view-only text', async (_label, name, bytes) => {
    const file = path.join(root, name)
    await fsWriteFile(file, bytes)
    const err = await failure(readFile(file))
    expect(err.code).toBe('IO_ERROR')
    expect(err.message).toMatch(/valid UTF-8 text|NUL/)
  })

  it('retains the existing replacement-character behavior for malformed Markdown bytes', async () => {
    const file = path.join(root, 'legacy.md')
    await fsWriteFile(file, Buffer.from([0x23, 0x20, 0xc3, 0x28, 0x0a]))
    expect((await readFile(file)).content).toBe('# �(\n')
  })

  it('retains the existing leading BOM behavior for Markdown', async () => {
    const file = path.join(root, 'legacy-bom.md')
    await fsWriteFile(file, Buffer.from('\ufeff# Title\n', 'utf8'))
    expect((await readFile(file)).content).toBe('\ufeff# Title\n')
  })

  it('rejects view-only text above the existing 10 MiB limit', async () => {
    const file = path.join(root, 'oversized.txt')
    await fsWriteFile(file, Buffer.alloc(MAX_FILE_BYTES + 1, 0x61))
    expect(await code(readFile(file))).toBe('TOO_LARGE')
  })

  it('NOT_FOUND missing, NOT_ABSOLUTE relative, UNSUPPORTED_EXTENSION, NOT_A_FILE', async () => {
    expect(await code(readFile(path.join(root, 'missing.md')))).toBe('NOT_FOUND')
    expect(await code(readFile('rel.md'))).toBe('NOT_ABSOLUTE')
    expect(await code(readFile(path.join(root, 'report.pdf')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(readFile(path.join(root, 'alpha')))).toBe('UNSUPPORTED_EXTENSION')
    await mkdir(path.join(root, 'folder.md'))
    expect(await code(readFile(path.join(root, 'folder.md')))).toBe('NOT_A_FILE')
  })
})

describe('writeFile', () => {
  it('write then read is byte-identical (unicode/emoji/frontmatter) and leaves no tmp files', async () => {
    const file = path.join(root, 'alpha', 'new.md')
    const content = '---\ntitle: Ünïcödé 🚀\n---\n\n# Hello 🌍\n\n- [ ] task ✅\n\n```ts\nconst x = "é"\n```\n'
    const w = await writeFile({ path: file, content })
    expect(w.path).toBe(file)
    expect(w.size).toBe(Buffer.byteLength(content))
    const r = await readFile(file)
    expect(r.content).toBe(content)
    expect(r.mtime).toBe(w.mtime)
    expect(await fsReadFile(file, 'utf8')).toBe(content)
    expect((await readdir(path.join(root, 'alpha'))).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('BAD_REQUEST when content is not a string / request not an object, NOT_ABSOLUTE, UNSUPPORTED_EXTENSION', async () => {
    expect(await code(writeFile({ path: path.join(root, 'x.md'), content: 42 as never }))).toBe('BAD_REQUEST')
    expect(await code(writeFile({ path: path.join(root, 'x.md') } as never))).toBe('BAD_REQUEST')
    expect(await code(writeFile({ path: path.join(root, 'x.md'), content: '', expectedMtime: '1' as never }))).toBe('BAD_REQUEST')
    expect(await code(writeFile({ path: 'rel.md', content: '' }))).toBe('NOT_ABSOLUTE')
    expect(await code(writeFile({ path: path.join(root, 'x.pdf'), content: '' }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(writeFile(undefined as never))).toBe('BAD_REQUEST')
    expect(await code(writeFile('{not json' as never))).toBe('BAD_REQUEST')
  })

  // S8 (YAZ-3445): a PDF, an image, a file with no in-app viewer and a board stay refused, and keep their bytes.
  it.each(['existing.pdf', 'existing.png', 'existing.epub', 'existing.excalidraw', 'existing.drawio'])('refuses to write %s and preserves the original bytes', async (name) => {
    const file = path.join(root, name)
    const original = Buffer.from(`original:${name}`)
    await fsWriteFile(file, original)
    expect(await code(writeFile({ path: file, content: 'clobber' }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await fsReadFile(file)).toEqual(original)
  })

  // YAZ-3445 D3: a code file saves byte for byte. The renderer sends the file's own line break and
  // BOM in the string (`lineBreakOf` sets the Monaco model's EOL), so main writes exactly that.
  describe('code files (text kind)', () => {
    const roundTrip = async (name: string, before: string, after: string): Promise<void> => {
      const file = path.join(root, name)
      await fsWriteFile(file, Buffer.from(before, 'utf8'))
      const read = await readFile(file)
      expect(read.content).toBe(before)
      const w = await writeFile({ path: file, content: after, expectedMtime: read.mtime })
      expect(w.size).toBe(Buffer.byteLength(after))
      expect(await fsReadFile(file)).toEqual(Buffer.from(after, 'utf8'))
      expect((await readFile(file)).content).toBe(after)
      expect((await readdir(root)).filter((n) => n.includes('.tmp-'))).toEqual([])
    }

    it('S1: an LF file edited and saved keeps LF', () =>
      roundTrip('lf.ts', 'const a = 1\nconst b = 2\n', 'const a = 1\nconst b = 3\nconst c = 4\n'))

    it('S2: a CRLF file edited and saved keeps CRLF on every line', () =>
      roundTrip('crlf.json', '{\r\n  "a": 1\r\n}\r\n', '{\r\n  "a": 1,\r\n  "b": 2\r\n}\r\n'))

    it('S4: a file that starts with a UTF-8 BOM keeps the BOM', async () => {
      await roundTrip('bom.py', '\ufeffprint("a")\n', '\ufeffprint("b")\n')
      expect((await fsReadFile(path.join(root, 'bom.py'))).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    })

    // A bare `.env` has no extension (a leading dot alone is none) and is a hidden dot-entry, so only `<name>.env` is text.
    it('S7: a local.env file saves like any other text file; a bare .env stays refused', async () => {
      await roundTrip('local.env', 'A=1\n', 'A=2\n')
      expect(await code(writeFile({ path: path.join(root, '.env'), content: 'A=3\n' }))).toBe('UNSUPPORTED_EXTENSION')
    })

    it('S9 (D2): a .yaml file that starts with --- saves whole, nothing split as frontmatter', () =>
      roundTrip('compose.yaml', '---\nname: a\n---\nb: 1\n', '---\nname: a\n---\nb: 2\n'))

    it('CONFLICT: a stale mtime rejects with the disk mtime and writes nothing', async () => {
      const file = path.join(root, 'stale.ts')
      await fsWriteFile(file, 'export const v = 1\n')
      const before = await readFile(file)
      await utimes(file, new Date(), new Date(before.mtime + 5000))
      const conflict = await failure(writeFile({ path: file, content: 'export const v = 2\n', expectedMtime: before.mtime }))
      expect(conflict).toMatchObject({ code: 'CONFLICT', path: file })
      expect(conflict.mtime).not.toBe(before.mtime)
      expect(await fsReadFile(file, 'utf8')).toBe('export const v = 1\n')
      expect((await readdir(root)).filter((n) => n.includes('.tmp-'))).toEqual([])
    })
  })

  // A folder's settings file is born by its first change (YAZ-2290 D1): the renderer reads a
  // missing one as empty with mtime 0 (`readForWrite`) and this write is what creates it.
  it('a missing folder settings file is created by a write that expected nothing; one that appeared meanwhile is a CONFLICT', async () => {
    const file = path.join(root, 'alpha', FOLDER_SETTINGS_FILE)
    const w = await writeFile({ path: file, content: '---\nowner: Yaseen\n---\n', expectedMtime: 0 })
    expect(await fsReadFile(file, 'utf8')).toBe('---\nowner: Yaseen\n---\n')
    const raced = await failure(writeFile({ path: file, content: 'clobber', expectedMtime: 0 }))
    expect(raced).toMatchObject({ code: 'CONFLICT', mtime: w.mtime })
    expect(await fsReadFile(file, 'utf8')).toBe('---\nowner: Yaseen\n---\n')
  })

  it('NOT_FOUND when parent dir does not exist', async () => {
    expect(await code(writeFile({ path: path.join(root, 'nope', 'x.md'), content: '' }))).toBe('NOT_FOUND')
  })

  it('CONFLICT (with the disk mtime) when expectedMtime differs, nothing written; succeeds when it matches', async () => {
    const file = path.join(root, 'b.md')
    const before = await readFile(file)
    await utimes(file, new Date(), new Date(before.mtime + 5000))
    const conflict = await failure(writeFile({ path: file, content: 'clobber', expectedMtime: before.mtime }))
    expect(conflict.code).toBe('CONFLICT')
    expect(conflict.path).toBe(file)
    expect(conflict.mtime).toBeDefined()
    expect(conflict.mtime).not.toBe(before.mtime)
    expect(await fsReadFile(file, 'utf8')).toBe('# b\n')
    const ok = await writeFile({ path: file, content: 'fresh', expectedMtime: conflict.mtime })
    expect(ok.path).toBe(file)
    expect(await fsReadFile(file, 'utf8')).toBe('fresh')
  })
})
