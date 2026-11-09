import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, truncate, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { EMPTY_DIAGRAM_XML } from '@shared/diagramFile'
import { boardCommand } from './boards'
import type { LiveEdits } from './liveEdits'
import { saveDrawingIndexed } from '../documentSaves'
import { _actAs, _resetMint } from '../vaultIndex/mint'
import { checked } from './contract'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-cli-board-')); _actAs(root, join(root, 'profile')) })
afterEach(async () => { _resetMint(); await rm(root, { recursive: true, force: true }) })
const scene = JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements: [], appState: {}, files: {} })
const run = (kind: string, action: string, path: string, extra: Record<string, unknown> = {}, body = '', liveEdits?: LiveEdits) => checked(`${kind}.${action}`, boardCommand(defaultAppState(), `${kind}.${action}`, { root, path, ...extra }, Buffer.from(body), undefined, liveEdits))

describe('board CLI adapters', () => {
  it.each([['drawing', 'excalidraw'], ['diagram', 'drawio']])('creates a valid %s without replacing an existing board', async (kind, extension) => {
    const path = join(root, `New.${extension}`)
    expect(await run(kind, 'create', path)).toMatchObject({ path, diskSaved: true })
    expect(await run(kind, 'read', path)).toMatchObject({ revision: expect.any(String), source: 'disk' })
    await expect(run(kind, 'create', path)).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
  })
  it.each([
    ['setReadOnly', { on: true }], ['setHoverLinks', { on: false }],
    ['setHoverOutline', { value: false }], ['setFoldArrows', { value: 'off' }], ['setPictures', { out: true }],
  ])('guards %s against same-mtime outside changes', async (action, option) => {
    const path = join(root, 'Board.excalidraw')
    await writeFile(path, scene); await utimes(path, 1_700_000_000, 1_700_000_000)
    const before = await run('drawing', 'read', path)
    await writeFile(path, scene.replace('test', 'outside')); await utimes(path, 1_700_000_000, 1_700_000_000)
    await expect(run('drawing', action, path, { revision: before.revision, ...option })).rejects.toMatchObject({ code: 'CONFLICT' })
    const latest = await run('drawing', 'read', path)
    expect(await run('drawing', action, path, { revision: latest.revision, ...option })).toMatchObject({ path, diskSaved: true, rendererMerged: false })
  })

  it.each([['drawing', 'excalidraw', scene], ['diagram', 'drawio', EMPTY_DIAGRAM_XML]])('reads and revision-guards %s saves through the format service', async (kind, extension, content) => {
    const path = join(root, `Board.${extension}`)
    await writeFile(path, content)
    await utimes(path, 1_700_000_000, 1_700_000_000)
    const before = await run(kind, 'read', path)
    expect(before).toMatchObject({ source: 'disk', revision: expect.any(String) })
    const changed = kind === 'drawing' ? content.replace('test', 'changed') : content.replace('<mxfile', '<mxfile agent="changed"')
    await writeFile(path, changed)
    await utimes(path, 1_700_000_000, 1_700_000_000)
    await expect(run(kind, 'save', path, { revision: before.revision }, content)).rejects.toMatchObject({ code: 'CONFLICT' })
    const latest = await run(kind, 'read', path)
    const sourceFile = join(root, 'input.txt')
    await writeFile(sourceFile, content)
    const saved = await run(kind, 'save', path, { revision: latest.revision, sourceFile })
    expect(saved).toMatchObject({ diskSaved: true, rendererMerged: false, revision: expect.any(String) })
    expect((await run(kind, 'read', path)).revision).toBe(saved.revision)
  })
  it('exports a standalone saved drawing and refuses to replace an existing destination', async () => {
    const path = join(root, 'Board.excalidraw'), outputFile = join(root, 'Export.excalidraw')
    await writeFile(path, scene)
    await run('drawing', 'export', path, { outputFile })
    expect(JSON.parse(await readFile(outputFile, 'utf8'))).toMatchObject({ type: 'excalidraw', elements: [], files: {} })
    await expect(run('drawing', 'export', path, { outputFile })).rejects.toMatchObject({ code: 'ALREADY_EXISTS' })
    expect(await readFile(path, 'utf8')).toBe(scene)
  })
  it('serializes two saves from the same revision so exactly one wins', async () => {
    const path = join(root, 'Board.excalidraw')
    await writeFile(path, scene)
    const before = await run('drawing', 'read', path)
    const results = await Promise.allSettled([run('drawing', 'save', path, { revision: before.revision }, scene), run('drawing', 'save', path, { revision: before.revision }, scene)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } })
  })

  it('YAZ-4515: without the live check, a CLI save lands under a dirty editor, whose own save then meets a conflict', async () => {
    const path = join(root, 'Board.excalidraw')
    await writeFile(path, scene); await utimes(path, 1_700_000_000, 1_700_000_000)
    const before = await run('drawing', 'read', path)
    await run('drawing', 'save', path, { revision: before.revision }, scene.replace('test', 'agent'))
    // The open tab's autosave still holds the mtime it loaded: the shared save refuses it, and the user meets the conflict bar.
    await expect(saveDrawingIndexed({ root, path, json: scene.replace('test', 'human'), newFiles: [], expectedMtime: (before as { mtime: number }).mtime }, [])).rejects.toMatchObject({ code: 'CONFLICT' })
  })
  it.each([['save', {}, scene], ['setReadOnly', { on: true }, ''], ['setFoldArrows', { value: 'off' }, '']] as const)('YAZ-4515: refuses %s while a live editor holds unsaved edits, naming the window and tab', async (action, option, body) => {
    const path = join(root, 'Board.excalidraw')
    await writeFile(path, scene)
    const before = await run('drawing', 'read', path)
    const liveEdits: LiveEdits = async target => target === path ? [{ window: 'w1', path, tabs: ['t1'] }] : []
    await expect(run('drawing', action, path, { revision: before.revision, ...option }, body, liveEdits)).rejects.toMatchObject({ code: 'UNSAVED_LIVE_EDITS', details: { path, open: [{ window: 'w1', path, tabs: ['t1'] }] } })
    expect(await readFile(path, 'utf8')).toBe(scene)
    expect(await run('drawing', action, path, { revision: before.revision, ...option }, body, async () => [])).toMatchObject({ diskSaved: true })
  })
  it.each([['drawing', 'excalidraw'], ['diagram', 'drawio']])('YAZ-4515: refuses a %s read over the connection limit before loading it', async (kind, extension) => {
    const path = join(root, `Big.${extension}`)
    await writeFile(path, '')
    await truncate(path, 70 * 1024 * 1024)
    await expect(run(kind, 'read', path)).rejects.toMatchObject({ code: 'TOO_LARGE', message: expect.stringContaining('export --output-file') })
  })
})
