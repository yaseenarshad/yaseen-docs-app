import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState, MAX_FILE_BYTES } from '@shared/types'
import { assetCommand } from './assets'
import type { LiveEdits } from './liveEdits'
import { readAssetFile, writeAsset } from '../fs/assets'
import { checked } from './contract'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-cli-assets-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const run = (command: string, path: string, extra: Record<string, unknown> = {}, body = Buffer.alloc(0), liveEdits?: LiveEdits) => checked(command, assetCommand(defaultAppState(), command, { root, path, ...extra }, body, liveEdits))

it('creates binary assets exclusively, reads exact special-character paths, and exports byte-for-byte', async () => {
  const path = join(root, 'assets/Picture#1.png'), bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 42, 128])
  expect(await run('asset.write', path, { revision: null }, bytes)).toMatchObject({ diskSaved: true, revision: expect.any(String) })
  expect(await run('asset.read', path)).toMatchObject({ path, data: bytes.toString('base64'), source: 'disk', encoding: 'base64' })
  await expect(run('asset.write', path, { revision: null }, Buffer.from('GIF89a replace'))).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
  const outputFile = join(root, 'Export.png')
  await run('asset.export', path, { outputFile })
  expect((await readFile(outputFile)).equals(bytes)).toBe(true)
  await expect(run('asset.export', path, { outputFile })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
})
it('rejects stale same-mtime content and serializes UI and CLI writes at the shared asset boundary', async () => {
  const path = join(root, 'Image.png')
  await writeFile(path, 'before'); await utimes(path, 1_700_000_000, 1_700_000_000)
  const old = await readAssetFile(path, true)
  await writeFile(path, 'human!'); await utimes(path, 1_700_000_000, 1_700_000_000)
  await expect(run('asset.write', path, { revision: old.revision }, Buffer.from('GIF89a agent'))).rejects.toMatchObject({ code: 'CONFLICT' })
  const current = await readAssetFile(path, true)
  const results = await Promise.allSettled([
    writeAsset({ root, path, content: Buffer.from('GIF89a UI'), expectedMtime: current.mtime }),
    run('asset.write', path, { revision: current.revision }, Buffer.from('GIF89a CLI')),
  ])
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  expect(results[1]).toMatchObject({ reason: { code: 'CONFLICT' } })
  expect(await readFile(path, 'utf8')).toBe('GIF89a UI')
})
it('retains binary viewer limits separately from the smaller asset limit', async () => {
  const path = join(root, 'Large.png'), bytes = Buffer.alloc(MAX_FILE_BYTES + 1)
  await writeFile(path, bytes)
  await expect(run('asset.read', path)).rejects.toMatchObject({ code: 'TOO_LARGE' })
  const outputFile = join(root, 'Copy.png')
  expect(await run('image.export', path, { outputFile })).toMatchObject({ size: bytes.length, diskSaved: true })
  expect((await readFile(outputFile)).equals(bytes)).toBe(true)
})
it('keeps drawing sidecars textual and rejects other file kinds and out-of-scope writes', async () => {
  const path = join(root, 'Sidecar.excalidraw'), bytes = Buffer.from('{"type":"excalidraw","elements":[]}')
  await run('asset.write', path, { revision: null }, bytes)
  expect(await readFile(path)).toEqual(bytes)
  await expect(run('asset.write', join(root, 'Bad.md'), { revision: null }, bytes)).rejects.toMatchObject({ code: 'UNSUPPORTED_EXTENSION' })
  await expect(run('asset.write', join(root, '../Outside.png'), { revision: null }, bytes)).rejects.toMatchObject({ code: 'OUTSIDE_SCOPE' })
})
it('YAZ-4515: refuses to replace an embedded drawing asset while a live editor holds unsaved edits of it', async () => {
  const path = join(root, 'assets/Embed.excalidraw'), scene = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })
  const created = await run('asset.write', path, { revision: null }, Buffer.from(scene)) as { revision: string }
  const liveEdits: LiveEdits = async target => target === path ? [{ window: 'w1', path, tabs: ['t1'] }] : []
  await expect(run('asset.write', path, { revision: created.revision }, Buffer.from(scene.replace('[]', '[{}]')), liveEdits)).rejects.toMatchObject({ code: 'UNSAVED_LIVE_EDITS', details: { open: [{ window: 'w1', tabs: ['t1'] }] } })
  expect(await readFile(path, 'utf8')).toBe(scene)
  expect(await run('asset.write', path, { revision: created.revision }, Buffer.from(scene), async () => [])).toMatchObject({ diskSaved: true })
})
