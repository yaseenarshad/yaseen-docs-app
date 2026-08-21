/**
 * Mixed-marker siblings (GRO-2112): `-`, `*` and `+` are the same bullet. `unifySiblingMarkers`
 * runs on load (inside `normalizeEmptyItems`) so CommonMark's "marker change = new list" never
 * splits an indent level into sibling lists. Pure-function tests; the editor-level proof lives
 * in guideLines.test.ts ('mixed markers').
 */
import { describe, expect, it } from 'vitest'
import { normalizeEmptyItems, unifySiblingMarkers } from './listItemRoundTrip'

describe('unifySiblingMarkers (GRO-2112)', () => {
  it('gives a sibling the marker of the previous bullet at its indent', () => {
    expect(unifySiblingMarkers('* a\n- b\n+ c\n')).toBe('* a\n* b\n* c\n')
    expect(unifySiblingMarkers('- a\n* b\n')).toBe('- a\n- b\n')
  })

  it('works per indent level, tabs counting as 4 spaces', () => {
    expect(unifySiblingMarkers('* p\n\t- c1\n\t* c2\n\t\t* g1\n\t\t- g2\n')).toBe('* p\n\t- c1\n\t- c2\n\t\t* g1\n\t\t* g2\n')
    expect(unifySiblingMarkers('* p\n    - c1\n\t* c2\n')).toBe('* p\n    - c1\n\t- c2\n')
  })

  it('forgets deeper indents after a shallower bullet and resets on a blank line', () => {
    // `- y` is the first bullet of q's NEW nested list: it keeps its own marker.
    expect(unifySiblingMarkers('* p\n  * x\n* q\n  - y\n')).toBe('* p\n  * x\n* q\n  - y\n')
    expect(unifySiblingMarkers('* a\n\n- b\n')).toBe('* a\n\n- b\n')
    expect(unifySiblingMarkers('* a\nparagraph\n- b\n')).toBe('* a\nparagraph\n- b\n')
  })

  it('leaves ordered lists, fenced code and non-list text alone', () => {
    expect(unifySiblingMarkers('1. a\n2) b\n* c\n')).toBe('1. a\n2) b\n* c\n')
    const fenced = '* a\n```md\n- not a bullet\n* nor this\n```\n- b\n'
    expect(unifySiblingMarkers(fenced)).toBe('* a\n```md\n- not a bullet\n* nor this\n```\n* b\n')
    expect(unifySiblingMarkers('*emphasis* not a bullet\n-- dashes\n')).toBe('*emphasis* not a bullet\n-- dashes\n')
  })

  it('is idempotent and composed into normalizeEmptyItems', () => {
    const once = unifySiblingMarkers('* a\n- b\n')
    expect(unifySiblingMarkers(once)).toBe(once)
    expect(normalizeEmptyItems('* a\n- b\n- [ ]\n')).toBe('* a\n* b\n* [ ] <br />\n')
  })
})
