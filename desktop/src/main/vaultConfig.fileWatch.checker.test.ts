import { EventEmitter } from 'node:events'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VaultConfigChange } from '@shared/types'
import { sleep, until } from './fs/testFixture'
import { activeConfigWatcherRoots, subscribeConfig, VAULT_CONFIG_DIR, writeConfig } from './vaultConfig'

/**
 * YAZ-5912 (checker, PR #278): more outside writes to a config file, with the folder watch deaf on purpose (FSEvents
 * late or silent, as on a busy Mac). Only the file's own watch and the folder stat may carry them.
 */
vi.mock('./fs/treeWatcher', () => ({
  watchTree: () => {
    const deaf = new EventEmitter() as EventEmitter & { add(): void; close(): Promise<void> }
    deaf.add = () => undefined
    deaf.close = async () => undefined
    return deaf
  },
}))

const roots: string[] = []
const offs: Array<() => void> = []
afterEach(async () => {
  offs.splice(0).forEach((off) => off())
  await until(() => activeConfigWatcherRoots().length === 0)
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })))
})

async function vault(): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-5912c-'))
  roots.push(root)
  await writeConfig(root, 'link-pills.json', { version: 2 })
  return { root, file: path.join(root, VAULT_CONFIG_DIR, 'link-pills.json') }
}

function listen(root: string): VaultConfigChange[] {
  const changes: VaultConfigChange[] = []
  offs.push(subscribeConfig(root, (c) => changes.push(c)))
  return changes
}

describe('YAZ-5912 (checker): outside writes with the folder watch deaf', () => {
  it('six writes in a row, in place and by rename by turns, 150 ms apart: each one is heard within 500 ms, none lost', async () => {
    const { root, file } = await vault()
    const changes = listen(root)
    await sleep(150)
    for (let i = 1; i <= 6; i++) {
      const body = `{ "version": 2, "format": "{name} #${i}" }\n`
      if (i % 2 === 0) {
        await writeFile(`${file}.tmp-${i}`, body)
        await rename(`${file}.tmp-${i}`, file)
      } else await writeFile(file, body)
      await until(() => changes.length >= i, 500)
      await sleep(150)
    }
    expect(changes).toHaveLength(6)
  })

  it('the last subscriber leaves and a new one comes: an outside write is heard again within 500 ms', async () => {
    const { root, file } = await vault()
    const first = listen(root)
    await sleep(150)
    offs.splice(0).forEach((off) => off())
    await until(() => activeConfigWatcherRoots().length === 0)
    expect(first).toHaveLength(0)
    const changes = listen(root)
    await sleep(150)
    await writeFile(file, '{ "version": 2, "format": "{name}" }\n')
    await until(() => changes.length >= 1, 500)
    expect(changes).toEqual([{ root, name: 'link-pills.json' }])
  })

  // BUG YAZ-5931: fails now. The delete closes the file's watch, and the folder stat sees no new name, so the new file
  // is heard only by the folder watch (FSEvents: late or never).
  // An editor or a tool that writes by delete + create (not a rename over the name): the delete is heard; the file that
  // comes back must be heard too, also when both fall between two stats of the folder.
  it.fails('a delete and then a new file of the same name, 50 ms later: both are heard within 1 s', async () => {
    const { root, file } = await vault()
    const changes = listen(root)
    await sleep(700)
    await rm(file)
    await sleep(50)
    await writeFile(file, '{ "version": 2, "format": "{name} (back)" }\n')
    await until(() => changes.length >= 2, 1000).catch(() => undefined)
    expect(changes.length).toBeGreaterThanOrEqual(2)
  })
})
