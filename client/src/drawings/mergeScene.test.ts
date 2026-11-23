import { describe, expect, it, vi } from 'vitest'
import { keepBothLiveScene, mergeLiveScene, prepareReplacedScene, type SceneClash, type SceneMerge } from './mergeScene'

type El = Record<string, unknown> & { id: string }

/**
 * The engine's restore, faked by its real rules (4A-13): a copy that fills in a field the file may lack (`roughness`); and,
 * only with BOTH `repairBindings` and `refreshDimensions` (the engine returns before its measure without the repair), a
 * text measured again from its `originalText`, which becomes its `text` — the width the one thing a real measure changes.
 */
const restoreElements = vi.fn((elements: El[], _existing: unknown, opts?: { repairBindings?: boolean; refreshDimensions?: boolean }) =>
  elements.map((e) => {
    const out = { roughness: 1, ...e }
    if (opts?.repairBindings !== true || opts.refreshDimensions !== true || e.type !== 'text') return out
    const words = String(e.originalText ?? e.text)
    return { ...out, text: words, width: words.length * 10 }
  }),
)
const restoreAppState = (appState: Record<string, unknown> | null) => ({ viewBackgroundColor: '#ffffff', gridSize: null, ...appState })
const engine = { restoreElements, restoreAppState } as never

/** A shape as the canvas holds it: restored, so with every field the restore fills in. */
const shape = (id: string, over: Partial<El> = {}): El => ({ id, type: 'rectangle', x: 0, index: `a${id}`, roughness: 1, version: 3, versionNonce: 1, updated: 1, isDeleted: false, ...over })
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

  it('nothing taken from the file: the canvas as it is, each shape its very object, and nothing measured', () => {
    restoreElements.mockClear()
    const a = shape('a')
    const live = [{ ...a, x: 40 }]
    expect(merge([a], [a], live)?.elements?.[0]).toBe(live[0])
    // Only the base and the file go through the restore, once each.
    expect(restoreElements).toHaveBeenCalledTimes(2)
  })

  it('the board settings: a key the file changed is taken; a key both changed is a clash; a key the file lacks says nothing', () => {
    const els = [shape('a')]
    expect(merge(els, els, els, { base: { viewBackgroundColor: '#fff' }, disk: { viewBackgroundColor: '#000' }, live: { viewBackgroundColor: '#fff' } })?.appState).toEqual({ viewBackgroundColor: '#000' })
    expect(merge(els, els, els, { base: { viewBackgroundColor: '#fff' }, disk: { viewBackgroundColor: '#000' }, live: { viewBackgroundColor: '#f00' } })).toEqual({ conflicts: [] })
    expect(merge(els, els, els, { base: { gridSize: 20 }, disk: {}, live: { gridSize: 40 } })?.appState).toEqual({})
    // 4A-8: a key the base lacks is the engine's default, as the canvas holds it: the file's change is taken, no clash.
    expect(merge(els, els, els, { base: {}, disk: { viewBackgroundColor: '#000' }, live: { viewBackgroundColor: '#ffffff' } })?.appState).toEqual({ viewBackgroundColor: '#000' })
  })

  it('4A-6: the base and the file as written, the canvas restored: a shape the user never touched, deleted in the file, is deleted — no bar', () => {
    const { roughness: _r, ...raw } = shape('a')
    const out = merge([raw as El, shape('b')], [shape('b')], [shape('a'), { ...shape('b'), x: 40 }])
    expect(out?.elements?.map((e) => e.id)).toEqual(['b'])
    expect(out?.elements?.[0]).toMatchObject({ x: 40 })
  })

  it('a seed the restore made up is no edit: a shape with none in the file, changed in the file, is no clash', () => {
    const a = shape('a')
    expect(merge([a], [{ ...a, strokeColor: 'red', seed: 7 }], [{ ...a, x: 40, seed: 3 }])?.elements?.[0]).toMatchObject({ x: 40, strokeColor: 'red' })
  })

  it('4A-5: an AI that rewrites only `text` gets its words, though the engine measures from `originalText`', () => {
    const label = shape('t', { type: 'text', text: 'Plan', originalText: 'Plan', width: 40 })
    const out = merge([label], [{ ...label, text: 'Plan the release' }], [label])
    expect(out?.elements?.[0]).toMatchObject({ text: 'Plan the release', originalText: 'Plan the release', width: 160 })
  })

  it('item 3: text the file changed is measured again, and so is the label of a box it changed; the box stays the merged one', () => {
    const box = shape('box', { index: 'a0', boundElements: [{ id: 't', type: 'text' }], width: 100 })
    const label = shape('t', { index: 'a1', type: 'text', text: 'Plan', originalText: 'Plan', width: 30, containerId: 'box' })
    const other = shape('o', { index: 'a2', type: 'text', text: 'Same', originalText: 'Same', width: 40 })
    const base = [box, label, other]
    const relabeled = merge(base, [box, { ...label, text: 'Planning' }, other], base)
    expect(relabeled?.elements?.find((e) => e.id === 't')).toMatchObject({ text: 'Planning', width: 80 })
    expect(relabeled?.elements?.find((e) => e.id === 'o')).toBe(other)
    const resized = merge(base, [{ ...box, width: 300 }, label, other], base)
    expect(resized?.elements?.find((e) => e.id === 'box')).toMatchObject({ width: 300 })
    expect(resized?.changed?.sort()).toEqual(['box', 't'])
  })

  it('item 5: sanitizes corrupted disk elements (duplicate IDs, dangling refs, missing originalText) before restoring', () => {
    const a = shape('a', { index: 'a0' })
    const dupA = shape('a', { index: 'a1', x: 99, containerId: 'missing-box' })
    const rawText = shape('t', { index: 'a2', type: 'text', text: 'AI note' })
    const out = merge([a], [a, dupA, rawText], [a])
    expect(out?.added).toEqual(['a-dup-1', 't'])
    expect(out?.elements?.find((e) => e.id === 'a-dup-1')).toMatchObject({ x: 99, containerId: null })
    expect(out?.elements?.find((e) => e.id === 't')).toMatchObject({ text: 'AI note', originalText: 'AI note', width: 70 })
  })
})

describe('prepareReplacedScene (YAZ-4279 item 4)', () => {
  it('sanitizes disk elements, restores them, re-measures alive text, and bumps version + versionNonce', () => {
    const box = shape('box', { index: 'a0', version: 2, boundElements: [{ id: 't1', type: 'text' }, { id: 'gone', type: 'arrow' }] })
    const txt = shape('t1', { index: 'a0', type: 'text', text: 'Updated label', containerId: 'box', width: 10, version: 5, versionNonce: 42 })
    const deadTxt = shape('t2', { index: 'a2', type: 'text', text: 'Deleted', originalText: 'Deleted', isDeleted: true, width: 10, version: 1 })
    const { roughness: _r, ...rawBox } = box

    const out = prepareReplacedScene(engine, { elements: [rawBox, txt, deadTxt], appState: {} })
    expect(out.elements).toHaveLength(3)

    const outBox = out.elements.find((e) => e.id === 'box')
    const outTxt = out.elements.find((e) => e.id === 't1')
    const outDead = out.elements.find((e) => e.id === 't2')

    // Restored roughness, repaired boundElements, bumped version
    expect(outBox).toMatchObject({ roughness: 1, boundElements: [{ id: 't1', type: 'text' }], version: 3 })
    // Repaired originalText, re-measured width (13 chars * 10 = 130), bumped version, valid monotonic index
    expect(outTxt).toMatchObject({ text: 'Updated label', originalText: 'Updated label', width: 130, version: 6 })
    expect((outBox?.index as string) < (outTxt?.index as string)).toBe(true)
    // Deleted text is NOT re-measured (keeps width 10), still bumped
    expect(outDead).toMatchObject({ isDeleted: true, width: 10, version: 2 })
    expect(typeof outTxt?.versionNonce).toBe('number')
  })
})

describe('keepBothLiveScene (YAZ-4279 item 12-core)', () => {
  const keepBoth = (base: El[], disk: El[], live: El[], appState: { base?: object; disk?: object; live?: object } = {}) =>
    keepBothLiveScene(
      engine,
      { elements: base, appState: { ...appState.base } },
      { elements: disk, appState: { ...appState.disk } },
      { elements: live, appState: { ...appState.live } },
      ['viewBackgroundColor', 'gridSize'],
    )

  it('merges non-clashing shapes normally and duplicates clashing shapes with offset, cleared bindings, and fresh stamps', () => {
    const a = shape('a', { index: 'a0', x: 10, y: 20, boundElements: [{ id: 'arr', type: 'arrow' }], containerId: 'parent' })
    const b = shape('b', { index: 'a1', x: 100, y: 100 })
    const arr = shape('arr', { index: 'a2', type: 'arrow' })
    const parent = shape('parent', { index: 'a3' })
    const liveA = { ...a, x: 50, version: 7 }
    const diskA = { ...a, x: 80, y: 30 }
    const diskB = { ...b, strokeColor: 'red' }

    const out = keepBoth([a, b, arr, parent], [diskA, diskB, arr, parent], [liveA, b, arr, parent])

    // Live version of clashing shape `a` kept as its exact canvas object
    expect(out.elements.find((e) => e.id === 'a')).toBe(liveA)
    // Non-clashing shape `b` merged from disk
    expect(out.elements.find((e) => e.id === 'b')).toMatchObject({ strokeColor: 'red', version: 4 })
    expect(out.changed).toEqual(['b'])
    // Duplicate of disk's clashing `a` appended with +40/+40 offset and cleared bindings/container
    expect(out.duplicated).toEqual(['a-ai-1'])
    expect(out.added).toEqual(['a-ai-1'])
    const dup = out.elements.find((e) => e.id === 'a-ai-1')
    expect(dup).toMatchObject({
      id: 'a-ai-1',
      x: 120,
      y: 70,
      boundElements: null,
      containerId: null,
      version: 1,
    })
    expect(typeof dup?.versionNonce).toBe('number')
    expect(typeof dup?.seed).toBe('number')
    expect(typeof dup?.updated).toBe('number')
  })

  it('handles delete vs edit: disk deleted + live edited keeps live without duplicate; live deleted + disk edited appends duplicate', () => {
    const a = shape('a', { index: 'a0', x: 10, y: 20 })
    const b = shape('b', { index: 'a1', x: 30, y: 40 })
    const liveA = { ...a, x: 99 }
    const liveBDeleted = { ...b, isDeleted: true }
    const diskADeleted = { ...a, isDeleted: true }
    const diskBEdited = { ...b, x: 77, y: 88 }

    const out = keepBoth([a, b], [diskADeleted, diskBEdited], [liveA, liveBDeleted])
    expect(out.elements.find((e) => e.id === 'a')).toBe(liveA)
    expect(out.elements.find((e) => e.id === 'b')).toBe(liveBDeleted)
    expect(out.duplicated).toEqual(['b-ai-1'])
    expect(out.added).toEqual(['b-ai-1'])
    expect(out.elements.find((e) => e.id === 'b-ai-1')).toMatchObject({ x: 117, y: 128, isDeleted: false, version: 1 })
  })

  it('re-measures duplicated text elements and avoids ID collisions with existing -ai- suffixes', () => {
    const t = shape('t', { index: 'a0', type: 'text', text: 'Base', originalText: 'Base', x: 0, y: 0, width: 40 })
    const existingDup = shape('t-ai-1', { index: 'a1' })
    const liveT = { ...t, text: 'User words', originalText: 'User words', width: 100 }
    const diskT = { ...t, text: 'AI longer words', width: 40 }

    const out = keepBoth([t, existingDup], [diskT, existingDup], [liveT, existingDup])
    expect(out.duplicated).toEqual(['t-ai-2'])
    expect(out.added).toEqual(['t-ai-2'])
    const dup = out.elements.find((e) => e.id === 't-ai-2')
    expect(dup).toMatchObject({
      text: 'AI longer words',
      originalText: 'AI longer words',
      width: 150,
      x: 40,
      y: 40,
      containerId: null,
      boundElements: null,
      version: 1,
    })
  })

  it('returns empty duplicated list when there are no conflicts', () => {
    const a = shape('a', { index: 'a0' })
    const out = keepBoth([a], [{ ...a, strokeColor: 'green' }], [a])
    expect(out.duplicated).toEqual([])
    expect(out.changed).toEqual(['a'])
    expect(out.elements[0]).toMatchObject({ strokeColor: 'green', version: 4 })
  })
})
