import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VaultConfigChange } from '@shared/types'
import { sleep, until } from './fs/testFixture'
import { activeConfigWatcherRoots, subscribeConfig, VAULT_CONFIG_DIR, writeConfig } from './vaultConfig'

/**
 * YAZ-5912: the folder watch (FSEvents on macOS) can be seconds late or say nothing at all when the Mac is busy. Here
 * it is deaf on purpose: a watcher that never announces anything. An outside write to a config file that is already
 * there must still reach the subscribers at once.
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

async function vaultWithPills(): Promise<{ root: string; file: string; changes: VaultConfigChange[] }> {
  const root = await mkdtemp(path.join(tmpdir(), 'yd-5912-'))
  roots.push(root)
  await writeConfig(root, 'link-pills.json', { look: 'plain' })
  const changes: VaultConfigChange[] = []
  offs.push(subscribeConfig(root, (c) => changes.push(c)))
  await sleep(100)
  return { root, file: path.join(root, VAULT_CONFIG_DIR, 'link-pills.json'), changes }
}

describe('YAZ-5912 an outside write to a config file that is there, with the folder watch deaf', () => {
  it('a write in place (a text editor) notifies within 500 ms, every time', async () => {
    const { root, file, changes } = await vaultWithPills()
    for (let i = 1; i <= 3; i++) {
      await writeFile(file, `{ "look": "write-${i}" }\n`)
      await until(() => changes.length >= i, 500)
      expect(changes[i - 1]).toEqual({ root, name: 'link-pills.json' })
    }
  })

  it('a write by rename (an agent: tmp file + rename) notifies within 500 ms, also the second and third time', async () => {
    const { root, file, changes } = await vaultWithPills()
    for (let i = 1; i <= 3; i++) {
      const tmp = `${file}.agent-${i}`
      await writeFile(tmp, `{ "look": "rename-${i}" }\n`)
      await rename(tmp, file)
      await until(() => changes.length >= i, 500)
      expect(changes[i - 1]).toEqual({ root, name: 'link-pills.json' })
    }
    // A tmp file that is not `.json` is never a config: only the three renames notified.
    await sleep(300)
    expect(changes).toHaveLength(3)
  })

  it("the app's own write notifies once; its echo on the file watch is dropped", async () => {
    const { root, changes } = await vaultWithPills()
    await writeConfig(root, 'link-pills.json', { look: 'own' })
    expect(changes).toEqual([{ root, name: 'link-pills.json' }])
    await sleep(400)
    expect(changes).toHaveLength(1)
  })

  it('a new file notifies within 1 s, also in a folder that was not there; a change to it is then heard at once', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'yd-5912-'))
    roots.push(root)
    const changes: VaultConfigChange[] = []
    offs.push(subscribeConfig(root, (c) => changes.push(c)))
    await sleep(100)
    await mkdir(path.join(root, VAULT_CONFIG_DIR))
    const file = path.join(root, VAULT_CONFIG_DIR, 'link-pills.json')
    await writeFile(file, '{ "look": "new" }\n')
    await until(() => changes.length >= 1, 1000)
    expect(changes).toEqual([{ root, name: 'link-pills.json' }])
    await writeFile(file, '{ "look": "changed" }\n')
    await until(() => changes.length >= 2, 500)
    await sleep(700)
    expect(changes).toHaveLength(2)
  })

  it('a delete notifies once', async () => {
    const { root, file, changes } = await vaultWithPills()
    await rm(file)
    await until(() => changes.length >= 1, 500)
    await sleep(300)
    expect(changes).toEqual([{ root, name: 'link-pills.json' }])
  })
})
