/**
 * One step of the guided tour ("Try it in the app", YAZ-5059 decision 13): the real control to light up, what to say,
 * and the real action that completes it.
 *
 * - `target`: the `data-tour` name of the real control, in kebab case (`sidebar-inbox`, `card-menu`). The tour layer
 *   (YAZ-5123) cuts a hole around it. A target that is not on screen is skipped after 2 seconds.
 * - `say`: the spoken line. It is also the caption in the coach card.
 * - `done`: `'click'` when a click on the target completes the step; `{ event }` when the step waits for an app event
 *   with that name (a card saved, a review answered). The tour never clicks for the person.
 */
export interface TourStep { target: string; say: string; done: 'click' | { event: string } }
