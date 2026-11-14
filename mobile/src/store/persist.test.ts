import { describe, expect, it, vi } from 'vitest'
import { askToKeepStorage } from './persist'

const manager = (persisted: boolean, grant: boolean) =>
  ({ persisted: vi.fn(async () => persisted), persist: vi.fn(async () => grant) }) as unknown as StorageManager

describe('askToKeepStorage: navigator.storage.persist() at sign-in', () => {
  it('asks the browser and says whether it agreed', async () => {
    const yes = manager(false, true)
    expect(await askToKeepStorage(yes)).toBe('kept')
    expect(yes.persist).toHaveBeenCalledOnce()
    expect(await askToKeepStorage(manager(false, false))).toBe('not-kept')
  })

  it('does not ask again when the storage is kept already', async () => {
    const kept = manager(true, true)
    expect(await askToKeepStorage(kept)).toBe('kept')
    expect(kept.persist).not.toHaveBeenCalled()
  })

  it('a browser with no storage manager, or a call that fails, is "unsupported", never an error', async () => {
    expect(await askToKeepStorage(undefined)).toBe('unsupported')
    expect(await askToKeepStorage({} as StorageManager)).toBe('unsupported')
    const broken = { persisted: async () => false, persist: async () => Promise.reject(new Error('no')) } as unknown as StorageManager
    expect(await askToKeepStorage(broken)).toBe('unsupported')
  })
})
