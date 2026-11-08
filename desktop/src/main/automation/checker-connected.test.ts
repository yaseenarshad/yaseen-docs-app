import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { prepareAutomation } from '../automation'
import type { AutomationServices } from './services'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'checker-connected-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

function fixture() {
  const sharing = {
    stop: vi.fn(async () => {}),
    publish: vi.fn(async () => ({ id: 'published' })),
  }
  const run = (command: string, args: Record<string, unknown>, text?: string) => prepareAutomation({
    profile: root, version: 'test', state: defaultAppState,
    services: { sharing } as unknown as AutomationServices,
  }, { version: 1, session: 'fixture', token: 'fixture', id: 'fixture', issuedAt: Date.now(), command,
    args, hasContent: text !== undefined }, Buffer.from(text ?? '')).run()
  return { sharing, run }
}

it('allows stopping a saved share when its source board no longer exists', async () => {
  const { sharing, run } = fixture()
  const path = join(root, 'Deleted.excalidraw')
  await expect(run('share.stop', { root, path })).resolves.toMatchObject({ path, stopped: true })
  expect(sharing.stop).toHaveBeenCalledExactlyOnceWith(root, path)
})

it.each(['Board.excalidraw', 'Flow.drawio'])('rejects malformed standalone content before publishing %s', async (name) => {
  const { sharing, run } = fixture(), path = join(root, name)
  await writeFile(path, '{}')
  await expect(run('share.publish', { root, path }, 'not a board document')).rejects.toMatchObject({ code: expect.any(String) })
  expect(sharing.publish).not.toHaveBeenCalled()
})

it('rejects a non-board target before publishing it', async () => {
  const { sharing, run } = fixture(), path = join(root, 'Private.md')
  await writeFile(path, '# Private note')
  await expect(run('share.publish', { root, path }, '# Private note')).rejects.toMatchObject({ code: expect.any(String) })
  expect(sharing.publish).not.toHaveBeenCalled()
})
