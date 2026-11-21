/**
 * "Duplicate into <vault>…" (YAZ-5109): the app's copy of the card skill into the top of a vault as `Card skill`. Every
 * file comes, writable, with no `.yaseendocs` and no `.version`; the app's copy stays as it was; a `Card skill` that is
 * there is never written over; `cardSkillFolder` then picks the vault's copy; and the shipped text, duplicated into a
 * vault with IDs, adds no card to the index. Made-up vaults in a temp folder only.
 */
import { statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { setCardSkillVault } from '@shared/appVaults'
import { CARD_SKILL_FOLDER_NAME, cardSkillFolder } from '@shared/cardSkillFolder'
import { CONTRACT } from '@shared/ipc'
import { CARD_SKILL_VERSION_FILE, ensureCardSkill } from './cardSkill'
import { duplicateCardSkill } from './cardSkillDuplicate'
import { registerCardSkillIpc } from './ipc/cardSkill'
import { idsHome, scanFile, walk } from './vaultIndex/scan'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const SHIPPED = fileURLToPath(new URL('../../../skills/card-skill', import.meta.url))

let dir: string
let appCopy: string
let vault: string

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

const mode = async (path: string): Promise<number> => (await stat(path)).mode & 0o777
const isFolder = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yd-card-skill-dup-'))
  const shipped = join(dir, 'shipped')
  await put(shipped, 'Start here.md', '# Start here\n\nThe app copy.\n')
  await put(shipped, 'formats/Concept.md', '# Concept\n')
  await put(shipped, '.yaseendocs/ids.json', '{"enabled":false}\n')
  await put(shipped, '.yaseendocs/read-only.json', '{"on":true}\n')
  // The app's copy as the start makes it: read only on disk, with its `.version`.
  appCopy = await ensureCardSkill(join(dir, 'userData'), shipped, '1.0.0')
  vault = join(dir, 'Demo vault')
  await put(vault, '.yaseendocs/ids.json', '{"enabled":true,"letters":"DEMO"}\n')
  await put(vault, 'Inbox.md', '# Inbox\n')
})
afterEach(async () => {
  setCardSkillVault(null)
  await rm(dir, { recursive: true, force: true })
})

describe('duplicateCardSkill (YAZ-5109)', () => {
  it('copies every page into `<vault>/Card skill`, each writable, with no `.yaseendocs` and no `.version`', async () => {
    expect(await duplicateCardSkill(appCopy, vault)).toEqual({ made: join(vault, CARD_SKILL_FOLDER_NAME) })
    const made = join(vault, CARD_SKILL_FOLDER_NAME)
    const pages = (await filesOf(appCopy)).filter((file) => !file.startsWith('.yaseendocs/') && file !== CARD_SKILL_VERSION_FILE)
    expect(await filesOf(made)).toEqual(pages)
    expect(pages).toEqual(['Start here.md', 'formats/Concept.md'])
    for (const file of pages) {
      expect(await mode(join(made, file)), file).toBe(0o644)
      expect(await readFile(join(made, file), 'utf8')).toBe(await readFile(join(appCopy, file), 'utf8'))
    }
    // The duplicate is a folder of the person's vault, not a vault of its own: its pages get the vault's IDs.
    expect(await idsHome(vault, join(made, 'Start here.md'))).toBe(vault)
    await writeFile(join(made, 'Start here.md'), '# Start here\n\nMy own version.\n')
  })

  it('leaves the app\'s copy as it was: read only, every file there, and the update replaces only it', async () => {
    const before = await filesOf(appCopy)
    await duplicateCardSkill(appCopy, vault)
    expect(await filesOf(appCopy)).toEqual(before)
    expect(await mode(join(appCopy, 'Start here.md'))).toBe(0o444)
  })

  it('a `Card skill` already there: nothing is made and it is not touched; `again` makes `Card skill 2`, then `Card skill 3`', async () => {
    await put(vault, 'Card skill/Start here.md', '# Start here\n\nMine.\n')
    expect(await duplicateCardSkill(appCopy, vault)).toEqual({ exists: join(vault, 'Card skill') })
    expect(await filesOf(join(vault, 'Card skill'))).toEqual(['Start here.md'])
    expect(await readFile(join(vault, 'Card skill', 'Start here.md'), 'utf8')).toBe('# Start here\n\nMine.\n')
    expect(await duplicateCardSkill(appCopy, vault, true)).toEqual({ made: join(vault, 'Card skill 2') })
    expect(await duplicateCardSkill(appCopy, vault, true)).toEqual({ made: join(vault, 'Card skill 3') })
    expect(await readFile(join(vault, 'Card skill', 'Start here.md'), 'utf8')).toBe('# Start here\n\nMine.\n')
  })

  it('from then on `cardSkillFolder` answers the vault\'s copy, and before, the app\'s', async () => {
    expect(cardSkillFolder(vault, appCopy, isFolder)).toBe(appCopy)
    await duplicateCardSkill(appCopy, vault)
    expect(cardSkillFolder(vault, appCopy, isFolder)).toBe(join(vault, CARD_SKILL_FOLDER_NAME))
  })

  it('a copy that is not there is refused, and nothing is made', async () => {
    await expect(duplicateCardSkill(join(dir, 'gone'), vault)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(isFolder(join(vault, CARD_SKILL_FOLDER_NAME))).toBe(false)
  })

  it('the shipped skill, duplicated into a vault with IDs, adds no card to the index', async () => {
    const shippedCopy = await ensureCardSkill(join(dir, 'userData-shipped'), SHIPPED, '1.0.0')
    const { made } = (await duplicateCardSkill(shippedCopy, vault)) as { made: string }
    const pages: string[] = []
    await walk(made, pages)
    expect(pages.length).toBeGreaterThan(3)
    for (const page of pages) expect((await scanFile(vault, page)).cards, page).toBeUndefined()
  })
})

describe('the door `card-skill:duplicate` (YAZ-5109)', () => {
  const handler = () => vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === CONTRACT.cardSkill.duplicate.channel)![1] as (e: unknown, ...args: unknown[]) => Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>
  const register = (roots: string[]) => {
    vi.mocked(ipcMain.handle).mockClear()
    registerCardSkillIpc({ get: () => ({ windows: [{ id: 'w1', roots }], folders: {} }) as never }, { idFor: () => 'w1' })
  }

  it('copies into a vault of the calling window, from the copy main made', async () => {
    setCardSkillVault(appCopy)
    register([vault])
    expect(await handler()({ sender: {} }, vault, false)).toEqual({ ok: true, value: { made: join(vault, CARD_SKILL_FOLDER_NAME) } })
    expect(await handler()({ sender: {} }, vault, false)).toEqual({ ok: true, value: { exists: join(vault, CARD_SKILL_FOLDER_NAME) } })
  })

  it('refuses a folder that is no vault of the window, and answers NOT_FOUND before main made a copy', async () => {
    setCardSkillVault(appCopy)
    register([vault])
    expect(await handler()({ sender: {} }, join(dir, 'other'), false)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    setCardSkillVault(null)
    expect(await handler()({ sender: {} }, vault, false)).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(isFolder(join(vault, CARD_SKILL_FOLDER_NAME))).toBe(false)
  })
})
