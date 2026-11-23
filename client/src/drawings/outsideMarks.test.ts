import { afterEach, describe, expect, it, vi } from 'vitest'
import { MARK_COLLABORATORS, OutsideMarks, type MarkCollaborator } from './outsideMarks'

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

/** The canvas's shapes by id, as the surface answers `seen`. */
const canvas = (...shapes: { id: string; version: number }[]) => (id: string) => shapes.find((s) => s.id === id)

describe('OutsideMarks (YAZ-4279 D5, items 7 and 8)', () => {
  it('each colour is a stand-in collaborator whose id the engine hashes to green, amber and red', () => {
    expect([hue(MARK_COLLABORATORS.added), hue(MARK_COLLABORATORS.changed), hue(MARK_COLLABORATORS.clash)]).toEqual([130, 40, 0])
  })

  it('"Until I check it": a shape stays outlined until it is selected or edited', () => {
    const { marks, outlined } = setup()
    marks.mark(['n'], ['c'], [{ id: 'n', version: 2 }, { id: 'c', version: 5 }], 'until-checked')
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.added]: ['n'], [MARK_COLLABORATORS.changed]: ['c'] })
    marks.seen({}, canvas({ id: 'n', version: 2 }, { id: 'c', version: 5 }))
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.added]: ['n'], [MARK_COLLABORATORS.changed]: ['c'] })
    marks.seen({ n: true }, canvas({ id: 'n', version: 2 }, { id: 'c', version: 5 }))
    marks.seen({}, canvas({ id: 'n', version: 2 }, { id: 'c', version: 6 }))
    expect(outlined()).toEqual({})
  })

  it('1 min and 5 min go by themselves; Off outlines nothing; a newer save replaces the older outlines', () => {
    vi.useFakeTimers()
    const { marks, outlined } = setup()
    marks.mark([], ['c'], [{ id: 'c' }], '60s')
    // A timed glow ends by time only: a select does not end it (4A-14).
    marks.seen({ c: true }, canvas({ id: 'c', version: 9 }))
    vi.advanceTimersByTime(59_999)
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.changed]: ['c'] })
    vi.advanceTimersByTime(1)
    expect(outlined()).toEqual({})
    marks.mark([], ['c'], [{ id: 'c' }], 'off')
    expect(outlined()).toEqual({})
    marks.mark([], ['a'], [{ id: 'a' }], 'until-checked')
    marks.mark([], ['b'], [{ id: 'b' }], 'until-checked')
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.changed]: ['b'] })
  })

  it('Reload takes the green and amber away, never the red', () => {
    const { marks, outlined } = setup()
    marks.mark([], ['c'], [{ id: 'c' }], 'until-checked')
    marks.clash(['x'])
    marks.clearNews()
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.clash]: ['x'] })
  })

  it('a clash is red, a select does not end it, and an empty clash takes it away', () => {
    const { marks, outlined } = setup()
    marks.clash(['x'])
    marks.seen({ x: true }, canvas({ id: 'x', version: 9 }))
    expect(outlined()).toEqual({ [MARK_COLLABORATORS.clash]: ['x'] })
    marks.clash([])
    expect(outlined()).toEqual({})
  })

  it('with no mark, a change costs nothing: no render', () => {
    const { marks, shown } = setup()
    marks.seen({ a: true }, canvas({ id: 'a', version: 1 }))
    expect(shown).toHaveLength(0)
  })
})
