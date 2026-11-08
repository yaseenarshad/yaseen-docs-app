import { expect, it } from 'vitest'
import { liveEditsOf, refuseLiveEdits } from './liveEdits'
import type { NavigationHost } from './navigation'

it('YAZ-4515: asks every live window and lists each unsaved editor with its window and tabs', async () => {
  const asked: unknown[] = []
  const host = { windows: () => [{ id: 'w1' }, { id: 'w2' }], inspect: async (id: string, target: unknown) => {
    asked.push([id, target])
    return { open: id === 'w2' ? [{ path: '/v/B.excalidraw', tabs: ['t9'] }, { path: '/v/sub/C.excalidraw', tabs: [] }] : [] }
  } } as unknown as NavigationHost
  expect(await liveEditsOf(host)('/v')).toEqual([{ window: 'w2', path: '/v/B.excalidraw', tabs: ['t9'] }, { window: 'w2', path: '/v/sub/C.excalidraw', tabs: [] }])
  expect(asked).toEqual([['w1', { kind: 'dirty', path: '/v' }], ['w2', { kind: 'dirty', path: '/v' }]])
  await expect(refuseLiveEdits(liveEditsOf(host), '/v/B.excalidraw')).rejects.toMatchObject({ code: 'UNSAVED_LIVE_EDITS', details: { path: '/v/B.excalidraw' } })
  await expect(refuseLiveEdits(undefined, '/v/B.excalidraw')).resolves.toBeUndefined()
})
