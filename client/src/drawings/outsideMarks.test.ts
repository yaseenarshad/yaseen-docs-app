import { afterEach, describe, expect, it, vi } from 'vitest'
import { changedShapes, MARK_COLLABORATORS, OutsideMarks, type MarkCollaborator } from './outsideMarks'

/** The engine's collaborator colour (`getClientColor`): the hue it hashes each id to. */
function hue(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i)
  return (Math.abs(hash) % 37) * 10
}

function setup() {
  const shown: Map<string, MarkCollaborator>[] = []
  const marks = new OutsideMarks((c) => shown.push(c))
  const outlined = () => Object.fromEntries([...(shown.at(-1) ?? new Map()).entries()].map(([id, c]) => [id, Object.keys(c.selectedElementIds).sort()]))
  return { marks, outlined, shown }
}

afterEach(() => vi.useRealTimers())

describe('OutsideMarks (YAZ-4279 D5, items 7 and 8)', () => {
  it('each colour is a stand-in collaborator whose id the engine hashes to green, amber and red', () => {
    expect([hue(MARK_COLLABORATORS.added), hue(MARK_COLLABORATORS.changed), hue(MARK_COLLABORATORS.clash)]).toEqual([130, 40, 0])
  })

  it('"Until I check it": a shape stays outlined until it is selected or edited', () => {
    const { marks, outlined } = setup()
    marks.mark(['n'], ['c'], [{ id: 'n', version: 2 }, { id: 'c', version: 5 }], 'until-checked')
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.added]: ['n'], [MARK_COLLABORATORS.changed]: ['c'] })
    marks.seen({}, [{ id: 'n', version: 2 }, { id: 'c', version: 5 }])
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.added]: ['n'], [MARK_COLLABORATORS.changed]: ['c'] })
    marks.seen({ n: true }, [{ id: 'n', version: 2 }, { id: 'c', version: 5 }])
    marks.seen({}, [{ id: 'n', version: 2 }, { id: 'c', version: 6 }])
    expect(outlined()).toEqual({})
  })

  it('10 s and 1 min go by themselves; Off outlines nothing; a newer save replaces the older outlines', () => {
    vi.useFakeTimers()
    const { marks, outlined } = setup()
    marks.mark([], ['c'], [{ id: 'c' }], '10s')
    vi.advanceTimersByTime(9_999)
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.changed]: ['c'] })
    vi.advanceTimersByTime(1)
    expect(outlined()).toEqual({})
    marks.mark([], ['c'], [{ id: 'c' }], 'off')
    expect(outlined()).toEqual({})
    marks.mark([], ['a'], [{ id: 'a' }], 'until-checked')
    marks.mark([], ['b'], [{ id: 'b' }], 'until-checked')
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.changed]: ['b'] })
  })

  it('a clash is red, a select does not end it, and an empty clash takes it away', () => {
    const { marks, outlined } = setup()
    marks.clash(['x'])
    marks.seen({ x: true }, [{ id: 'x', version: 9 }])
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.clash]: ['x'] })
    marks.clash([])
    expect(outlined()).toEqual({})
  })

  it('with no mark, a change costs nothing: no render', () => {
    const { marks, shown } = setup()
    marks.seen({ a: true }, [{ id: 'a', version: 1 }])
    expect(shown).toHaveLength(0)
  })
})

describe('changedShapes (a clean reload\'s news)', () => {
  it('added and changed live shapes, the stamps aside; a deleted one is neither', () => {
    const before = [{ id: 'a', x: 1, version: 1 }, { id: 'b', x: 1, version: 1 }, { id: 'd', x: 1 }]
    const after = [{ id: 'a', x: 1, version: 7 }, { id: 'b', x: 2, version: 2 }, { id: 'd', x: 1, isDeleted: true }, { id: 'n', x: 0 }]
    expect(changedShapes(before, after)).toEqual({ added: ['n'], changed: ['b'] })
  })
})
