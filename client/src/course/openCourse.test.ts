import { afterEach, describe, expect, it, vi } from 'vitest'
import { COURSE } from './script'
import { COURSE_OPEN_EVENT, FORMATS_CHAPTER_TITLE, courseVaultAt, requestCourseChapter, type CourseRequest } from './openCourse'

describe('requestCourseChapter: one chapter by its title (YAZ-5114 "Learn the formats", YAZ-5120)', () => {
  const heard: CourseRequest[] = []
  const listener = (event: Event) => heard.push((event as CustomEvent<CourseRequest>).detail)
  window.addEventListener(COURSE_OPEN_EVENT, listener)
  afterEach(() => {
    heard.length = 0
  })

  it('the script has the chapter on good cards and formats; the request names its id from COURSE, and the fallback does not run', async () => {
    const chapter = COURSE.find((c) => c.title === FORMATS_CHAPTER_TITLE)
    expect(chapter, `script.ts has no chapter titled "${FORMATS_CHAPTER_TITLE}": set FORMATS_CHAPTER_TITLE in openCourse.ts`).toBeDefined()
    const fallback = vi.fn()
    await requestCourseChapter(FORMATS_CHAPTER_TITLE, fallback)
    expect(heard).toEqual([{ chapter: chapter!.id }])
    expect(fallback).not.toHaveBeenCalled()
  })

  it('the course cannot open (the script does not load, or has no such chapter): the fallback runs, and no request', async () => {
    const fallback = vi.fn()
    await requestCourseChapter(FORMATS_CHAPTER_TITLE, fallback, () => Promise.reject(new Error('chunk failed')))
    await requestCourseChapter('No such chapter', fallback)
    expect(fallback).toHaveBeenCalledTimes(2)
    expect(heard).toEqual([])
  })
})

describe('courseVaultAt: the ONE vault a course run is bound to (YAZ-5201)', () => {
  const place = { chapter: 'inbox', clip: 'c3-04', vault: '/a' }
  it('a new run (a chapter asked for, or no place yet) takes the vault in front', () => {
    expect(courseVaultAt('good-card', place, '/b', ['/a', '/b'])).toEqual({ vault: '/b' })
    expect(courseVaultAt(undefined, { chapter: '', clip: '', vault: '/a' }, '/b', ['/a', '/b'])).toEqual({ vault: '/b' })
    expect(courseVaultAt(undefined, { ...place, vault: null }, '/b', ['/a', '/b'])).toEqual({ vault: '/b' })
    expect(courseVaultAt(undefined, { chapter: '', clip: '', vault: null }, null, [])).toEqual({ vault: null })
  })
  it('a run that opens again at its place takes the vault saved with the place; one that left the window is lost', () => {
    expect(courseVaultAt(undefined, place, '/b', ['/a', '/b'])).toEqual({ vault: '/a' })
    expect(courseVaultAt(undefined, place, '/b', ['/b'])).toEqual({ vault: null, lost: '/a' })
  })
})
