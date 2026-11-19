import { afterEach, describe, expect, it, vi } from 'vitest'
import { liftRow, liftsAt, movedOrder, overFor, settleOffset, slotFor, translateYOf } from './rowLift'

/** The smooth row drag's math (YAZ-5916 Q1, Q2): when a press lifts, where the gap opens, and where a drop lands. */
describe('rowLift', () => {
  it('a 9 px move is a click, a 10 px vertical move is a drag, a sideways wobble is no drag', () => {
    expect(liftsAt(0, 9)).toBe(false)
    expect(liftsAt(6, 6)).toBe(false) // 8.5 px
    expect(liftsAt(0, 10)).toBe(true)
    expect(liftsAt(0, -10)).toBe(true)
    expect(liftsAt(12, 3)).toBe(false)
    expect(liftsAt(7, 8)).toBe(true)
  })

  // Four rows of 24 px from y 100; the third is an open folder of 72 px.
  const tops = [100, 124, 148, 220]
  const heights = [24, 24, 72, 24]
  it('the slot is before the first row whose middle is below the pointer', () => {
    expect(slotFor(90, tops, heights)).toBe(0)
    expect(slotFor(111, tops, heights)).toBe(0)
    expect(slotFor(113, tops, heights)).toBe(1)
    expect(slotFor(183, tops, heights)).toBe(2)
    expect(slotFor(185, tops, heights)).toBe(3)
    expect(slotFor(400, tops, heights)).toBe(4)
  })

  it('a slot next to the lifted row is no move; any other lands before the row at it, or after the last', () => {
    const paths = ['a', 'b', 'c', 'd']
    expect(overFor(1, 1, paths)).toBeNull()
    expect(overFor(2, 1, paths)).toBeNull()
    expect(overFor(0, 1, paths)).toEqual({ path: 'a', edge: 'before' })
    expect(overFor(4, 1, paths)).toEqual({ path: 'd', edge: 'after' })
    expect(movedOrder(paths, 1, 4)).toEqual(['a', 'c', 'd', 'b'])
    expect(movedOrder(paths, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(movedOrder(paths, 1, 2)).toEqual(paths)
    expect(movedOrder(paths, 1, null)).toEqual(paths)
  })

  it('the drop settles the row exactly into the gap', () => {
    // Row b (24 px) down past the folder: it lands where the folder's bottom is once the folder slid up by 24.
    expect(settleOffset(3, 1, tops, heights, 24)).toBe(148 + 72 - 24 - 124)
    // Row d up to the top: it lands at a's top.
    expect(settleOffset(0, 3, tops, heights, 24)).toBe(100 - 220)
    expect(settleOffset(2, 1, tops, heights, 24)).toBe(0)
  })
})

/**
 * The drop's glide (bug YAZ-5971): the optimistic save lets React move the `li`s in the drop's own task, under the
 * transforms still on. The glide starts from where each item was DRAWN, not from the new layout plus the old transform:
 * the rows that slid aside do not move again, and the dropped row glides from the drop point into its place.
 */
describe('rowLift drop glide (YAZ-5971)', () => {
  const ROW = 24
  const TOP = 100
  const animate = HTMLElement.prototype.animate
  afterEach(() => {
    vi.restoreAllMocks()
    HTMLElement.prototype.animate = animate
  })

  /** A list of rows a…d, 24 px each from y 100, laid out by DOM order; a row's box adds its inline translateY. */
  function setup() {
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: false, media: q }) as MediaQueryList)
    const list = document.createElement('ul')
    list.className = 'tree'
    for (const name of ['a', 'b', 'c', 'd']) {
      const li = document.createElement('li')
      const row = document.createElement('button')
      row.className = 'tree__row'
      row.dataset.path = `/v/${name}`
      li.append(row)
      list.append(li)
    }
    document.body.append(list)
    const items = () => [...list.children] as HTMLElement[]
    const box = (top: number) => ({ top, height: ROW, bottom: top + ROW, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === list) return box(TOP)
      const li = this.closest('li') as HTMLElement
      return box(TOP + ROW * items().indexOf(li) + translateYOf(li.style.transform))
    })
    const glides = new Map<string, string>()
    HTMLElement.prototype.animate = function (this: HTMLElement, keys: Keyframe[]) {
      glides.set(this.querySelector<HTMLElement>(':scope > .tree__row')!.dataset.path!, String(keys[0].transform))
      return {} as Animation
    } as HTMLElement['animate']
    const el = (name: string) => items().find((li) => li.firstElementChild?.getAttribute('data-path') === `/v/${name}`)!
    return { list, el, glides }
  }

  it('the slid-aside rows get no glide; the dropped row glides from the drop point', async () => {
    const { list, el, glides } = setup()
    const d = el('d')
    // Press d (top 172) at y 184, drag it to y 105: its top is drawn at 93, the gap opens at slot 0, a…c slide down 24.
    const lift = liftRow(d.firstElementChild as HTMLElement, 184)!
    lift.move(0, 105, false)
    expect(lift.slot()).toBe(0)
    expect(el('a').style.transform).toBe('translateY(24px)')
    lift.settle()
    // The optimistic save: React moves d first in the same task, its transforms still on (and d's settle transition lost).
    list.insertBefore(d, el('a'))
    await Promise.resolve()
    expect(glides.has('/v/a') || glides.has('/v/b') || glides.has('/v/c')).toBe(false)
    // Drawn at 93 (172 - 79), now at 100: it glides down the last 7 px.
    expect(glides.get('/v/d')).toBe('translateY(-7px)')
    expect([...list.children].every((li) => (li as HTMLElement).style.transform === '')).toBe(true)
    list.remove()
  })

  it('a new order that comes after a frame glides from where each item is drawn then: a settled row does not move', async () => {
    const { list, el, glides } = setup()
    const d = el('d')
    const lift = liftRow(d.firstElementChild as HTMLElement, 184)!
    lift.move(0, 105, false)
    lift.settle()
    // A frame is drawn: d stands settled in the gap (its transform -72, jsdom has no transition), a…c still parted.
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    list.insertBefore(d, el('a'))
    await Promise.resolve()
    expect(glides.size).toBe(0)
    list.remove()
  })

  it('reads the y of a computed transform', () => {
    expect(translateYOf('none')).toBe(0)
    expect(translateYOf('matrix(1, 0, 0, 1, 0, -79)')).toBe(-79)
    expect(translateYOf('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 12.5, 0, 1)')).toBe(12.5)
    expect(translateYOf('translateY(24px)')).toBe(24)
  })
})
