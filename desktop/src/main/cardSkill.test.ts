/**
 * The card skill's copy in the profile (YAZ-5107): made at the first start, kept while the version is the same, made
 * again whole when the version changes or a file is missing, and read only on disk.
 */
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CARD_SKILL_VERSION_FILE, cardSkillStamp, ensureCardSkill, shippedCardSkill } from './cardSkill'

let dir: string
let shipped: string
let userData: string

const put = async (root: string, rel: string, body: string): Promise<void> => {
  await mkdir(dirname(join(root, rel)), { recursive: true })
  await writeFile(join(root, rel), body)
}

/** Every file under `root`, by its path from `root` with `/`. */
async function filesOf(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await filesOf(root, path)))
    else out.push(path)
  }
  return out.sort()
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yd-card-skill-'))
  shipped = join(dir, 'shipped')
  userData = join(dir, 'userData')
  await mkdir(userData)
  await put(shipped, 'Start here.md', '# Start here\n')
  await put(shipped, 'formats/Acronym.md', '# Acronym\n')
  await put(shipped, '.yaseendocs/ids.json', '{"enabled":false}\n')
  await put(shipped, '.yaseendocs/read-only.json', '{"on":true}\n')
})

afterEach(async () => {
  // The copy's files are read only: make them writable, so the temp folder can go on every system.
  const copy = join(userData, 'card-skill')
  for (const file of await filesOf(copy).catch(() => [])) await chmod(join(copy, file), 0o644)
  await rm(dir, { recursive: true, force: true })
})

describe('shippedCardSkill', () => {
  it('is Resources/card-skill in the app, and skills/card-skill in a checkout', () => {
    expect(shippedCardSkill({ isPackaged: true, resourcesPath: '/A.app/Contents/Resources', mainDir: '/x' })).toBe(join('/A.app/Contents/Resources', 'card-skill'))
    expect(shippedCardSkill({ isPackaged: false, resourcesPath: '', mainDir: '/repo/desktop/out/main' })).toBe(join('/repo', 'skills', 'card-skill'))
  })
})

describe('ensureCardSkill', () => {
  it('at the first start makes <userData>/card-skill with the shipped files and the version', async () => {
    const copy = await ensureCardSkill(userData, shipped, '2.18.0')
    expect(copy).toBe(join(userData, 'card-skill'))
    expect(await filesOf(copy)).toEqual([...(await filesOf(shipped)), CARD_SKILL_VERSION_FILE].sort())
    for (const file of await filesOf(shipped)) expect(await readFile(join(copy, file), 'utf8')).toBe(await readFile(join(shipped, file), 'utf8'))
    expect(await readFile(join(copy, CARD_SKILL_VERSION_FILE), 'utf8')).toBe('2.18.0')
    // Nothing is left beside it.
    expect(await readdir(userData)).toEqual(['card-skill'])
  })

  it('makes each file of the copy read only on disk', async () => {
    const copy = await ensureCardSkill(userData, shipped, '2.18.0')
    for (const file of await filesOf(copy)) expect((await stat(join(copy, file))).mode & 0o222).toBe(0)
  })

  it('with the same version writes no file', async () => {
    const copy = await ensureCardSkill(userData, shipped, '2.18.0')
    const before = await Promise.all((await filesOf(copy)).map(async (f) => [f, (await stat(join(copy, f))).mtimeMs, (await stat(join(copy, f))).ino]))
    const folder = (await stat(copy)).ino
    await new Promise((done) => setTimeout(done, 20))
    await ensureCardSkill(userData, shipped, '2.18.0')
    const after = await Promise.all((await filesOf(copy)).map(async (f) => [f, (await stat(join(copy, f))).mtimeMs, (await stat(join(copy, f))).ino]))
    expect(after).toEqual(before)
    expect((await stat(copy)).ino).toBe(folder)
  })

  it('with a new version replaces the copy whole: a file the user added is gone', async () => {
    const copy = await ensureCardSkill(userData, shipped, '2.18.0')
    await writeFile(join(copy, 'Mine.md'), 'my own page\n')
    await chmod(join(copy, 'Start here.md'), 0o644)
    await writeFile(join(copy, 'Start here.md'), 'changed by hand\n')
    await put(shipped, 'formats/Book.md', '# Book\n')
    await ensureCardSkill(userData, shipped, '2.19.0')
    expect(await filesOf(copy)).toEqual([...(await filesOf(shipped)), CARD_SKILL_VERSION_FILE].sort())
    expect(await readFile(join(copy, 'Start here.md'), 'utf8')).toBe('# Start here\n')
    expect(await readFile(join(copy, CARD_SKILL_VERSION_FILE), 'utf8')).toBe('2.19.0')
  })

  it('makes the copy again when its .version is missing', async () => {
    const copy = await ensureCardSkill(userData, shipped, '2.18.0')
    await rm(join(copy, CARD_SKILL_VERSION_FILE), { force: true })
    await writeFile(join(copy, 'Mine.md'), 'my own page\n')
    await ensureCardSkill(userData, shipped, '2.18.0')
    expect(await filesOf(copy)).toEqual([...(await filesOf(shipped)), CARD_SKILL_VERSION_FILE].sort())
  })

  it('makes the copy again when a shipped file is missing from it', async () => {
    const copy = await ensureCardSkill(userData, shipped, '2.18.0')
    await rm(join(copy, 'formats', 'Acronym.md'), { force: true })
    await ensureCardSkill(userData, shipped, '2.18.0')
    expect(await readFile(join(copy, 'formats', 'Acronym.md'), 'utf8')).toBe('# Acronym\n')
  })

  it('refuses a shipped folder that is not there, and leaves the copy as it was', async () => {
    const copy = await ensureCardSkill(userData, shipped, '2.18.0')
    await expect(ensureCardSkill(userData, join(dir, 'nowhere'), '2.19.0')).rejects.toThrow()
    expect(await readFile(join(copy, CARD_SKILL_VERSION_FILE), 'utf8')).toBe('2.18.0')
  })
})

describe('cardSkillStamp', () => {
  it('a checkout: the version and a hash of the shipped files, which changes with a file', async () => {
    const one = await cardSkillStamp(shipped, '2.18.0')
    expect(one).toMatch(/^2\.18\.0\+dev\.[0-9a-f]{12}$/)
    expect(await cardSkillStamp(shipped, '2.18.0')).toBe(one)
    await put(shipped, 'Start here.md', '# Start here, new text\n')
    expect(await cardSkillStamp(shipped, '2.18.0')).not.toBe(one)
  })
})
