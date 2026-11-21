import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { vaultFiles } from './testFixture'

describe('vaultFiles', () => {
  let dir = ''
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('leaves out a save in flight: the `.tmp-<hex>` sibling that `atomicWrite` renames away (a CI read of it failed with ENOENT)', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'vault-files-'))
    await writeFile(path.join(dir, 'Name.md'), 'kept')
    await writeFile(path.join(dir, 'Name.md.tmp-0123456789ab'), 'in flight')
    expect(await vaultFiles(dir)).toEqual({ 'Name.md': 'kept' })
  })
})
