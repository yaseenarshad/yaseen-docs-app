/**
 * THE TOUR SEAM (YAZ-5120, for issue 6E, YAZ-5123): "Try it in the app".
 *
 * The layer shows "Try it in the app" only on a chapter that has `tryIt` steps (`hasTour`), on the chapter's end
 * screen and beside the controls. A click hides the course layer (it stays mounted, so the place is kept), and calls
 * `start`. When the promise settles, the course shows again at the same place, with the keyboard back in it. A
 * rejected promise counts as `'left'`.
 *
 * Issue 6E builds the real tour (`TourLayer`: the dim, the hole around the real control, the coach card, the real
 * action). This frame ships `comingNextTour`, which shows one line in the course and comes back at once.
 */
import type { CourseChapter } from './script'
import type { TourStep } from './tour'

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
