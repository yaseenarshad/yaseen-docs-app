/** The `app:card-formats` door (YAZ-5114): the `formats` folder of the card skill a vault uses, and its names. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { CONTRACT } from '@shared/ipc'
import { cardFormatNames } from '@shared/cardSkillFolder'
import { cardSkillFormats, registerCardFormatsIpc } from './cardFormats'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

let dir: string
let userData: string
let vault: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'yd-card-formats-'))
  userData = join(dir, 'profile')
  vault = join(dir, 'Demo vault')
  await mkdir(join(userData, 'card-skill', 'formats'), { recursive: true })
  for (const name of ['vocabulary.md', 'acronym.md', 'Book.md', 'concept.md', '.DS_Store', 'notes.txt']) await writeFile(join(userData, 'card-skill', 'formats', name), 'x')
  await mkdir(vault, { recursive: true })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the format names (YAZ-5114)', () => {
  it('each `.md` page without `.md`, A to Z with no case; dot files and other files left out', () => {
    expect(cardFormatNames(['vocabulary.md', 'acronym.md', 'Book.md', '.hidden.md', 'notes.txt', 'script and sounds.md'])).toEqual(['acronym', 'Book', 'script and sounds', 'vocabulary'])
    expect(cardFormatNames([])).toEqual([])
  })
})

describe('cardSkillFormats (YAZ-5114, suggestion 18)', () => {
  it('a vault with no `Card skill` folder uses the app`s copy', async () => {
    expect(await cardSkillFormats(vault, userData)).toEqual({ folder: join(userData, 'card-skill', 'formats'), formats: ['acronym', 'Book', 'concept', 'vocabulary'] })
    expect(await cardSkillFormats(null, userData)).toEqual({ folder: join(userData, 'card-skill', 'formats'), formats: ['acronym', 'Book', 'concept', 'vocabulary'] })
  })

  it('the vault`s own `Card skill` wins, with its own formats', async () => {
    await mkdir(join(vault, 'Card skill', 'formats'), { recursive: true })
    await writeFile(join(vault, 'Card skill', 'formats', 'recipe.md'), 'x')
    expect(await cardSkillFormats(vault, userData)).toEqual({ folder: join(vault, 'Card skill', 'formats'), formats: ['recipe'] })
  })

  it('a skill with no `formats` folder: null (no hint); an app copy not made yet: null', async () => {
    await mkdir(join(vault, 'Card skill'), { recursive: true })
    expect(await cardSkillFormats(vault, userData)).toBeNull()
    expect(await cardSkillFormats(null, join(dir, 'no profile'))).toBeNull()
  })

  it('the door answers through the envelope; a vault that is not a string is the app`s copy', async () => {
    registerCardFormatsIpc(userData)
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === CONTRACT.app.cardFormats.channel)
    const run = call?.[1] as unknown as (e: unknown, ...args: unknown[]) => Promise<unknown>
    expect(await run({ sender: {} }, 42)).toEqual({ ok: true, value: { folder: join(userData, 'card-skill', 'formats'), formats: ['acronym', 'Book', 'concept', 'vocabulary'] } })
  })
})
