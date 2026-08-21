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
    // Lazy continuation: no blank line → `lazy` belongs to `a`, so `b` is still a's sibling.
    expect(unifySiblingMarkers('* a\nlazy text\n- b\n')).toBe('* a\nlazy text\n* b\n')
  })

  it('treats bare empty markers as bullets and never touches thematic breaks', () => {
    expect(unifySiblingMarkers('*\n- b\n')).toBe('*\n* b\n')
    expect(unifySiblingMarkers('- <br />\n* b\n')).toBe('- <br />\n- b\n')
    expect(unifySiblingMarkers('* a\n- - -\n* b\n')).toBe('* a\n- - -\n* b\n')
    expect(unifySiblingMarkers('* a\n  - - -\n  * b\n')).toBe('* a\n  - - -\n  * b\n')
    // The break itself is untouched; `b` inheriting `*` is harmless — remark ends the list at `***` anyway.
    expect(unifySiblingMarkers('* a\n***\n- b\n')).toBe('* a\n***\n* b\n')
  })

  it('leaves ordered lists, fenced code and non-list text alone', () => {
    // Ordered lines are not bullets: they neither take nor give a marker; `- y` / `- b` still
    // follow the bullets at their indent (CommonMark splits the lists around `1.` regardless).
    expect(unifySiblingMarkers('* a\n  1. x\n  - y\n- b\n')).toBe('* a\n  1. x\n  - y\n* b\n')
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
