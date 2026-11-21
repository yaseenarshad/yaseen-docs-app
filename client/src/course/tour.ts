/**
 * One step of the guided tour ("Try it in the app", YAZ-5059 decision 13): the real control to light up, what to say,
 * and the real action that completes it.
 *
 * - `target`: the `data-tour` name of the real control, in kebab case (`sidebar-inbox`, `card-menu`). The tour layer
 *   (YAZ-5123) cuts a hole around it. A target that is not on screen is skipped after 2 seconds.
 * - `say`: the spoken line. It is also the caption in the coach card.
 * - `done`: `'click'` when a click on the target completes the step; `{ event }` when the step waits for an app event
 *   with that name (a card saved, a review answered); `'show'` (a live step's light only, YAZ-5366): no action ends
 *   it, the course moves it on. The tour never clicks for the person.
 * - `example` (YAZ-5125): a step that asks the person to type. The coach card offers "Use an example", which puts
 *   `text` into the real field through the app's own path for typing (`tourExample.ts`), so the step ends as if the
 *   person had typed it. `enter`: then Enter, as the step says. `newSide`: first the editor's own New side.
 *   `lineEnd`: first the caret goes to the end of its line.
 */
export interface TourExample { text: string; enter?: true; newSide?: true; lineEnd?: true }
export interface TourStep { target: string; say: string; done: 'click' | 'show' | { event: string }; example?: TourExample }

/**
 * A LIVE STEP (YAZ-5366, phase 2 of YAZ-5357): a clip of the course names a real control, and the docked course lights
 * it in the real app while George speaks. The same rules as a tour step (the tour layer draws it, `TourLayer` with
 * `variant: 'live'`), with two more:
 *
 * - `mark`: the light lands on the clip's mark at this index (George's word, `CourseClip.marks`). Absent: when the
 *   clip's words end, "right after the clip" (a step whose words come in phase 3, YAZ-5367).
 * - `done` absent: a SHOW step. The light only: it never waits, and it goes out when the next step's moment comes or
 *   the clip ends. With `done`: a DO step. The clip holds at the end of its words until the person's real action
 *   (or Skip, or the course's Next), and the course asks for the corner while it waits.
 *
 * A clip's steps run in order, as a tour's do. `say`: the coach line next to the light (a do step's, from its old
 * `tryIt`). A show step without `say` shows the light alone.
 */
export interface LiveStep { target: string; mark?: number; say?: string; done?: 'click' | { event: string }; example?: TourExample }
