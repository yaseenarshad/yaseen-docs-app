/**
 * The main process's disk for the page rules (YAZ-4269 D1): `@shared/pageBirth` over `main/fs` and the vault's door,
 * on real temp vaults. The same page the app's "New page" makes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { IDS_FILE } from '@shared/pageId'
import { createPage } from '@shared/pageBirth'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { pageDisk } from './disk'

let dir: string
beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'yaz-4269-disk-')))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A vault holding a `projects/` folder with a template; it gives IDs with the letters YAZ, or says no. */
async function vault(ids: boolean): Promise<string> {
  const root = path.join(dir, ids ? 'ids' : 'plain')
  await mkdir(path.join(root, VAULT_CONFIG_DIR), { recursive: true })
  await writeFile(path.join(root, VAULT_CONFIG_DIR, IDS_FILE), JSON.stringify(ids ? { enabled: true, letters: 'YAZ' } : { enabled: false }))
  await mkdir(path.join(root, 'projects'))
  await writeFile(path.join(root, 'projects', '.template.md'), '---\nstatus: todo\n---\n## Plan\n')
  return root
}

describe('pageDisk', () => {
  it('a vault with IDs: the page is `<kebab-title>-<id>.md`, from its template, titled and with its id; a second gets the next number', async () => {
    const root = await vault(true)
    const { disk, ids } = await pageDisk(root)
    expect(ids).toBe(true)

    const first = await createPage(disk, path.join(root, 'projects'), 'Gym plan', ids)
    const second = await createPage(disk, path.join(root, 'projects'), 'Gym plan', ids)

    expect(first).toBe(path.join(root, 'projects', 'gym-plan-yaz-1.md'))
    expect(second).toBe(path.join(root, 'projects', 'gym-plan-yaz-2.md'))
    expect(await readFile(first, 'utf8')).toBe('---\nstatus: todo\ntitle: Gym plan\nid: YAZ-1\n---\n## Plan\n')
  })

  it('a vault without IDs: the file is named by the title, the template as it is; one that is there is refused as `isThere`', async () => {
    const root = await vault(false)
    const { disk, ids } = await pageDisk(null)
    expect(ids).toBe(false)

    const made = await createPage(disk, path.join(root, 'projects'), 'Gym plan', ids)
    expect(made).toBe(path.join(root, 'projects', 'Gym plan.md'))
    expect(await readFile(made, 'utf8')).toBe('---\nstatus: todo\n---\n## Plan\n')

    const again = await createPage(disk, path.join(root, 'projects'), 'Gym plan', ids).catch((err: unknown) => err)
    expect(disk.isThere(again)).toBe(true)
  })

  it('a folder with no template: the page holds only its title and id', async () => {
    const root = await vault(true)
    const { disk } = await pageDisk(root)

    const made = await createPage(disk, root, 'Inbox', true)

    expect(await readFile(made, 'utf8')).toBe('---\ntitle: Inbox\nid: YAZ-1\n---\n')
  })
})
