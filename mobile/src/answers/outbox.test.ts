import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { idbBackend } from '../store/idbBackend'
import { limitedBackend } from '../store/testing'
import { memoryBackend, newMemoryDisk, openVaultStore, StorageFullError } from '../store'
import { ANSWERS_STATE, openOutbox } from './outbox'
import type { CardOp } from './ops'

const VAULT = 'yaseen/vault@main'
const review = (id: string, minute: number): CardOp => ({ kind: 'review', id, review: { at: `2026-11-14T06:${String(minute).padStart(2, '0')}Z`, rating: 'good' } })
const entry = (op: CardOp) => ({ op, path: 'a.md', title: `Card ${op.id}` })

/** Each test gets a new phone; `start()` opens its storage again, as the next app start does. */
const phones = {
  memory: () => {
    const disk = newMemoryDisk()
    return () => openVaultStore(memoryBackend(disk))
  },
  indexeddb: () => {
    const factory = new IDBFactory()
    return () => openVaultStore(idbBackend({ factory, keyRange: IDBKeyRange }))
  },
}

describe.each(Object.keys(phones) as (keyof typeof phones)[])('the answer list is durable (%s)', (name) => {
  it('it survives a closed app and a restart, in order, with no signal at all', async () => {
    const start = phones[name]()
    const store = await start()
    const box = await openOutbox(store, VAULT)
    const g1 = await box.add([entry(review('NC-1', 1))], 1000)
    const g2 = await box.add([entry({ kind: 'next', id: 'NC-2', on: false }), entry(review('NC-2', 2))], 2000)
    expect(g2).toBeGreaterThan(g1)
    store.close()

    const again = await openOutbox(await start(), VAULT)
    expect(again.waiting().map((w) => [w.op.kind, w.op.id, w.group])).toEqual([['review', 'NC-1', g1], ['next', 'NC-2', g2], ['review', 'NC-2', g2]])
    expect(again.waiting()[0]).toMatchObject({ path: 'a.md', title: 'Card NC-1', madeAt: 1000 })
  })

  it('"Reset local copy" keeps it (P5); removing the vault removes it', async () => {
    const store = await phones[name]()()
    const box = await openOutbox(store, VAULT)
    await box.add([entry(review('NC-1', 1))], 1)
    await store.resetCopy(VAULT)
    expect((await openOutbox(store, VAULT)).waiting()).toHaveLength(1)
    await store.removeVault(VAULT)
    expect((await openOutbox(store, VAULT)).waiting()).toHaveLength(0)
  })
})

describe('the answer list: undo, settle, lost, discard', () => {
  it('undo of an unsent answer removes its whole group; the other answers stay in order', async () => {
    const store = await openVaultStore(memoryBackend())
    const box = await openOutbox(store, VAULT)
    await box.add([entry(review('NC-1', 1))], 1)
    const g = await box.add([entry({ kind: 'next', id: 'NC-2', on: false }), entry(review('NC-2', 2))], 2)
    await box.add([entry(review('NC-3', 3))], 3)
    expect((await box.removeGroup(g)).map((w) => w.op.kind)).toEqual(['next', 'review'])
    expect(box.waiting().map((w) => w.op.id)).toEqual(['NC-1', 'NC-3'])
    expect(await box.removeGroup(g)).toEqual([])
    expect((await openOutbox(store, VAULT)).waiting().map((w) => w.op.id)).toEqual(['NC-1', 'NC-3'])
  })

  it('settle: the sent answers leave; a lost answer moves to `lost` with its title and answer, stays until Discard, and is never waiting again', async () => {
    const store = await openVaultStore(memoryBackend())
    const box = await openOutbox(store, VAULT)
    await box.add([entry(review('NC-1', 1))], 1)
    await box.add([entry(review('NC-9', 2))], 2)
    await box.add([entry(review('NC-3', 3))], 3)
    const [a, gone] = box.waiting()
    await box.settle([a.seq], [gone.seq], 50)
    expect(box.waiting().map((w) => w.op.id)).toEqual(['NC-3'])
    expect(box.lost()).toEqual([{ seq: gone.seq, op: gone.op, path: 'a.md', title: 'Card NC-9', lostAt: 50 }])
    const reopened = await openOutbox(store, VAULT)
    expect(reopened.lost()).toHaveLength(1)
    expect(await reopened.discard(gone.seq)).toBe(true)
    expect(reopened.lost()).toEqual([])
    expect(await reopened.discard(gone.seq)).toBe(false)
    expect((await store.getState<{ lost: unknown[] }>(VAULT, ANSWERS_STATE))!.lost).toEqual([])
  })

  it('an answer added during a send stays: settle names the sent ones by number', async () => {
    const store = await openVaultStore(memoryBackend())
    const box = await openOutbox(store, VAULT)
    await box.add([entry(review('NC-1', 1))], 1)
    const sent = box.waiting().map((w) => w.seq)
    await box.add([entry(review('NC-2', 2))], 2)
    await box.settle(sent, [], 3)
    expect(box.waiting().map((w) => w.op.id)).toEqual(['NC-2'])
  })

  it('a full phone: the add rejects and the list in memory does not change', async () => {
    let room = 1_000_000
    const store = await openVaultStore(limitedBackend(memoryBackend(), () => room))
    const box = await openOutbox(store, VAULT)
    await box.add([entry(review('NC-1', 1))], 1)
    room = 10
    await expect(box.add([entry(review('NC-2', 2))], 2)).rejects.toBeInstanceOf(StorageFullError)
    expect(box.waiting().map((w) => w.op.id)).toEqual(['NC-1'])
  })

  it('two tabs of the app (P4): each write starts from the stored list, so neither tab loses the other\'s answer', async () => {
    const store = await openVaultStore(memoryBackend())
    const tabA = await openOutbox(store, VAULT)
    const tabB = await openOutbox(store, VAULT)
    await tabA.add([entry(review('NC-1', 1))], 1)
    await tabB.add([entry(review('NC-2', 2))], 2)
    await tabA.refresh()
    expect(tabA.waiting().map((w) => [w.op.id, w.seq])).toEqual([['NC-1', 1], ['NC-2', 2]])
    expect((await openOutbox(store, VAULT)).waiting()).toHaveLength(2)
  })

  it('writes run one after the other: ten adds at once all land, in order', async () => {
    const store = await openVaultStore(memoryBackend())
    const box = await openOutbox(store, VAULT)
    await Promise.all(Array.from({ length: 10 }, (_, i) => box.add([entry(review(`NC-${i}`, i))], i)))
    expect((await openOutbox(store, VAULT)).waiting().map((w) => w.op.id)).toEqual(Array.from({ length: 10 }, (_, i) => `NC-${i}`))
  })
})
