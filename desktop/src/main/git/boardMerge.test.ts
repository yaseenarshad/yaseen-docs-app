import { describe, expect, it } from 'vitest'
import { mergeBoards } from '@shared/boardMerge'
import { boardFoldArrowsOf, boardHoverOutlineOf, hoverLinksOff, picturesOut, withBoardFoldArrows, withBoardHoverOutline, withHoverLinks, withPicturesOut } from '@shared/drawingAssets'
import { isDrawingReadOnly, withDrawingReadOnly } from '@shared/readOnly'

type El = Record<string, unknown> & { id: string }

/** A shape as the app saves one — only the fields the merge reads, plus a position to tell edits apart. */
const shape = (id: string, over: Partial<El> = {}): El => ({ id, type: 'rectangle', x: 0, index: `a${id}`, version: 1, versionNonce: 1, updated: 1000, isDeleted: false, boundElements: null, ...over })

/** An edit the way the engine makes one: moved, version bumped, `updated` stamped. */
const edit = (e: El, x: number, updated = num(e.updated) + 10): El => ({ ...e, x, version: num(e.version) + 1, updated })
const del = (e: El, updated = num(e.updated) + 10): El => ({ ...e, isDeleted: true, version: num(e.version) + 1, updated })
const num = (v: unknown): number => v as number

const board = (elements: El[], appState: Record<string, unknown> = { gridSize: 20 }): string =>
  `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-draw', elements, appState, files: {} }, null, 2)}\n`

function merge(base: El[], theirs: El[], mine: El[]) {
  const out = mergeBoards(board(base), board(theirs), board(mine))
  if (out === null) throw new Error('expected a merge')
  const doc = JSON.parse(out.json) as { elements: El[]; appState: Record<string, unknown> }
  return { ...out, doc, els: doc.elements, get: (id: string) => doc.elements.find((e) => e.id === id) }
}

const [r1, r2, r3] = [shape('1'), shape('2'), shape('3')]

describe('mergeBoards — per shape', () => {
  it('S1: different shapes edited on each side are both kept', () => {
    const m = merge([r1, r2], [edit(r1, 7), r2], [r1, edit(r2, 13)])
    expect(m.get('1')?.x).toBe(7)
    expect(m.get('2')?.x).toBe(13)
    expect(m.clashes).toBe(0)
  })

  it('S2: shapes added on both sides are both kept', () => {
    const m = merge([r1], [r1, shape('t')], [r1, shape('m')])
    expect(m.els.map((e) => e.id).sort()).toEqual(['1', 'm', 't'])
    expect(m.clashes).toBe(0)
  })

  it('S3: the same shape edited on both sides keeps the newest edit and counts a clash', () => {
    const m = merge([r1], [edit(r1, 7, 2000)], [edit(r1, 13, 1500)])
    expect(m.get('1')?.x).toBe(7)
    expect(m.clashes).toBe(1)
    expect(merge([r1], [edit(r1, 7, 1500)], [edit(r1, 13, 2000)]).get('1')?.x).toBe(13)
  })

  it('S3 tie-break: same `updated` → higher version, then lower versionNonce', () => {
    const t = { ...edit(r1, 7, 2000), version: 5 }
    const m = { ...edit(r1, 13, 2000), version: 3 }
    expect(merge([r1], [t], [m]).get('1')?.x).toBe(7)
    const t2 = { ...edit(r1, 7, 2000), versionNonce: 9 }
    const m2 = { ...edit(r1, 13, 2000), versionNonce: 4 }
    expect(merge([r1], [t2], [m2]).get('1')?.x).toBe(13)
  })

  it('S4: deleted on one side and edited on the other keeps the edit, whichever is newer', () => {
    expect(merge([r1], [del(r1, 9000)], [edit(r1, 13, 2000)]).get('1')).toMatchObject({ x: 13, isDeleted: false })
    expect(merge([r1], [edit(r1, 7, 2000)], [del(r1, 9000)]).get('1')).toMatchObject({ x: 7, isDeleted: false })
    // a shape REMOVED from a side (not a tombstone) is a delete too
    expect(merge([r1], [], [edit(r1, 13)]).get('1')?.x).toBe(13)
  })

  it('S5: deleted on one side and untouched on the other stays deleted', () => {
    expect(merge([r1, r2], [del(r1), r2], [r1, r2]).get('1')?.isDeleted).toBe(true)
    expect(merge([r1, r2], [r1, r2], [r1]).get('2')).toBeUndefined()
  })

  it('S6: deleted on both sides stays deleted and is not a clash', () => {
    const m = merge([r1], [del(r1, 2000)], [del(r1, 3000)])
    expect(m.get('1')?.isDeleted).toBe(true)
    expect(m.clashes).toBe(0)
    expect(merge([r1], [], [del(r1)]).get('1')?.isDeleted).toBe(true)
  })

  it('identical edits on both sides are one edit, not a clash', () => {
    const e = edit(r1, 7)
    const m = merge([r1], [e], [e])
    expect(m.get('1')?.x).toBe(7)
    expect(m.clashes).toBe(0)
  })

  it('S8: a clashing shape keeps both sides\' bindings, minus bound elements that are gone', () => {
    const arrowT = shape('at')
    const arrowM = shape('am')
    const gone = shape('g')
    const base = [r1, gone]
    const theirs = [{ ...edit(r1, 7, 3000), boundElements: [{ id: 'at', type: 'arrow' }, { id: 'g', type: 'arrow' }] }, arrowT, del(gone)]
    const mine = [{ ...edit(r1, 13, 2000), boundElements: [{ id: 'am', type: 'arrow' }] }, arrowM, gone]
    const m = merge(base, theirs, mine)
    expect(m.get('1')?.x).toBe(7)
    expect(m.get('1')?.boundElements).toEqual([
      { id: 'at', type: 'arrow' },
      { id: 'am', type: 'arrow' },
    ])
  })
})

describe('mergeBoards — parents (S9)', () => {
  const box = shape('box', { boundElements: [{ id: 'txt', type: 'text' }] })
  const txt = shape('txt', { type: 'text', containerId: 'box', text: 'hi' })

  it('text edited on one side inside a box deleted on the other keeps its box', () => {
    const m = merge([box, txt], [del(box, 9000), del(txt, 9000)], [box, { ...edit(txt, 0), text: 'hi edited' }])
    expect(m.get('txt')).toMatchObject({ isDeleted: false, text: 'hi edited', containerId: 'box' })
    expect(m.get('box')?.isDeleted).toBe(false)
  })

  it('a shape in a frame the other side deleted keeps the frame; a parent neither side kept is let go of', () => {
    const frame = shape('f', { type: 'frame' })
    const child = shape('c', { frameId: 'f' })
    expect(merge([frame, child], [del(frame), del(child)], [frame, edit(child, 5)]).get('f')?.isDeleted).toBe(false)
    const orphan = shape('o', { containerId: 'nowhere' })
    expect(merge([], [], [orphan]).get('o')?.containerId).toBeNull()
  })
})

describe('mergeBoards — the board around the shapes', () => {
  it('orders by fractional index, ties by id, so both machines write the same bytes', () => {
    const a = shape('b', { index: 'a5' })
    const c = shape('a', { index: 'a5' })
    const first = shape('z', { index: 'a0' })
    const m = merge([first], [first, a], [first, c])
    expect(m.els.map((e) => e.id)).toEqual(['z', 'a', 'b'])
    expect(mergeBoards(board([first]), board([first, c]), board([first, a]))?.json).toBe(m.json)
  })

  it('keeps the remote order for a board written before indices existed', () => {
    const [x, y] = [shape('x', { index: undefined }), shape('y', { index: undefined })]
    expect(merge([], [y], [x]).els.map((e) => e.id)).toEqual(['y', 'x'])
  })

  it('S7: board settings merge per key; ours wins a key both changed', () => {
    const out = mergeBoards(board([], { gridSize: 20, bg: '#fff', zoom: 1 }), board([], { gridSize: 40, bg: '#000', zoom: 1 }), board([], { gridSize: 20, bg: '#eee', zoom: 2 }))
    expect(JSON.parse(out?.json ?? '{}').appState).toEqual({ gridSize: 40, bg: '#eee', zoom: 2 })
  })

  it('writes the app\'s format: our top-level fields, 2-space JSON, trailing newline', () => {
    const out = mergeBoards(board([r1]), board([r1, r2]), board([r1, r3]))
    expect(out?.json.endsWith('}\n')).toBe(true)
    expect(Object.keys(JSON.parse(out?.json ?? '{}'))).toEqual(['type', 'version', 'source', 'elements', 'appState', 'files'])
    expect(out?.json).toBe(`${JSON.stringify(JSON.parse(out?.json ?? '{}'), null, 2)}\n`)
  })

  it('keeps the YAZ-1834 dates block first: born at the earlier time, changed at the later, even when only one side has it', () => {
    const withMeta = (meta: Record<string, number> | null, elements: El[]) => `${JSON.stringify({ ...(meta === null ? {} : { yaseendraw: meta }), type: 'excalidraw', elements, appState: {} }, null, 2)}\n`
    const out = JSON.parse(mergeBoards(withMeta({ createdAt: 5, updatedAt: 5 }, [r1]), withMeta({ createdAt: 5, updatedAt: 90 }, [r1, r2]), withMeta({ createdAt: 3, updatedAt: 70 }, [r1, r3]))?.json ?? '{}')
    expect(Object.keys(out)[0]).toBe('yaseendraw')
    expect(out.yaseendraw).toEqual({ createdAt: 3, updatedAt: 90 })
    const oneSided = JSON.parse(mergeBoards(withMeta(null, [r1]), withMeta({ createdAt: 1, updatedAt: 2 }, [r1, r2]), withMeta(null, [r1, r3]))?.json ?? '{}')
    expect(Object.keys(oneSided)[0]).toBe('yaseendraw')
  })

  it('S15: refuses to merge anything that is not a scene', () => {
    expect(mergeBoards('not json', board([]), board([]))).toBeNull()
    expect(mergeBoards(board([]), '{"elements": 3}', board([]))).toBeNull()
    expect(mergeBoards(board([]), board([]), '{"elements": [{"noId": true}]}')).toBeNull()
  })
})

describe('mergeBoards — the switches of the yaseendraw block (YAZ-3943 1E): the newest change wins', () => {
  /** A board as each Mac writes it: its block made by the same doors the app uses. */
  const scene = (block: Record<string, unknown>, elements: El[] = [r1]): Record<string, unknown> => ({ yaseendraw: block, type: 'excalidraw', elements, appState: {}, files: {} })
  const text = (doc: Record<string, unknown>) => `${JSON.stringify(doc, null, 2)}\n`
  /** A plain edit on a Mac: a shape moves, the save stamps `updatedAt` and keeps the block's other keys. */
  const edited = (doc: Record<string, unknown>, at: number) => ({ ...doc, yaseendraw: { ...(doc.yaseendraw as object), updatedAt: at }, elements: [edit(r1, 7, at)] })
  const blockOf = (base: Record<string, unknown>, theirs: Record<string, unknown>, mine: Record<string, unknown>) =>
    (JSON.parse(mergeBoards(text(base), text(theirs), text(mine))?.json ?? '{}') as { yaseendraw: Record<string, unknown> }).yaseendraw

  it('Mac A turns pictures out, Mac B edits the board: the merge keeps "out", whichever side is ours', () => {
    const base = scene({ createdAt: 1, updatedAt: 2 })
    const macA = withPicturesOut(base, true, 1, 300)
    const macB = edited(base, 400)
    for (const [theirs, mine] of [[macA, macB], [macB, macA]]) {
      const merged = blockOf(base, theirs, mine)
      expect(picturesOut(merged)).toBe(true)
      expect(merged).toMatchObject({ createdAt: 1, updatedAt: 400, switched: { pictures: 300 } })
    }
    // And back inside on one Mac, after it was out on both: "inside" (no key) wins, though the other side still holds "out".
    const out = withPicturesOut(base, true, 1, 300)
    const inside = withPicturesOut(out, false, 1, 500)
    for (const [theirs, mine] of [[inside, edited(out, 600)], [edited(out, 600), inside]]) expect(picturesOut(blockOf(out, theirs, mine))).toBe(false)
  })

  it('the same for Read only: off on one Mac is never lost to the other Mac\'s untouched "on"', () => {
    const base = withDrawingReadOnly(scene({ createdAt: 1, updatedAt: 2 }), true, 1, 100)
    const macA = withDrawingReadOnly(base, false, 1, 300)
    const macB = edited(base, 400)
    for (const [theirs, mine] of [[macA, macB], [macB, macA]]) {
      const merged = blockOf(base, theirs, mine)
      expect(isDrawingReadOnly({ yaseendraw: merged })).toBe(false)
      expect(merged.switched).toEqual({ readonly: 300 })
    }
  })

  it('when both Macs changed a switch, the newer change wins; the two switches are each their own', () => {
    const base = scene({ createdAt: 1, updatedAt: 2 })
    const macA = withPicturesOut(withDrawingReadOnly(base, true, 1, 500), true, 1, 200)
    const macB = withPicturesOut(withPicturesOut(withDrawingReadOnly(withDrawingReadOnly(base, true, 1, 100), false, 1, 400), true, 1, 150), false, 1, 600)
    for (const [theirs, mine] of [[macA, macB], [macB, macA]]) {
      const merged = blockOf(base, theirs, mine)
      expect(isDrawingReadOnly({ yaseendraw: merged })).toBe(true)
      expect(picturesOut(merged)).toBe(false)
      expect(merged.switched).toEqual({ readonly: 500, pictures: 600 })
    }
  })

  it('YAZ-3943 demo round 3: a board\'s own pictures folder rides with "pictures out": the newer switch brings its folder, or takes it away', () => {
    const base = scene({ createdAt: 1, updatedAt: 2 })
    const macA = withPicturesOut(base, true, 1, 300, 'Board pictures')
    const macB = edited(base, 400)
    for (const [theirs, mine] of [[macA, macB], [macB, macA]]) {
      expect(blockOf(base, theirs, mine)).toMatchObject({ pictures: 'assets', picturesFolder: 'Board pictures', switched: { pictures: 300 } })
    }
    // Mac B later moves them to the assets folder (no folder key): the folder goes, though Mac A's side still names it.
    const toAssets = withPicturesOut(macA, true, 1, 500, null)
    for (const [theirs, mine] of [[toAssets, edited(macA, 600)], [edited(macA, 600), toAssets]]) {
      const merged = blockOf(macA, theirs, mine)
      expect(picturesOut(merged)).toBe(true)
      expect(merged).not.toHaveProperty('picturesFolder')
    }
    // Both Macs picked a folder: the newer pick wins, folder and all.
    const older = withPicturesOut(base, true, 1, 300, 'Old')
    const newer = withPicturesOut(base, true, 1, 700, '/Users/me/Pictures/Boards')
    for (const [theirs, mine] of [[older, newer], [newer, older]]) expect(blockOf(base, theirs, mine).picturesFolder).toBe('/Users/me/Pictures/Boards')
  })

  it('YAZ-3943 demo 2: the board\'s "Link preview on hover" is a switch too: off on one Mac is never lost to the other Mac\'s edit', () => {
    const base = scene({ createdAt: 1, updatedAt: 2 })
    const macA = withHoverLinks(base, false, 1, 300)
    const macB = edited(base, 400)
    for (const [theirs, mine] of [[macA, macB], [macB, macA]]) {
      const merged = blockOf(base, theirs, mine)
      expect(hoverLinksOff(merged)).toBe(true)
      expect(merged.switched).toEqual({ hoverLinks: 300 })
    }
  })

  it('YAZ-4277 D5: the board\'s "Fold arrows" is a switch too: the newest choice wins, "app setting" (no key) included', () => {
    const base = scene({ createdAt: 1, updatedAt: 2 })
    const macA = withBoardFoldArrows(base, 'always', 1, 300)
    for (const [theirs, mine] of [[macA, edited(base, 400)], [edited(base, 400), macA]]) {
      const merged = blockOf(base, theirs, mine)
      expect(boardFoldArrowsOf(merged)).toBe('always')
      expect(merged.switched).toEqual({ foldArrows: 300 })
    }
    const backToApp = withBoardFoldArrows(macA, null, 1, 500)
    for (const [theirs, mine] of [[macA, backToApp], [backToApp, macA]]) expect(blockOf(macA, theirs, mine)).not.toHaveProperty('foldArrows')
  })

  it('YAZ-4469 4B: the board\'s "Hover outline" is a switch too: the newest choice wins, "app setting" (no key) included', () => {
    const base = scene({ createdAt: 1, updatedAt: 2 })
    const macA = withBoardHoverOutline(base, false, 1, 300)
    for (const [theirs, mine] of [[macA, edited(base, 400)], [edited(base, 400), macA]]) {
      const merged = blockOf(base, theirs, mine)
      expect(boardHoverOutlineOf(merged)).toBe(false)
      expect(merged.switched).toEqual({ hoverOutline: 300 })
    }
    // Mac B turns it On later than Mac A's Off: On wins on both sides; then App on one Mac removes the key.
    const macB = withBoardHoverOutline(base, true, 1, 450)
    for (const [theirs, mine] of [[macA, macB], [macB, macA]]) expect(boardHoverOutlineOf(blockOf(base, theirs, mine))).toBe(true)
    const backToApp = withBoardHoverOutline(macA, null, 1, 500)
    for (const [theirs, mine] of [[macA, backToApp], [backToApp, macA]]) expect(blockOf(macA, theirs, mine)).not.toHaveProperty('hoverOutline')
  })

  it('a board whose switches have no time merges as before: ours wins, and a key only theirs holds stays', () => {
    const base = scene({ createdAt: 1, updatedAt: 2 })
    expect(blockOf(base, scene({ createdAt: 1, updatedAt: 5, readonly: true }), scene({ createdAt: 1, updatedAt: 6 }))).toEqual({ createdAt: 1, updatedAt: 6, readonly: true })
    expect(blockOf(base, scene({ createdAt: 1, updatedAt: 5, pictures: 'assets' }), scene({ createdAt: 1, updatedAt: 6, cloudId: 'x' }))).toEqual({ createdAt: 1, updatedAt: 6, pictures: 'assets', cloudId: 'x' })
  })

  it('YAZ-4071 7I: each Mac gave the board its own ID: the lower number wins on both sides, and the other ID is kept in `formerIds`', () => {
    const base = scene({ createdAt: 1, updatedAt: 2 })
    const a = scene({ createdAt: 1, updatedAt: 5, id: 'DEM-5' })
    const b = scene({ createdAt: 1, updatedAt: 6, id: 'DEM-9' })
    const want = { createdAt: 1, updatedAt: 6, id: 'DEM-5', formerIds: ['DEM-9'] }
    expect(blockOf(base, a, b)).toEqual(want)
    expect(blockOf(base, b, a)).toEqual(want)
    // A later merge keeps what an earlier one learned, from either side, and never names the ID it keeps.
    const later = scene({ createdAt: 1, updatedAt: 9, id: 'DEM-12', formerIds: ['DEM-30'] })
    expect(blockOf(base, scene(want), later)).toEqual({ createdAt: 1, updatedAt: 9, id: 'DEM-5', formerIds: ['DEM-12', 'DEM-30', 'DEM-9'] })
    // One ID on both sides, or on one side only: nothing to keep.
    expect(blockOf(base, a, scene({ createdAt: 1, updatedAt: 6, id: 'DEM-5' }))).toEqual({ createdAt: 1, updatedAt: 6, id: 'DEM-5' })
    expect(blockOf(base, a, scene({ createdAt: 1, updatedAt: 6 }))).toEqual({ createdAt: 1, updatedAt: 6, id: 'DEM-5' })
  })
})
