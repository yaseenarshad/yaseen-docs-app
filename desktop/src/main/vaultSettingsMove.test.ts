import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { VAULT_CONFIG_DIR } from '@shared/types'
import { createStore, type Store } from './store'
import { PAGE_SPACING_MOVE } from './textFormattingMove'
import { moveSettingsIntoVaults } from './vaultSettingsMove'

let dir: string
let roRoot: string
let rwRoot: string
let store: Store

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-vault-move-'))
  roRoot = await mkdtemp(path.join(tmpdir(), 'yd-ro-repo-'))
  rwRoot = await mkdtemp(path.join(tmpdir(), 'yd-rw-repo-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  // Non-default setting so PAGE_SPACING_MOVE would normally create `.yaseendocs/text-formatting.json`.
  store.setSettings({ ...store.get().settings, lineSpacing: 1.8 })
})

afterEach(async () => {
  await store.flush()
  await rm(dir, { recursive: true, force: true })
  await rm(roRoot, { recursive: true, force: true })
  await rm(rwRoot, { recursive: true, force: true })
})

describe('moveSettingsIntoVaults: transient read-only roots (YAZ-4502)', () => {
  it('never creates .yaseendocs/ in a transient read-only root while still seeding writable roots', async () => {
    const readOnlyRoots = new Set([roRoot])
    const moves = moveSettingsIntoVaults(
      store,
      [PAGE_SPACING_MOVE],
      async (root) => !readOnlyRoots.has(root),
      (root) => readOnlyRoots.has(root),
    )

    store.upsertWindow({
      id: 'w-ro',
      root: roRoot,
      roots: [roRoot],
      file: null,
      tabs: [],
      sidebarCollapsed: false,
      sidebarLens: 'files',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })
    store.upsertWindow({
      id: 'w-rw',
      root: rwRoot,
      roots: [rwRoot],
      file: null,
      tabs: [],
      sidebarCollapsed: false,
      sidebarLens: 'files',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    })

    await moves.idle()
    moves.stop()

    // Transient read-only root has ZERO .yaseendocs/ directory created.
    await expect(stat(path.join(roRoot, VAULT_CONFIG_DIR))).rejects.toMatchObject({ code: 'ENOENT' })
    // Writable root received the seeded config as expected.
    expect((await stat(path.join(rwRoot, VAULT_CONFIG_DIR, 'text-formatting.json'))).isFile()).toBe(true)
  })
})
