import { describe, expect, it } from 'vitest'
import { stickyCap, stickyFolders, TREE_ROW_H } from './stickyFolders'

describe('how many folder levels stick (YAZ-3440 D2)', () => {
  it("the setting's levels, cut to the rows that fit in 40% of the list; Off is 0; a list with no height yet keeps the setting", () => {
    expect(stickyCap(7, 1000, TREE_ROW_H)).toBe(7)
    expect(stickyCap(7, 300, TREE_ROW_H)).toBe(4) // 120 / 25.5
    expect(stickyCap(3, 300, TREE_ROW_H)).toBe(3)
    expect(stickyCap(5, 50, TREE_ROW_H)).toBe(0)
    expect(stickyCap(0, 1000, TREE_ROW_H)).toBe(0)
    expect(stickyCap(5, 0, TREE_ROW_H)).toBe(5)
    // The sidebar zoom scales the rows and not the list: at 200% half as many fit.
    expect(stickyCap(7, 300, TREE_ROW_H * 2)).toBe(2)
  })

  it('writes the cap on the list as the attribute and as `--sticky-levels`, and clears both on cleanup', () => {
    const body = document.createElement('div')
    const stop = stickyFolders(body, 5, 1)
    expect(body.getAttribute('data-sticky-levels')).toBe('5')
    expect(body.style.getPropertyValue('--sticky-levels')).toBe('5')
    stop()
    expect(body.hasAttribute('data-sticky-levels')).toBe(false)
    expect(body.style.getPropertyValue('--sticky-levels')).toBe('')
  })

  it('Row spacing (YAZ-5885 D1): with no row to measure, the cap counts the setting\'s height times the zoom; a new height gives a new cap', () => {
    const body = document.createElement('div')
    body.getBoundingClientRect = () => ({ height: 400 }) as DOMRect // 40% = 160px
    const capAt = (rowHeight: number, zoom = 1): string | null => {
      const stop = stickyFolders(body, 7, zoom, rowHeight)
      const cap = body.getAttribute('data-sticky-levels')
      stop()
      return cap
    }
    expect(capAt(22)).toBe('7') // Compact: 160 / 22 = 7.3
    expect(capAt(TREE_ROW_H)).toBe('6') // Default: 160 / 25.5 = 6.3
    expect(capAt(30)).toBe('5') // Roomy: 160 / 30 = 5.3
    expect(capAt(40)).toBe('4')
    expect(capAt(30, 2)).toBe('2') // the zoom stacks on top: 160 / 60
    // A laid-out row wins over the setting: it is the real height, zoom and all.
    const row = document.createElement('div')
    row.className = 'tree__row'
    row.getBoundingClientRect = () => ({ height: 20 }) as DOMRect
    body.append(row)
    expect(capAt(40)).toBe('7')
  })
})
