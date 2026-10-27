import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/types'
import { appZoomFactor, subscribeAppZoom } from './appZoom'
import { createStore } from './store'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-appzoom-'))
  file = path.join(dir, 'yaseendocs.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('the App size in main (YAZ-3432)', () => {
  it('appZoomFactor: each App size as a Chromium factor (the store keeps only these, store.test.ts)', () => {
    expect([90, 100, 110, 125].map((appZoom) => appZoomFactor({ ...DEFAULT_SETTINGS, appZoom }))).toEqual([0.9, 1, 1.1, 1.25])
  })

  it('subscribeAppZoom: applies the new factor and the one before (YAZ-3441) only when the App size changed, never at once, and stops on unsubscribe', () => {
    const store = createStore(file)
    const apply = vi.fn()
    const off = subscribeAppZoom(store, apply)
    expect(apply).not.toHaveBeenCalled()

    store.setSettings({ ...DEFAULT_SETTINGS, sidebarZoom: 150 }) // a settings write, the same App size
    store.setSidebarWidth(321)
    expect(apply).not.toHaveBeenCalled()

    store.setSettings({ ...DEFAULT_SETTINGS, appZoom: 125 })
    expect(apply).toHaveBeenCalledExactlyOnceWith(1.25, 1)
    store.setSettings({ ...DEFAULT_SETTINGS, appZoom: 125, theme: 'dark' })
    expect(apply).toHaveBeenCalledTimes(1)
    store.setSettings({ ...DEFAULT_SETTINGS, appZoom: 90 })
    expect(apply).toHaveBeenLastCalledWith(0.9, 1.25)

    off()
    store.setSettings({ ...DEFAULT_SETTINGS, appZoom: 100 })
    expect(apply).toHaveBeenCalledTimes(2)
  })
})
