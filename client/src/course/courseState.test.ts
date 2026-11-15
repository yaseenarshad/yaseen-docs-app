import { describe, expect, it } from 'vitest'
import { applyCoursePatch, cleanCourseState, defaultCourseState } from '@shared/courseState'

describe('AppState.course (YAZ-5120)', () => {
  it('cleans field by field over the base: a bad field keeps the base`s value; unknown keys go', () => {
    const base = { ...defaultCourseState(), chapter: 'why', speed: 1.25 as const }
    expect(cleanCourseState(null, base)).toBe(base)
    expect(cleanCourseState([], base)).toBe(base)
    expect(cleanCourseState({ chapter: 'inbox', clip: 'c3-04', finished: ['why', 'why', '', 'x y', 7], done: true, muted: 1, speed: 3, more: true }, base)).toEqual({
      ...base,
      chapter: 'inbox',
      clip: 'c3-04',
      finished: ['why'],
      done: true,
    })
    expect(cleanCourseState({ chapter: 'a'.repeat(65) }).chapter).toBe('')
  })

  it('made (YAZ-5124): one record per vault, absolute paths only; a bad record is dropped whole', () => {
    const good = { vault: '/v', folder: '/v/course-cards', cards: ['/v/course-cards/a-tst-2.md', '/v/course-cards/a-tst-2.md'], page: null }
    expect(cleanCourseState({ made: [good, { ...good, folder: '/v/other' }, { vault: 'v', folder: '/v/x', cards: [], page: null }, { ...good, vault: '/w', cards: ['rel.md'] }] }).made).toEqual([
      { ...good, cards: ['/v/course-cards/a-tst-2.md'] },
    ])
    expect(cleanCourseState({ made: 'x' }).made).toEqual([])
    const s = defaultCourseState()
    expect(applyCoursePatch(s, { made: [] })).toBe(s)
  })

  it('made.folderId (YAZ-5202): the ID of the course folder is kept; a record without one stays valid; a bad ID is dropped, not the record', () => {
    const good = { vault: '/v', folder: '/v/course-cards', cards: [], page: null }
    expect(cleanCourseState({ made: [{ ...good, folderId: 'YAZ-12' }] }).made).toEqual([{ ...good, folderId: 'YAZ-12' }])
    expect(cleanCourseState({ made: [good] }).made).toEqual([good])
    expect(cleanCourseState({ made: [{ ...good, folderId: 'a b/c' }] }).made).toEqual([good])
    expect(cleanCourseState({ made: [{ ...good, folderId: 7 }] }).made).toEqual([good])
  })

  it('vault (YAZ-5201): an absolute path or null; anything else keeps the base', () => {
    expect(defaultCourseState().vault).toBeNull()
    expect(cleanCourseState({ vault: '/a' }).vault).toBe('/a')
    expect(cleanCourseState({ vault: null }, { ...defaultCourseState(), vault: '/a' }).vault).toBeNull()
    expect(cleanCourseState({ vault: 'a' }, { ...defaultCourseState(), vault: '/b' }).vault).toBe('/b')
    const s = { ...defaultCourseState(), vault: '/a' }
    expect(applyCoursePatch(s, { vault: '/a' })).toBe(s)
  })

  it('applyCoursePatch: the same object when nothing changed, else the new state', () => {
    const s = defaultCourseState()
    expect(applyCoursePatch(s, { muted: false })).toBe(s)
    expect(applyCoursePatch(s, { speed: 9 })).toBe(s)
    expect(applyCoursePatch(s, { muted: true, speed: 1.5 })).toEqual({ ...s, muted: true, speed: 1.5 })
  })
})
