// Checker (YAZ-4520 round 1): asset.write content validation and the icon-pack removal confirm.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { commandDefinition } from '@shared/automationCommands'
import { assetCommand } from './assets'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'checker-assets-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('refuses to save an embedded drawing asset that is not a drawing scene, as drawing.save does', async () => {
  const path = join(root, 'assets/Broken.excalidraw')
  await expect(assetCommand(defaultAppState(), 'asset.write', { root, path, revision: null }, Buffer.from('not json'))).rejects.toMatchObject({ code: expect.any(String) })
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('media.removePacks needs an explicit confirmation input in place of the app’s Remove sheet', () => {
  expect(commandDefinition('media.removePacks').input.required ?? []).toContain('confirm')
})
