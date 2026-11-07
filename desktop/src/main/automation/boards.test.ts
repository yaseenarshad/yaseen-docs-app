import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { EMPTY_DIAGRAM_XML } from '@shared/diagramFile'
import { boardCommand } from './boards'
import { _actAs, _resetMint } from '../vaultIndex/mint'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'docs-cli-board-')); _actAs(root, join(root, 'profile')) })
afterEach(async () => { _resetMint(); await rm(root, { recursive: true, force: true }) })
const scene = JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements: [], appState: {}, files: {} })
const run = (kind: string, action: string, path: string, extra: Record<string, unknown> = {}, body = '') => boardCommand(defaultAppState(), `${kind}.${action}`, { root, path, ...extra }, Buffer.from(body))

describe('board CLI adapters', () => {
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
})
