// Checker (YAZ-4521 round 2): share.stop must not report a stop for a path that has no saved share.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultAppState } from '@shared/types'
import { prepareAutomation } from '../automation'
import type { AutomationServices } from './services'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'checker-connected-r2-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('does not answer stopped: true for a mistyped path that holds no saved share', async () => {
  // The real service's stop() returns without error when no record exists; get() answers null.
  const sharing = { stop: vi.fn(async () => {}), get: vi.fn(async () => null), list: vi.fn(async () => []) }
  const run = (command: string, args: Record<string, unknown>) => prepareAutomation({
    profile: root, version: 'test', state: defaultAppState,
    services: { sharing } as unknown as AutomationServices,
  }, { version: 1, session: 'fixture', token: 'fixture', id: 'fixture', issuedAt: Date.now(), command, args, hasContent: false }, Buffer.alloc(0)).run()
  let outcome: unknown
  try { outcome = await run('share.stop', { root, path: join(root, 'typo-of-shared-board.excalidraw') }) } catch (error) { outcome = error }
  expect(outcome).not.toMatchObject({ stopped: true })
})
