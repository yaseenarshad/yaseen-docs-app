import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../store'
import { prepareAutomation } from '../automation'
import { readSaved } from './resources'
import { loadDrawing } from '../fs/drawing'
import { _actAs, _resetMint } from '../vaultIndex/mint'

let root: string, store: ReturnType<typeof createStore>, profile: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'docs-cli-save-log-')); profile = join(root, '.profile')
  store = createStore(join(profile, 'state.json')); _actAs(root, profile)
})
afterEach(async () => { await store.flush(); _resetMint(); await rm(root, { recursive: true, force: true }) })
const run = (command: string, args: Record<string, unknown>, body = '') => prepareAutomation({ profile, version: 'test', state: () => store.get(), store }, { version: 1, session: 'test', token: 'test', id: command, issuedAt: Date.now(), command, args: { root, ...args }, hasContent: true }, Buffer.from(body)).run()

it('waits for the shared saved-edit log and adds nothing for a rejected text write', async () => {
  const path = join(root, 'Note.md'); await writeFile(path, 'before')
  const revision = (await readSaved(path)).revision
  expect(await run('file.write', { path, revision }, 'after')).toMatchObject({ diskSaved: true })
  const disk = await readFile(join(profile, 'state.json'), 'utf8')
  expect(JSON.parse(disk).folders[root].edits).toEqual(store.get().folders[root].edits)
  expect(disk).toContain('Note.md')
  await expect(run('file.write', { path, revision }, 'stale')).rejects.toMatchObject({ code: 'CONFLICT' })
  expect(await readFile(join(profile, 'state.json'), 'utf8')).toBe(disk)
  expect(await readFile(path, 'utf8')).toBe('after')
})
it('logs a guarded board save through the same completion step', async () => {
  const path = join(root, 'Board.excalidraw')
  const scene = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })
  await writeFile(path, scene)
  expect(await run('drawing.save', { path, revision: (await loadDrawing({ root, path, includeRevision: true })).revision }, scene)).toMatchObject({ diskSaved: true })
  expect((await readFile(join(profile, 'state.json'), 'utf8'))).toContain('Board.excalidraw')
})
