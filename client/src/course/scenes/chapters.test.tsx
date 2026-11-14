/**
 * The built chapters run to their end in the real course layer, on the fallback clock (no sound), with no error
 * (YAZ-5121; the issue's test). Chapter 2's steps that wait are passed with the person's Next, as a person may.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultCourseState, type CourseState } from '@shared/courseState'
import { storage } from '../../lib/storage'
import { COURSE } from '../script'
import { CardCourse } from '../CardCourse'
import { BUILT_CHAPTERS } from '.'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let el: HTMLDivElement
let queue: FrameRequestCallback[] = []
let now = 0
let saved: CourseState

beforeEach(() => {
  saved = defaultCourseState()
  vi.spyOn(storage, 'getCourse').mockImplementation(() => saved)
  vi.spyOn(storage, 'setCourse').mockImplementation((patch) => {
    saved = { ...saved, ...patch }
  })
  queue = []
  now = 0
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
    queue.push(fn)
    return queue.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.textContent = ''
  vi.restoreAllMocks()
})

/** One frame, 250 ms on (the layer's longest step). */
function frame(): void {
  now += 250
  const run = queue
  queue = []
  act(() => run.forEach((fn) => fn(now)))
}
const caption = () => document.querySelector('.course__caption')?.textContent ?? ''
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.course button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === label)

describe('the built chapters, in the course layer (YAZ-5121)', () => {
  it('play from the first clip to the course end on the fallback clock, with no error', () => {
    const errors = vi.spyOn(console, 'error')
    const course = COURSE.filter((ch) => BUILT_CHAPTERS.includes(ch.id))
    act(() => root.render(<CardCourse vault="/demo" onClose={() => undefined} course={course} />))
    act(() => button('Play')!.click())
    let last = ''
    let still = 0
    for (let i = 0; i < 6000 && caption() !== "That's the whole course."; i++) {
      if (/^Chapter \d+ done/.test(caption())) act(() => [...document.querySelectorAll<HTMLButtonElement>('.course__end-actions button')].find((b) => b.textContent === 'Next chapter')!.click())
      frame()
      // A step that waits: the caption holds; the person presses Next.
      still = caption() === last ? still + 1 : 0
      last = caption()
      if (still > 120) {
        act(() => button('Next step')!.click())
        still = 0
      }
    }
    expect(caption()).toBe("That's the whole course.")
    expect(document.querySelectorAll('.course__chapter[data-finished="true"]')).toHaveLength(course.length)
    expect(errors).not.toHaveBeenCalled()
  })
})
