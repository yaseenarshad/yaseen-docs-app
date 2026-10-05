import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isNoteId } from '@shared/noteId'
import { FOLDER_SETTINGS_FILE } from '@shared/types'
import { giveId } from '../vaultIndex/idSweep'
import { retitle } from './retitle'
import { failure } from './testFixture'

// A pass-through spy: one test has the id sweep reach a note between retitle's read and `giveId`'s.
vi.mock('../vaultIndex/idSweep', async (importOriginal) => {
  const m = await importOriginal<typeof import('../vaultIndex/idSweep')>()
  return { ...m, giveId: vi.fn(m.giveId) }
})

// The one retitle operation (YAZ-2420 🔒 D16): scenario tables B and C of the decision record.

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-retitle-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

const at = (...p: string[]) => path.join(root, ...p)
const read = (...p: string[]) => readFile(at(...p), 'utf8')
const note = async (rel: string, content: string): Promise<string> => {
  await mkdir(path.dirname(at(rel)), { recursive: true })
  await writeFile(at(rel), content)
  return at(rel)
}

const ID = 'k3m9x2pq7abc'

describe('retitle: a note (table B)', () => {
  it('the title is edited in the app: the `title:` line is written, then the file is renamed to the built name, and the id part does not change', async () => {
    const old = await note('up/abdul-k3m9x2pq7abc.md', `---\nid: ${ID}\ntitle: Abdul\nstatus: new # keep\n---\nbody\n`)
    const newPath = at('up', `up-001-abdul-rehman-r-${ID}.md`)
    expect(await retitle(root, { path: old, title: 'UP-001 - Abdul Rehman R' })).toEqual({ oldPath: old, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe(`---\nid: ${ID}\ntitle: UP-001 - Abdul Rehman R\nstatus: new # keep\n---\nbody\n`)
    expect(await readdir(at('up'))).toEqual([`up-001-abdul-rehman-r-${ID}.md`])
  })

  it('a file made outside the app, on its first title edit: `title:` is written and the file takes the built name (D5)', async () => {
    const old = await note('Plan.md', `---\nid: ${ID}\n---\nbody\n`)
    expect((await retitle(root, { path: old, title: 'Big Plan' })).newPath).toBe(at(`big-plan-${ID}.md`))
    expect(await read(`big-plan-${ID}.md`)).toBe(`---\nid: ${ID}\ntitle: Big Plan\n---\nbody\n`)
  })

  it('a note the app has not given an id yet is given one first, then titled and named like any other (D29)', async () => {
    const old = await note('Plan.md', '---\nstatus: new\n---\nbody\n')
    const { newPath } = await retitle(root, { path: old, title: 'Big Plan' })
    const id = /^id: (.+)$/m.exec(await readFile(newPath, 'utf8'))?.[1]
    expect(isNoteId(id)).toBe(true)
    expect(newPath).toBe(at(`big-plan-${id}.md`))
    expect(await readFile(newPath, 'utf8')).toContain('title: Big Plan\n')
  })

  it('a note with no frontmatter block gets one', async () => {
    const old = await note('Plan.md', 'just a body\n')
    const { newPath } = await retitle(root, { path: old, title: 'Big Plan' })
    expect(await readFile(newPath, 'utf8')).toMatch(/^---\nid: [0-9a-z]{12}\ntitle: Big Plan\n---\njust a body\n$/)
  })

  it('a properties block that does not parse: refused, saying so, and nothing is written or renamed (D24)', async () => {
    const broken = '---\nid: [unclosed\n---\nbody\n'
    const old = await note('Plan.md', broken)
    const err = await failure(retitle(root, { path: old, title: 'Big Plan' }))
    expect(err.message).toBe("this note's properties do not parse")
    expect(await read('Plan.md')).toBe(broken)
    expect(await readdir(root)).toEqual(['Plan.md'])
  })

  it('a note that changes on disk as it is given its id: refused, and nothing is written or renamed', async () => {
    const old = await note('Plan.md', '---\nstatus: new\n---\n')
    const swept = `---\nstatus: new\nid: ${ID}\n---\n`
    const real = vi.mocked(giveId).getMockImplementation()!
    vi.mocked(giveId).mockImplementationOnce(async (...args) => {
      await writeFile(old, swept)
      return real(...args)
    })
    const err = await failure(retitle(root, { path: old, title: 'Big Plan' }))
    expect(err.code).toBe('CONFLICT')
    expect(await read('Plan.md')).toBe(swept)
    expect(await readdir(root)).toEqual(['Plan.md'])
  })

  it('a title edit that gives the same kebab-case (a capital letter, a comma): only the `title:` line changes, the file is not renamed', async () => {
    const old = await note(`big-plan-${ID}.md`, `---\nid: ${ID}\ntitle: big plan\n---\n`)
    expect(await retitle(root, { path: old, title: 'Big, Plan' })).toEqual({ oldPath: old, newPath: old, kind: 'file' })
    expect(await read(`big-plan-${ID}.md`)).toBe(`---\nid: ${ID}\ntitle: Big, Plan\n---\n`)
  })

  it('the rename fails after the title was written: the title is right, the file name is stale, and the error is reported', async () => {
    const old = await note('Plan.md', `---\nid: ${ID}\n---\n`)
    await note(`big-plan-${ID}.md`, 'in the way\n')
    expect((await failure(retitle(root, { path: old, title: 'Big Plan' }))).code).toBe('ALREADY_EXISTS')
    expect(await read('Plan.md')).toBe(`---\nid: ${ID}\ntitle: Big Plan\n---\n`)
    expect(await read(`big-plan-${ID}.md`)).toBe('in the way\n')
  })

  it.each(['', '   '])('an empty title (%j) is not accepted: nothing changes', async (title) => {
    const old = await note('Plan.md', `---\nid: ${ID}\n---\n`)
    expect((await failure(retitle(root, { path: old, title }))).code).toBe('BAD_REQUEST')
    expect(await read('Plan.md')).toBe(`---\nid: ${ID}\n---\n`)
  })

  it('a title containing `/`, `:`, `?` or quotes is allowed: the title is free text', async () => {
    const old = await note('Plan.md', `---\nid: ${ID}\n---\n`)
    const { newPath } = await retitle(root, { path: old, title: 'Q3/Q4: "what now"?' })
    expect(newPath).toBe(at(`q3-q4-what-now-${ID}.md`))
    expect(await readFile(newPath, 'utf8')).toBe(`---\nid: ${ID}\ntitle: 'Q3/Q4: "what now"?'\n---\n`)
  })

  it('a note title with no letter or digit: the file is the id alone', async () => {
    const old = await note('Plan.md', `---\nid: ${ID}\n---\n`)
    expect((await retitle(root, { path: old, title: '—' })).newPath).toBe(at(`${ID}.md`))
  })

  it.each(['report.pdf', 'photo.png', 'notes.txt'])('%s is not retitled: it has no title, and it is left as it is', async (name) => {
    const old = await note(name, 'bytes')
    expect((await failure(retitle(root, { path: old, title: 'Big Plan' }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect(await readdir(root)).toEqual([name])
    expect(await read(name)).toBe('bytes')
  })
})

describe('retitle: a folder (table C)', () => {
  const FOLDER_ID = 'a1b2c3d4e5f6'

  it('a folder renamed in the app: the `title:` line in its `.folder.md` is written, then the folder is renamed, and nothing inside it is renamed', async () => {
    await note(`upwork/${FOLDER_SETTINGS_FILE}`, `---\nid: ${FOLDER_ID}\ntitle: Upwork\n---\n`)
    await note(`upwork/abdul-${ID}.md`, `---\nid: ${ID}\n---\n`)
    expect(await retitle(root, { path: at('upwork'), title: 'Upwork 2026' })).toEqual({ oldPath: at('upwork'), newPath: at('upwork-2026'), kind: 'dir' })
    expect(await read('upwork-2026', FOLDER_SETTINGS_FILE)).toBe(`---\nid: ${FOLDER_ID}\ntitle: Upwork 2026\n---\n`)
    expect((await readdir(at('upwork-2026'))).sort()).toEqual([FOLDER_SETTINGS_FILE, `abdul-${ID}.md`])
    expect(await readdir(root)).toEqual(['upwork-2026'])
  })

  it('a folder whose `.folder.md` is missing: the retitle creates it', async () => {
    await mkdir(at('Old Name'))
    expect((await retitle(root, { path: at('Old Name'), title: 'Upwork 2026' })).newPath).toBe(at('upwork-2026'))
    expect(await read('upwork-2026', FOLDER_SETTINGS_FILE)).toBe('---\ntitle: Upwork 2026\n---\n')
  })

  it('a new title that gives the same kebab-case: only the `title:` line changes', async () => {
    await note(`candidates/${FOLDER_SETTINGS_FILE}`, `---\nid: ${FOLDER_ID}\n---\n`)
    expect(await retitle(root, { path: at('candidates'), title: 'Candidates!' })).toEqual({ oldPath: at('candidates'), newPath: at('candidates'), kind: 'dir' })
    expect(await read('candidates', FOLDER_SETTINGS_FILE)).toBe(`---\nid: ${FOLDER_ID}\ntitle: Candidates!\n---\n`)
  })

  it('a dated folder: `10_04- Standup` is `10-04-standup/`', async () => {
    await mkdir(at('Old'))
    expect((await retitle(root, { path: at('Old'), title: '10_04- Standup' })).newPath).toBe(at('10-04-standup'))
  })

  it('a folder title with no letter or digit: refused before anything is written (D25)', async () => {
    await mkdir(at('upwork'))
    expect((await failure(retitle(root, { path: at('upwork'), title: '—' }))).code).toBe('BAD_REQUEST')
    expect(await readdir(at('upwork'))).toEqual([])
  })

  it('a title whose kebab-case another folder beside it already has: refused, and the title is not left written (D25)', async () => {
    await note(`upwork/${FOLDER_SETTINGS_FILE}`, `---\nid: ${FOLDER_ID}\ntitle: Upwork\n---\n`)
    await mkdir(at('upwork-2026'))
    const err = await failure(retitle(root, { path: at('upwork'), title: 'Upwork 2026' }))
    expect(err.code).toBe('ALREADY_EXISTS')
    expect(await read('upwork', FOLDER_SETTINGS_FILE)).toBe(`---\nid: ${FOLDER_ID}\ntitle: Upwork\n---\n`)
    expect(await readdir(at('upwork-2026'))).toEqual([])
  })

  it('a `.folder.md` whose properties do not parse: refused, and nothing is written or renamed (D24)', async () => {
    await note(`upwork/${FOLDER_SETTINGS_FILE}`, '---\nid: [unclosed\n---\n')
    expect((await failure(retitle(root, { path: at('upwork'), title: 'Upwork 2026' }))).message).toBe("this folder's settings do not parse")
    expect(await read('upwork', FOLDER_SETTINGS_FILE)).toBe('---\nid: [unclosed\n---\n')
    expect(await readdir(root)).toEqual(['upwork'])
  })

  it("the vault's top-level folder is untouched: retitling the root is refused", async () => {
    expect((await failure(retitle(root, { path: root, title: 'Vault' }))).code).toBe('BAD_REQUEST')
    expect(await readdir(root)).toEqual([])
  })
})
