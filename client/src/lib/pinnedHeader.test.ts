/** The shared header-pin helpers (YAZ-3769 S3): the folder page's `<thead>` and a note table's frozen rows. */
import { afterEach, describe, expect, it } from 'vitest'
import { pinnedHeaderOffset, verticalScrollParent } from './pinnedHeader'

afterEach(() => document.body.replaceChildren())

describe('pinnedHeaderOffset', () => {
  it('is 0 while the table top is below the scroller top', () => {
    expect(pinnedHeaderOffset(0, 40, 200, 28)).toBe(0)
  })

  it('follows the scroll while the table passes under the scroller top', () => {
    expect(pinnedHeaderOffset(0, -80, 400, 28)).toBe(80)
  })

  it('stops at the table end: the table height less the pinned rows', () => {
    expect(pinnedHeaderOffset(0, -400, 200, 28)).toBe(172)
    expect(pinnedHeaderOffset(0, -400, 20, 28)).toBe(0)
  })
})

describe('verticalScrollParent', () => {
  it('finds the nearest ancestor that scrolls up and down, not the node itself', () => {
    const outer = document.createElement('div')
    outer.style.overflowY = 'auto'
    const inner = document.createElement('div')
    const node = document.createElement('div')
    node.style.overflowY = 'auto'
    inner.appendChild(node)
    outer.appendChild(inner)
    document.body.appendChild(outer)
    expect(verticalScrollParent(node)).toBe(outer)
    expect(verticalScrollParent(outer)).toBeNull()
  })
})
