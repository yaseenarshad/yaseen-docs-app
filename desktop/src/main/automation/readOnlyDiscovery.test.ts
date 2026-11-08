// YAZ-4518 hard rule: read-only discovery never starts ID assignment. Every read command of the folder
// page and ID units runs through the public dispatcher on two temp vaults, and no file, mtime, or count
// file changes. A control then shows the same vault does take IDs once the app's own index opens it.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTOMATION_COMMANDS } from '@shared/automationCommands'
import { defaultAppState } from '@shared/types'
import { makeFirstMac, removeVault, vaultFiles } from '../fs/testFixture'
import { _evictAll, getIndex } from '../vaultIndex/live'
import { prepareAutomation } from '../automation'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docs-cli-readonly-'))
  await mkdir(join(root, 'Projects/Deep'), { recursive: true })
  await writeFile(join(root, 'a.md'), '---\ntitle: A\n---\n[[b]]\n')
  await writeFile(join(root, 'Projects/b.md'), '# b\n')
  await writeFile(join(root, 'Projects/Deep/c.md'), '---\nid: other-tool-7\n---\n')
})
afterEach(async () => { _evictAll(); await removeVault(root) })

const READS = ['folder.read', 'ids.state', 'shortcut.list']
const snapshot = async () => {
  const files = await vaultFiles(root)
  const times = await Promise.all((await readdir(root, { recursive: true })).map(async rel => [rel, (await stat(join(root, rel))).mtimeMs] as const))
  return { files, times: Object.fromEntries(times) }
}
async function readEverything() {
  const unit = AUTOMATION_COMMANDS.filter(command => /^(folder|folderView|shortcut|ids)\./.test(command.name) && command.effect === 'read').map(command => command.name)
  expect(unit.sort()).toEqual(READS)
  // The write services are absent: a read that reached one would fail here.
  const context = { profile: '/profile', version: 'test', state: defaultAppState, services: { idChanges: {} } as never }
  for (const path of [root, join(root, 'Projects'), join(root, 'Projects/Deep')]) {
    for (const command of READS) {
      const args = command === 'ids.state' ? { root } : { root, path }
      // A refusal (no IDs for shortcuts) is still a read: it must write nothing either.
      await prepareAutomation(context, { command, args } as never, Buffer.alloc(0)).run().catch((error: { code?: string }) => expect(error.code, String(error)).toBe('IDS_OFF'))
    }
  }
  await new Promise(done => setTimeout(done, 300))
}

it('reads a vault that never answered without writing or minting anything', async () => {
  const before = await snapshot()
  await readEverything()
  expect(await snapshot()).toEqual(before)
})

it('reads a vault that uses IDs, with notes and folders still lacking them, without starting assignment', async () => {
  await mkdir(join(root, '.yaseendocs'))
  await writeFile(join(root, '.yaseendocs/ids.json'), JSON.stringify({ enabled: true, letters: 'TST' }))
  // This Mac is the vault's first: a writable index would number the files at once.
  await makeFirstMac(root)
  const before = await snapshot()
  await readEverything()
  expect(await snapshot()).toEqual(before)
  // Control: the app's own index of the same vault gives the IDs, so the check above can see a write.
  await getIndex(root)
  await expect.poll(async () => (await vaultFiles(root))['Projects/.folder.md'], { timeout: 10_000 }).toMatch(/id: TST-\d+/)
})
