/**
 * The one guard of a folder table's writes (YAZ-5411): each door that writes files asks "Allow edits?" first while the
 * lock holds, runs on the LATEST doors once allowed, and does nothing on Cancel; with no lock, every door is the host's own.
 */
import { describe, expect, it, vi } from 'vitest'
import { afterAllow, guardEdits, type EditLock } from './editGuard'
import { CHANGE_CANCELLED } from './confirmChanges'
import { testFolderHost } from './testFolderHost'
import type { FolderHost } from './ViewsPane'

function doors(): FolderHost {
  return testFolderHost({
    setColumn: vi.fn(async () => 'set'),
    setColumns: vi.fn(),
    addColumn: vi.fn(),
    deleteColumn: vi.fn(async () => undefined),
    writeValues: vi.fn(async () => 'written'),
    retitle: vi.fn(),
    separate: { counts: () => ({ differ: 0, page: 0, own: 0 }) as never, set: vi.fn(async () => undefined) },
    relation: { of: () => null, set: vi.fn(async () => undefined) },
  })
}

/** A lock that answers `answer`, and is open after an Allow. `own` pages keep their own switch. */
function lock(answer: boolean, own: string[] = []): EditLock & { on: boolean; asked: number } {
  const state = {
    on: true,
    asked: 0,
    locked: (page?: string) => state.on && (page === undefined || !own.includes(page)),
    ask: async () => {
      state.asked += 1
      if (answer) state.on = false
      return answer
    },
  }
  return state
}

/** Every door a table change reaches, called once: the column's add, edit, type, option rename and delete, a cell, a title. */
async function callAll(host: FolderHost): Promise<unknown[]> {
  return [
    await host.setColumn('level', { kind: 'select' }, { kind: 'text' }),
    await host.setColumn('level', { kind: 'select' }, { kind: 'select' }, { from: 'A2', to: 'B1' }),
    await host.setColumns({ level: { kind: 'text' } }),
    await host.addColumn?.('due', { kind: 'date' }, [], 0, 'Added Due'),
    await host.deleteColumn?.('note.level'),
    await host.separate?.set('level', { kind: 'text' }, true, 'pages'),
    await host.relation?.set('owner', true),
    await host.writeValues('/vault/a.md', [{ key: 'level', value: 'B1' }]).catch((err: unknown) => err),
    await host.retitle('/vault/a.md', 'A'),
  ]
}

const DOORS = ['setColumn', 'setColumns', 'addColumn', 'deleteColumn', 'writeValues', 'retitle'] as const

describe('guardEdits (YAZ-5411)', () => {
  it('no lock: the host is its own, untouched', () => {
    const host = doors()
    expect(guardEdits(host, () => host)).toBe(host)
  })

  it('unlocked: every door runs at once, with no ask', async () => {
    const host = doors()
    const l = lock(true)
    l.on = false
    await callAll(guardEdits({ ...host, editLock: l }, () => host))
    expect(l.asked).toBe(0)
    for (const door of DOORS) expect(host[door]).toHaveBeenCalled()
  })

  it('locked, Cancel: each door asks, none runs; a cell write is dropped quietly (CHANGE_CANCELLED), the rest settle with nothing', async () => {
    const host = doors()
    const l = lock(false)
    const results = await callAll(guardEdits({ ...host, editLock: l }, () => host))
    expect(l.asked).toBe(9)
    for (const door of DOORS) expect(host[door]).not.toHaveBeenCalled()
    expect(host.separate?.set).not.toHaveBeenCalled()
    expect(host.relation?.set).not.toHaveBeenCalled()
    expect(results[7]).toBe(CHANGE_CANCELLED)
    expect(results.filter((r) => r !== CHANGE_CANCELLED).every((r) => r === undefined)).toBe(true)
  })

  it('locked, Allow: the change goes on through the LATEST doors (the unlocked render\'s), not the ones it was called on', async () => {
    const old = doors()
    const fresh = doors()
    const l = lock(true)
    const guarded = guardEdits({ ...old, editLock: l }, () => fresh)
    expect(await guarded.setColumn('level', { kind: 'select' }, { kind: 'text' }, { from: 'A2', to: 'B1' })).toBe('set')
    expect(fresh.setColumn).toHaveBeenCalledWith('level', { kind: 'select' }, { kind: 'text' }, { from: 'A2', to: 'B1' })
    expect(old.setColumn).not.toHaveBeenCalled()
    // Unlocked now: the next change runs at once.
    expect(await guarded.writeValues('/vault/a.md', [{ key: 'level', value: 'B1' }])).toBe('written')
    expect(l.asked).toBe(1)
  })

  it('a row with its own Read only switch is not the box\'s: its write is not asked, and the host\'s own guard keeps refusing it', async () => {
    const host = doors()
    const l = lock(true, ['/vault/own.md'])
    await guardEdits({ ...host, editLock: l }, () => host).writeValues('/vault/own.md', [{ key: 'level', value: 'B1' }])
    expect(l.asked).toBe(0)
    expect(host.writeValues).toHaveBeenCalledOnce()
  })
})

describe('afterAllow (YAZ-5411)', () => {
  it('runs now with no lock, asks with one, and gives the Cancel value on Cancel', async () => {
    const run = vi.fn(() => 'ran')
    expect(afterAllow(null, undefined, run, () => 'no')).toBe('ran')
    expect(await afterAllow(lock(false), undefined, run, () => 'no')).toBe('no')
    expect(run).toHaveBeenCalledOnce()
    expect(await afterAllow(lock(true), undefined, run, () => 'no')).toBe('ran')
  })
})
