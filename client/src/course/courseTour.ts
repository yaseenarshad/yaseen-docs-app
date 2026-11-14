/**
 * THE TOUR SEAM (YAZ-5120, for issue 6E, YAZ-5123): "Try it in the app".
 *
 * The layer shows "Try it in the app" only on a chapter that has `tryIt` steps (`hasTour`), on the chapter's end
 * screen and beside the controls. A click hides the course layer (it stays mounted, so the place is kept), and calls
 * `start`. When the promise settles, the course shows again at the same place, with the keyboard back in it. A
 * rejected promise counts as `'left'`.
 *
 * Issue 6E (YAZ-5123) built the real tour, `appTour`: the default of `CardCourse`. It mounts `TourLayer` (the dim, the
 * hole around the real control, the coach card, the real action) in its own root in `document.body`, and takes it
 * away when the tour ends. A finished tour adds the chapter to `AppState.course.toured`. The tour also ends when the
 * course layer is gone under it (the person opened the course again from Settings, or it closed).
 * `comingNextTour` was the frame's stand-in; tests still use it.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { storage } from '../lib/storage'
import type { CourseChapter } from './script'
import type { TourStep } from './tour'
import type { CourseHost } from './courseHost'
import { TourLayer } from './TourLayer'

/** How a tour ended: every step done, or the person left it (Esc, "Back to the course", Skip on the last step). */
export type TourResult = 'finished' | 'left'

export interface CourseTour {
  start(chapter: CourseChapter, steps: readonly TourStep[]): Promise<TourResult>
}

/** Pure: does this chapter offer "Try it in the app"? */
export const hasTour = (chapter: CourseChapter): boolean => (chapter.tryIt?.length ?? 0) > 0

/** The line the frame's tour shows. */
export const TOUR_COMING_NEXT = 'Try it in the app is coming next. For now, the course shows each step.'

/** The frame's tour: it shows `TOUR_COMING_NEXT` (through `say`) and comes back at once. */
export function comingNextTour(say: (line: string) => void): CourseTour {
  return {
    start: () => {
      say(TOUR_COMING_NEXT)
      return Promise.resolve('left')
    },
  }
}

/** The real tour over the app (YAZ-5123), with the course's host (6F) for the Course Cards folder. */
export function appTour(host: CourseHost): CourseTour {
  return {
    start: (chapter, steps) =>
      new Promise<TourResult>((resolve) => {
        // The course layer, hidden while the tour runs: once it is gone, the tour has nothing to go back to.
        const course = document.querySelector('.course[role="dialog"]')
        const box = document.createElement('div')
        box.className = 'course-tour-root'
        document.body.appendChild(box)
        const root = createRoot(box)
        const onEnd = (result: TourResult): void => {
          if (result === 'finished') {
            const toured = storage.getCourse().toured
            if (!toured.includes(chapter.id)) storage.setCourse({ toured: [...toured, chapter.id] })
          }
          // Not inside the layer's own render or effect: React unmounts the root after them.
          queueMicrotask(() => {
            root.unmount()
            box.remove()
          })
          resolve(result)
        }
        root.render(createElement(TourLayer, { chapter, steps, host, alive: () => course === null || course.isConnected, onEnd }))
      }),
  }
}
