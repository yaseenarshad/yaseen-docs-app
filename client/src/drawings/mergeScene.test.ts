import { describe, expect, it, vi } from 'vitest'
import { mergeLiveScene, type SceneClash, type SceneMerge } from './mergeScene'

type El = Record<string, unknown> & { id: string }

/**
 * The engine's restore, faked: a copy (as the real one makes), and with `refreshDimensions` a text's width from its text — the
 * one thing a real measure would change. A box handed in beside its label must not come back out.
 */
const restoreElements = vi.fn((elements: El[], _existing: unknown, opts?: { refreshDimensions?: boolean }) =>
  elements.map((e) => (opts?.refreshDimensions === true && e.type === 'text' ? { ...e, width: String(e.text).length * 10 } : { ...e })),
)
const engine = { restoreElements } as never

const shape = (id: string, over: Partial<El> = {}): El => ({ id, type: 'rectangle', x: 0, version: 3, versionNonce: 1, updated: 1, isDeleted: false, ...over })
const merge = (base: El[], disk: El[], live: El[], appState: { base?: object; disk?: object; live?: object } = {}): (SceneMerge & { conflicts?: never }) | (SceneClash & { elements?: never; appState?: never; added?: never; changed?: never }) =>
  mergeLiveScene(engine, { elements: base, appState: { ...appState.base } }, { elements: disk, appState: { ...appState.disk } }, { elements: live, appState: { ...appState.live } }, ['viewBackgroundColor', 'gridSize'])

describe('mergeLiveScene (YAZ-4279 D1, D4)', () => {
  it('a shape the file did not touch keeps its canvas object; one the file changed is restored, above the canvas version', () => {
    const [a, b] = [shape('a'), shape('b')]
    const live = [{ ...a, x: 40, version: 7 }, b]
    const out = merge([a, b], [a, { ...b, strokeColor: 'red' }], live)
    expect(out?.elements?.[0]).toBe(live[0])
    expect(out?.elements?.[1]).toMatchObject({ id: 'b', strokeColor: 'red', version: 4 })
    expect(out).toMatchObject({ changed: ['b'], added: [] })
  })

  it('both sides on one shape: the properties of both, version above the canvas; one property on both is a clash', () => {
    const a = shape('a')
    const out = merge([a], [{ ...a, strokeColor: 'red' }], [{ ...a, x: 40, version: 9 }])
    expect(out?.elements?.[0]).toMatchObject({ x: 40, strokeColor: 'red', version: 10 })
    expect(merge([a], [{ ...a, x: 7 }], [{ ...a, x: 40, version: 9 }])).toEqual({ conflicts: ['a'] })
  })

  it('a shape the file added is in `added`; one it deleted is neither added nor changed', () => {
    const [a, b] = [shape('a'), shape('b')]
    const out = merge([a, b], [a, { ...b, isDeleted: true }, shape('n')], [{ ...a, x: 40 }, b])
    expect(out).toMatchObject({ added: ['n'], changed: [] })
    expect(out?.elements?.find((e) => e.id === 'b')?.isDeleted).toBe(true)
  })

  it('nothing taken from the file: the canvas as it is, and no restore', () => {
    restoreElements.mockClear()
    const a = shape('a')
    const live = [{ ...a, x: 40 }]
    expect(merge([a], [a], live)?.elements).toEqual(live)
    expect(restoreElements).not.toHaveBeenCalled()
  })

  it('the board settings: a key the file changed is taken; a key both changed is a clash; a key the file lacks says nothing', () => {
    const els = [shape('a')]
    expect(merge(els, els, els, { base: { viewBackgroundColor: '#fff' }, disk: { viewBackgroundColor: '#000' }, live: { viewBackgroundColor: '#fff' } })?.appState).toEqual({ viewBackgroundColor: '#000' })
    expect(merge(els, els, els, { base: { viewBackgroundColor: '#fff' }, disk: { viewBackgroundColor: '#000' }, live: { viewBackgroundColor: '#f00' } })).toEqual({ conflicts: [] })
    expect(merge(els, els, els, { base: { gridSize: 20 }, disk: {}, live: { gridSize: 40 } })?.appState).toEqual({})
  })

  it('item 3: text the file changed is measured again, and so is the label of a box it changed; the box stays the merged one', () => {
    const label = shape('t', { type: 'text', text: 'Plan', width: 30, containerId: 'box' })
    const box = shape('box', { boundElements: [{ id: 't', type: 'text' }], width: 100 })
    const other = shape('o', { type: 'text', text: 'Same', width: 40 })
    const base = [box, label, other]
    const relabeled = merge(base, [box, { ...label, text: 'Planning' }, other], base)
    expect(relabeled?.elements?.find((e) => e.id === 't')).toMatchObject({ text: 'Planning', width: 80 })
    expect(relabeled?.elements?.find((e) => e.id === 'o')).toBe(other)
    const resized = merge(base, [{ ...box, width: 300 }, label, other], base)
    expect(resized?.elements?.find((e) => e.id === 'box')).toMatchObject({ width: 300 })
    expect(resized?.changed?.sort()).toEqual(['box', 't'])
  })
})
