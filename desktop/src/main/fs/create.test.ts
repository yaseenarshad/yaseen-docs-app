import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setFrontmatterProperty } from '@shared/frontmatter'
import { NOTE_ID_KEY, isNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE } from '@shared/types'
import { createDir, createFile } from './create'
import { readFile as readText, writeFile as writeText } from './file'
import { failure, makeFixture } from './testFixture'
import { subscribe } from './watchers'

// The id sweep reaching a folder first, between its `mkdir` and its `.folder.md`: `afterMkdir` runs once, after the next `mkdir`.
let afterMkdir: ((dir: string) => Promise<void>) | undefined
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  const mkdir = async (...args: Parameters<typeof m.mkdir>) => {
    const made = await m.mkdir(...args)
    const hook = afterMkdir
    afterMkdir = undefined
    await hook?.(String(args[0]))
    return made
  }
  return { ...m, mkdir: mkdir as typeof m.mkdir }
})

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (p: Promise<unknown>) => (await failure(p)).code

describe('createDir', () => {
  const settingsIn = (dir: string) => readFile(path.join(dir, FOLDER_SETTINGS_FILE), 'utf8')

  it('"New folder" / "New dated folder": creates a directory born with a `.folder.md` holding only a fresh `id`, and returns its path (D13)', async () => {
    const p = path.join(root, 'NewFolder')
    expect(await createDir({ path: p })).toEqual({ path: p })
    expect((await stat(p)).isDirectory()).toBe(true)
    expect(await readdir(p)).toEqual([FOLDER_SETTINGS_FILE])
    const id = /^---\nid: (.+)\n---\n$/.exec(await settingsIn(p))?.[1]
    expect(isNoteId(id)).toBe(true)
    // The bytes the frontmatter writer gives an empty file: a later settings write is a normal edit.
    expect(await settingsIn(p)).toBe(setFrontmatterProperty('', NOTE_ID_KEY, id))
  })

  it('C: a folder made in the app, titled `Upwork 2026`, is born holding `id` and `title: Upwork 2026` (YAZ-2420 D6)', async () => {
    const p = path.join(root, 'upwork-2026')
    expect(await createDir({ path: p, title: 'Upwork 2026' })).toEqual({ path: p })
    expect(await settingsIn(p)).toMatch(/^---\nid: [0-9a-z]{12}\ntitle: Upwork 2026\n---\n$/)
  })

  it('a title that is not text is refused, and no folder is made', async () => {
    expect(await code(createDir({ path: path.join(root, 'bad-title'), title: 7 as never }))).toBe('BAD_REQUEST')
    await expect(stat(path.join(root, 'bad-title'))).rejects.toThrow()
  })

  it('the id is fresh, like a note born in the app: the same folder name twice is two ids', async () => {
    const [a, b] = [path.join(root, 'Zeta', 'Twin'), path.join(root, 'alpha', 'Twin')]
    await createDir({ path: a })
    await createDir({ path: b })
    expect(await settingsIn(a)).not.toBe(await settingsIn(b))
  })

  it('ALREADY_EXISTS when the path exists (dir or file), and nothing is written into the folder that was there', async () => {
    expect(await code(createDir({ path: path.join(root, 'alpha') }))).toBe('ALREADY_EXISTS')
    expect(await code(createDir({ path: path.join(root, 'b.md') }))).toBe('ALREADY_EXISTS')
    expect(await readdir(path.join(root, 'Empty'))).toEqual([])
    expect(await code(createDir({ path: path.join(root, 'Empty') }))).toBe('ALREADY_EXISTS')
    expect(await readdir(path.join(root, 'Empty'))).toEqual([])
  })

  it('NOT_FOUND when the parent does not exist, BAD_REQUEST / NOT_ABSOLUTE on bad input', async () => {
    expect(await code(createDir({ path: path.join(root, 'nope', 'child') }))).toBe('NOT_FOUND')
    expect(await code(createDir({ path: 'relative/dir' }))).toBe('NOT_ABSOLUTE')
    expect(await code(createDir(undefined as never))).toBe('BAD_REQUEST')
    expect(await code(createDir('/a/bare/path' as never))).toBe('BAD_REQUEST')
  })

  it('a `.folder.md` already there when the folder\u2019s own is written (the id sweep saw the folder first) ends up holding the folder\u2019s id and title', async () => {
    const p = path.join(root, 'swept-first')
    afterMkdir = (dir) => writeFile(path.join(dir, FOLDER_SETTINGS_FILE), '---\nid: sweptsweptsw\n---\n')
    await createDir({ path: p, title: 'Swept First' })
    expect(await settingsIn(p)).toMatch(/^---\nid: (?!swept)[0-9a-z]{12}\ntitle: Swept First\n---\n$/)
  })
})

describe('createFile', () => {
  it('creates a markdown file holding only its id, and returns path, mtime, size, id (YAZ-2293 D3)', async () => {
    const p = path.join(root, 'NewFolder', 'note.md')
    const body = await createFile(p)
    expect(body.path).toBe(p)
    expect(isNoteId(body.id)).toBe(true)
    expect(await readFile(p, 'utf8')).toBe(`---\nid: ${body.id}\n---\n`)
    expect(body.size).toBe((await stat(p)).size)
    expect(body.mtime).toBeGreaterThan(0)
  })

  it("a folder's hidden settings file is markdown to every door: created, written and read back (YAZ-2290 D1)", async () => {
    const p = path.join(root, 'Empty', FOLDER_SETTINGS_FILE) // a folder made outside the app: it has no file yet
    const created = await createFile(p)
    expect(isNoteId(created.id)).toBe(true) // born with its id like any note: the folder's id (YAZ-2293 D7)
    await writeText({ path: p, content: '---\nfolder_settings: {}\n---\n', expectedMtime: created.mtime })
    expect((await readText(p)).content).toBe('---\nfolder_settings: {}\n---\n')
  })

  it('UNSUPPORTED_EXTENSION for other extensions', async () => {
    expect(await code(createFile(path.join(root, 'note.txt')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(createFile(path.join(root, 'data.json')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(createFile(path.join(root, 'script.py')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(createFile(path.join(root, 'report.pdf')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(createFile(path.join(root, 'Topics.base')))).toBe('UNSUPPORTED_EXTENSION')
  })

  it.each(['existing.json', 'existing.py', 'existing.pdf'])('refuses existing %s before mutation and preserves its bytes', async (name) => {
    const file = path.join(root, name)
    const original = Buffer.from(`original:${name}`)
    await writeFile(file, original)
    expect(await code(createFile({ path: file, content: 'clobber' }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(file)).toEqual(original)
  })

  it('ALREADY_EXISTS and never overwrites', async () => {
    const existing = path.join(root, 'A.md')
    const before = (await stat(existing)).size
    expect(await code(createFile(existing))).toBe('ALREADY_EXISTS')
    expect((await stat(existing)).size).toBe(before)
  })

  it('NOT_FOUND when the parent does not exist, BAD_REQUEST / NOT_ABSOLUTE on bad input', async () => {
    expect(await code(createFile(path.join(root, 'nope', 'x.md')))).toBe('NOT_FOUND')
    expect(await code(createFile('rel.md'))).toBe('NOT_ABSOLUTE')
    expect(await code(createFile(undefined as never))).toBe('BAD_REQUEST')
  })
})

describe('createFile with content (Bible B, GRO-2202)', () => {
  it('creates a markdown file with the given content in the same atomic wx write', async () => {
    const p = path.join(root, 'NewFolder', 'KPI.md')
    const content = '---\npage_type: kpi\nunit:\n---\n'
    const body = await createFile({ path: p, content })
    expect(body.path).toBe(p)
    const written = `---\npage_type: kpi\nunit:\nid: ${body.id}\n---\n`
    expect(await readFile(p, 'utf8')).toBe(written)
    expect(body.size).toBe(Buffer.byteLength(written))
  })

  it('the object form without content creates a note holding only its id', async () => {
    const md = path.join(root, 'NewFolder', 'plain.md')
    const body = await createFile({ path: md })
    expect(await readFile(md, 'utf8')).toBe(`---\nid: ${body.id}\n---\n`)
  })

  it('ALREADY_EXISTS with content never overwrites', async () => {
    const existing = path.join(root, 'A.md')
    const before = await readFile(existing, 'utf8')
    expect(await code(createFile({ path: existing, content: 'clobber' }))).toBe('ALREADY_EXISTS')
    expect(await readFile(existing, 'utf8')).toBe(before)
  })

  it("BAD_REQUEST for a non-string content; path guards still apply to the object form", async () => {
    expect(await code(createFile({ path: path.join(root, 'x.md'), content: 42 as never }))).toBe('BAD_REQUEST')
    expect(await code(createFile({ content: 'x' } as never))).toBe('BAD_REQUEST')
    expect(await code(createFile({ path: 'rel.md', content: 'x' }))).toBe('NOT_ABSOLUTE')
    expect(await code(createFile({ path: path.join(root, 'x.txt'), content: 'x' }))).toBe('UNSUPPORTED_EXTENSION')
  })
})

describe('createFile mints the note id (YAZ-2293 D3)', () => {
  const at = (name: string) => path.join(root, 'NewFolder', name)

  it('a body with no frontmatter gains a block and keeps its bytes', async () => {
    const body = await createFile({ path: at('body-only.md'), content: '# Title\n\ntext\n' })
    expect(await readFile(at('body-only.md'), 'utf8')).toBe(`---\nid: ${body.id}\n---\n# Title\n\ntext\n`)
  })

  it("an id already in the seed (a template's) is replaced, never copied", async () => {
    const body = await createFile({ path: at('from-template.md'), content: '---\nid: k3m9x2pq7abc\nstatus: idea\n---\n' })
    expect(body.id).not.toBe('k3m9x2pq7abc')
    expect(isNoteId(body.id)).toBe(true)
    expect(await readFile(at('from-template.md'), 'utf8')).toBe(`---\nid: ${body.id}\nstatus: idea\n---\n`)
  })

  it('a seed whose frontmatter is not valid YAML is created as given, without an id', async () => {
    const content = '---\nstatus: [unclosed\n---\nbody\n'
    const body = await createFile({ path: at('broken.md'), content })
    expect(body.id).toBeUndefined()
    expect(await readFile(at('broken.md'), 'utf8')).toBe(content)
  })

  it('uses the id the caller hands in; refuses one that is not a note id', async () => {
    const body = await createFile({ path: at('given.md'), id: 'k3m9x2pq7abc' })
    expect(body.id).toBe('k3m9x2pq7abc')
    expect(await readFile(at('given.md'), 'utf8')).toBe('---\nid: k3m9x2pq7abc\n---\n')
    expect(await code(createFile({ path: at('bad-id.md'), id: 'nope' }))).toBe('BAD_REQUEST')
  })
})

describe('a created file can be seen to go (YAZ-2380)', () => {
  it('deleting a note the app created, from outside the app, is announced by the watcher', async () => {
    const seen: string[] = []
    let ready!: () => void
    const listening = new Promise<void>((resolve) => (ready = resolve))
    const off = subscribe(root, (ev) => {
      if (ev.type === 'ready') ready()
      else if ('path' in ev) seen.push(`${ev.type} ${path.basename(ev.path)}`)
    })
    try {
      await listening
      const p = path.join(root, 'NewFolder', 'comes-and-goes.md')
      await createFile(p)
      await vi.waitFor(() => expect(seen).toContain('add comes-and-goes.md'), { timeout: 5000 })
      await rm(p)
      // macOS reports NOTHING for the deletion of a file whose first name was a since-removed hard
      // link, which is how a durable create used to leave it: the index then listed it for good.
      await vi.waitFor(() => expect(seen).toContain('unlink comes-and-goes.md'), { timeout: 5000 })
    } finally {
      off()
    }
  })
})
