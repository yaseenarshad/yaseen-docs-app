/**
 * THE GUIDED TOUR'S LAYER (YAZ-5123, issue 6E; mockup screen 5): "Try it in the app".
 *
 * - The app dims, with a hole and a ring around the step's real control (its `data-tour` mark), and a hole for each
 *   menu, picker or toolbar that is open. The hole follows the control on each frame: a scroll, a resize, a menu that
 *   opens late.
 * - The coach card, near the control and never over it, says the step's line, "Step n of m", "Back to the course" and
 *   "Skip". Its line is a live region, so a screen reader reads each step.
 * - The layer takes no pointer (only the coach card does), and it never takes the keyboard from the app: the real
 *   click, typing, right-click and menu all work. At a new step the keyboard goes to the control, but only from the
 *   coach card or from nowhere.
 * - A step ends on the person's real action (`tourEngine.ts`): a click on the control, or the app's event
 *   (`tourBus.ts`). A control that is not on screen: the coach says where it is (`tourHelp.ts`), and after a while it
 *   offers "Show me".
 * - A step that asks the person to type offers "Use an example" (YAZ-5125, `tourExample.ts`): the example goes into the
 *   real field through the app's own path for typing, and the step ends on the app's own event, as for typing.
 * - A docked course (YAZ-5365, `dockArea.ts`) stays usable during the tour: the dim leaves its box out, the coach card
 *   never sits under it, and the layer tells the course where the lit control is, so a corner moves away from it.
 * - Esc leaves the tour, unless a menu, a dialog, Explore or a text field wants it (the app's Esc order): in the card
 *   editor, Esc is the step's own Done.
 *
 * LIVE STEPS (YAZ-5366, `variant: 'live'`): the same layer runs one clip's live steps while the course is docked (the
 * course mounts it for the clip, and takes it away when the clip ends).
 * - A step lights up at its moment (`reached`, read each frame: the clip's mark, or the end of its words), never
 *   before. The person's real action counts even before it.
 * - A do step dims the app around the control and shows the coach line (the step's `say`), "Show me" and "Use an
 *   example" where they fit, and Skip. A show step is the ring alone (its line, when it has one), with no dim; when its
 *   control is not on screen, the course brings it into view only through the app's own navigation, and only for a
 *   place that changes nothing (the sidebar, a folder in it, Settings: `SAFE_SHOW`).
 * - No "Back to the course" and no Esc of its own: the course is right there, docked, with its own Next and Esc.
 * - `onEnd('finished')` as soon as no do step is left (the course goes on), `onEnd('left')` on Skip of the last do
 *   step or when the steps cannot run here (no Course Cards folder: the line shows, and the course goes on).
 * - `visible` false (the course fills the window): the layer keeps its logic and draws nothing.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CourseChapter } from './script'
import type { TourStep } from './tour'
import type { CourseHost } from './courseHost'
import type { TourResult } from './courseTour'
import { readEscapeFacts } from '../lib/escapeOrder'
import { currentStep, coachPlace, dimPath, exampleSafe, holeOf, offersShowMe, shownStep, startTour, tourStep, type Box, type TourAction, type TourState } from './tourEngine'
import { checkTour, inFolder, TARGET_HELP } from './tourHelp'
import { COURSE_CARDS } from './courseCards'
import { listenTour, setTourPlaces, showTourPlace, type TourPlace } from './tourBus'
import { canFillExample, fillExample, USE_AN_EXAMPLE } from './tourExample'
import { courseArea, setLitBox } from './dockArea'
import './tour.css'

export interface TourLayerProps {
  chapter: CourseChapter
  steps: readonly TourStep[]
  host: CourseHost
  /** False once the course layer is gone (it closed under the tour): the tour ends then. */
  alive?: () => boolean
  onEnd: (result: TourResult) => void
  /** YAZ-5366: `'live'` runs one clip's live steps beside the docked course (see the head of this file). */
  variant?: 'tour' | 'live'
  /** Live: how many of the steps have had their moment now; read on each frame. */
  reached?: () => number
  /** Live: false while the course fills the window: the logic runs, nothing is drawn. Default true. */
  visible?: boolean
  /** Live: a do step lights up now (the course asks for the corner). */
  onDoStep?: () => void
}

/** The coach waits this long before it says where a control is, so a menu that opens a moment late does not flash it. */
export const HINT_AFTER_MS = 600
/** A finished tour shows its last line this long, then the course comes back. */
export const FINISH_MS = 1600

/** What shows over the app that the dim must not cover: menus, pickers, the editor's toolbar and `/` menu. */
const POPUPS = '.ctx-menu, [role="menu"], [role="listbox"], .milkdown-toolbar, .milkdown-slash-menu'
const FOCUSABLE = 'button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
const NO_SIDEBAR = { aside: null, searchShown: false, canClose: false }
const COACH_SIZE = { width: 300, height: 170 }
/** The places a show step may bring into view by itself: they open nothing that changes data (YAZ-5366). */
const SAFE_SHOW: ReadonlySet<TourPlace['kind']> = new Set(['sidebar', 'folder', 'settings'])
const isDoStep = (step: TourStep | null): boolean => step !== null && step.done !== 'show'

const shows = (el: HTMLElement): boolean => {
  if (el.dataset.show === 'false' || el.closest('[hidden]') !== null) return false
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true })) return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}
const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}
const inView = (b: Box, view: { width: number; height: number }): boolean => b.left + b.width > 0 && b.top + b.height > 0 && b.left < view.width && b.top < view.height

/** The step's control: the first mark that shows, one in the window first. Never one inside the tour. */
function findTarget(name: string, layer: Element | null): HTMLElement | null {
  const view = { width: window.innerWidth, height: window.innerHeight }
  const marks = [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].filter((el) => !(layer?.contains(el) ?? false) && shows(el))
  return marks.find((el) => inView(boxOf(el), view)) ?? marks[0] ?? null
}

const reducedMotionQuery = (): MediaQueryList | null => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null)
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (fn) => {
      const q = reducedMotionQuery()
      q?.addEventListener?.('change', fn)
      return () => q?.removeEventListener?.('change', fn)
    },
    () => reducedMotionQuery()?.matches === true,
  )
}

/** What the frame loop measured: the target's box (null: not on screen), the holes, the window, the coach's size. */
interface Seen {
  target: Box | null
  /** The docked course's box (YAZ-5365): not dimmed, and the coach stays off it. */
  course: Box | null
  holes: Box[]
  view: { width: number; height: number }
  coach: { width: number; height: number }
  hint: boolean
  showMe: boolean
  stuck: boolean
}
const NOTHING_SEEN: Seen = { target: null, course: null, holes: [], view: { width: 0, height: 0 }, coach: COACH_SIZE, hint: false, showMe: false, stuck: false }
const sameSeen = (a: Seen, b: Seen): boolean => JSON.stringify(a) === JSON.stringify(b)
const round = (b: Box): Box => ({ left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) })

export function TourLayer({ chapter, steps, host, alive, onEnd, variant = 'tour', reached, visible = true, onDoStep }: TourLayerProps) {
  const live = variant === 'live'
  const reducedMotion = useReducedMotion()
  const layer = useRef<HTMLDivElement>(null)
  const coach = useRef<HTMLElement>(null)
  const tour = useRef<TourState>(null as unknown as TourState)
  if (tour.current === null) tour.current = startTour(steps, live ? (reached?.() ?? 0) : undefined)
  const [, setVersion] = useState(0)
  const [seen, setSeen] = useState<Seen>(NOTHING_SEEN)
  /** The real title of the course's folder (YAZ-5202), for the help lines. */
  const [folderTitle, setFolderTitle] = useState(COURSE_CARDS)
  const ended = useRef(false)
  const doors = useRef({ onEnd, alive, reached, visible, onDoStep })
  doors.current = { onEnd, alive, reached, visible, onDoStep }

  const dispatch = useCallback((action: TourAction) => {
    const before = tour.current
    const next = tourStep(before, action)
    if (next === before) return
    tour.current = next
    setVersion((v) => v + 1)
  }, [])
  const end = useCallback((result: TourResult) => {
    if (ended.current) return
    ended.current = true
    doors.current.onEnd(result)
  }, [])

  // ---- the check: the Course Cards folder and its cards (6F's host) ----
  useEffect(() => {
    let live = true
    void checkTour(chapter.id, host).then(
      (r) => {
        if (!live) return
        if ('blocked' in r) return dispatch({ type: 'blocked', reason: r.blocked })
        setFolderTitle(r.folderTitle ?? COURSE_CARDS)
        setTourPlaces(r.places)
        dispatch({ type: 'ready', places: r.places })
      },
      () => live && dispatch({ type: 'blocked', reason: 'The course could not find its Course Cards folder.' }),
    )
    return () => {
      live = false
      setTourPlaces(null)
    }
  }, [chapter.id, host, dispatch])

  // ---- the person's real actions: the app's events, a click on a marked control ----
  useEffect(() => listenTour((name, detail) => dispatch({ type: 'event', name, detail, at: performance.now() })), [dispatch])
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      if (target === null || layer.current?.contains(target) === true) return
      const step = currentStep(tour.current)
      if (step !== null && step.done === 'click' && target.closest(`[data-tour="${step.target}"]`) !== null) dispatch({ type: 'click', target: step.target })
    }
    // The capture phase: the tour hears the click first, and lets it go on to the control.
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [dispatch])

  // ---- Esc: the last in the app's order, before the sidebar (a live step has none: the docked course has its own) ----
  useEffect(() => {
    if (live) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const inCoach = e.target instanceof Node && coach.current?.contains(e.target) === true
      if (!inCoach) {
        const facts = readEscapeFacts(e, NO_SIDEBAR)
        if (facts.owner || facts.explore || facts.inText) return
      }
      e.preventDefault()
      e.stopPropagation()
      if (tour.current.status === 'finished') end('finished')
      else dispatch({ type: 'leave' })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dispatch, end, live])

  // ---- the frame loop: where the control is, the holes, the help ----
  const focusedStep = useRef(-1)
  /** Live: the do step the course was told of last, and the show step brought into view last. */
  const toldDo = useRef(-1)
  const showedPlace = useRef(-1)
  useEffect(() => {
    let raf = requestAnimationFrame(function frame() {
      const at = performance.now()
      if (doors.current.alive !== undefined && !doors.current.alive()) {
        dispatch({ type: 'leave' })
        return
      }
      const drawn = !live || doors.current.visible !== false
      if (live) dispatch({ type: 'reach', count: doors.current.reached?.() ?? 0 })
      const view = { width: window.innerWidth, height: window.innerHeight }
      const step = drawn ? shownStep(tour.current) : null
      const el = step === null ? null : findTarget(step.target, layer.current)
      const box = el === null ? null : boxOf(el)
      const onScreen = box !== null && inView(box, view)
      dispatch({ type: 'frame', at, onScreen: onScreen || !drawn })
      const s = tour.current
      if (live && s.status === 'running') {
        const now = shownStep(s)
        // A do step lights up: the course asks for the corner (the person's own size still wins).
        if (isDoStep(now) && toldDo.current !== s.index) {
          toldDo.current = s.index
          doors.current.onDoStep?.()
        }
        // A show step whose control is not on screen: the app's own navigation brings a safe place into view, once.
        if (drawn && now !== null && !isDoStep(now) && s.missingSince !== null && at - s.missingSince >= HINT_AFTER_MS && showedPlace.current !== s.index) {
          showedPlace.current = s.index
          const place = TARGET_HELP[now.target]?.show?.({ places: s.places, lastCard: s.lastCard }) ?? null
          if (place !== null && SAFE_SHOW.has(place.kind)) showTourPlace(place)
        }
      }
      if (!drawn) {
        // The course fills the window: nothing is drawn, so nothing is measured.
        setLitBox(null)
        setSeen((prev) => (prev === NOTHING_SEEN ? prev : NOTHING_SEEN))
        raf = requestAnimationFrame(frame)
        return
      }
      // The keyboard goes to the control once per step, and only from the coach card or from nowhere (a do step).
      if (el !== null && s.status === 'running' && focusedStep.current !== s.index && (!live || isDoStep(step))) {
        focusedStep.current = s.index
        const active = document.activeElement
        const fromNowhere = active === null || active === document.body || (coach.current?.contains(active) ?? false)
        if (fromNowhere) {
          if (el.matches(FOCUSABLE)) el.focus({ preventScroll: true })
          else if (active instanceof HTMLElement && coach.current?.contains(active)) active.blur()
        }
      }
      // The holes for open menus matter only under a dim: a live show step, or no step, has none.
      const dimmed = !live || isDoStep(step)
      const popups = !dimmed ? [] : [...document.querySelectorAll<HTMLElement>(POPUPS)].filter((p) => !(layer.current?.contains(p) ?? false) && shows(p)).map((p) => round(holeOf(boxOf(p), view, 0)))
      const target = onScreen && box !== null ? round(holeOf(box, view)) : null
      // The lit control, for a docked corner to move away from; the docked course, left out of the dim.
      setLitBox(target)
      const area = courseArea()
      const course = area === null ? null : round(holeOf(area, view, 0))
      const help = step === null ? undefined : TARGET_HELP[step.target]
      const stuckEl = help?.stuck === undefined || s.missingSince === null ? null : document.querySelector<HTMLElement>(help.stuck.selector)
      const measured = coach.current?.getBoundingClientRect()
      const next: Seen = {
        target,
        course,
        holes: [...(target === null ? [] : [target]), ...popups, ...(course === null ? [] : [course])],
        view,
        coach: measured !== undefined && measured.width > 0 ? { width: Math.round(measured.width), height: Math.round(measured.height) } : COACH_SIZE,
        hint: s.missingSince !== null && at - s.missingSince >= HINT_AFTER_MS,
        showMe: offersShowMe(s, at),
        stuck: s.missingSince !== null && stuckEl !== null && shows(stuckEl),
      }
      setSeen((prev) => (sameSeen(prev, next) ? prev : next))
      raf = requestAnimationFrame(frame)
    })
    return () => {
      cancelAnimationFrame(raf)
      setLitBox(null)
    }
  }, [dispatch, live])

  // ---- the end ----
  const s = tour.current
  const back = useRef<HTMLButtonElement>(null)
  // Live: the course goes on once no do step is left, or when the steps cannot run (the line stays on screen).
  const doLeft = s.status === 'running' && s.steps.slice(s.index).some((st) => st.done !== 'show')
  useEffect(() => {
    if (!live) return
    if (s.status === 'left' || s.status === 'blocked') end('left')
    else if (s.status === 'finished' || (s.status === 'running' && !doLeft)) end('finished')
  }, [live, s.status, doLeft, end])
  useEffect(() => {
    if (live) return
    if (s.status === 'left') return end('left')
    if (s.status !== 'blocked' && s.status !== 'finished') return
    // One way on: the keyboard goes to "Back to the course", if it is on the coach card or nowhere.
    const active = document.activeElement
    if (active === null || active === document.body || (coach.current?.contains(active) ?? false)) back.current?.focus()
    if (s.status !== 'finished') return
    const timer = setTimeout(() => end('finished'), FINISH_MS)
    return () => clearTimeout(timer)
  }, [live, s.status, end])

  const step = live ? (visible ? shownStep(s) : null) : currentStep(s)
  const help = step === null ? undefined : TARGET_HELP[step.target]
  const showMe = (): void => {
    if (step === null) return
    const el = findTarget(step.target, layer.current)
    if (el !== null) return el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
    const place = help?.show?.({ places: s.places, lastCard: s.lastCard }) ?? null
    if (place !== null) showTourPlace(place)
  }
  const exampleEl = step?.example === undefined || s.status !== 'running' || seen.target === null ? null : findTarget(step.target, layer.current)
  // Only into Course Cards (YAZ-5366): the name box of the course's folder, the editor of a card file in it.
  const canExample = step !== null && step.example !== undefined && exampleSafe(s, step) && canFillExample(exampleEl)
  const useExample = (): void => {
    if (step?.example === undefined) return
    const el = findTarget(step.target, layer.current)
    if (el !== null) fillExample(el, step.example)
  }
  const canShow = step !== null && (help?.show !== undefined || findTarget(step.target, layer.current) !== null)
  const waitsForNext = step !== null && typeof step.done === 'object' && step.done.event === 'tour-next'
  const hint = step === null || !seen.hint ? null : seen.stuck && help?.stuck !== undefined ? help.stuck.say : help === undefined ? null : inFolder(help.where, folderTitle)
  const place = coachPlace(seen.target, seen.coach, seen.view.width > 0 ? seen.view : { width: window.innerWidth, height: window.innerHeight }, seen.course)
  const line =
    s.status === 'checking' ? 'Getting ready…'
    : s.status === 'blocked' ? (s.blocked ?? '')
    : s.status === 'finished' ? 'Done. You did it in the real app.'
    : (step?.say ?? '')

  if (live) {
    const doing = isDoStep(step)
    const blocked = s.status === 'blocked' && visible
    const coachShows = blocked || (step !== null && (doing || step.say !== ''))
    return (
      <div ref={layer} className="course-tour course-tour--live" data-reduced-motion={reducedMotion ? 'true' : undefined} data-live-step={step === null ? undefined : doing ? 'do' : 'show'}>
        {doing && (
          <svg className="course-tour__dim" aria-hidden="true" width={seen.view.width || undefined} height={seen.view.height || undefined}>
            <path d={dimPath(seen.view.width > 0 ? seen.view : { width: window.innerWidth, height: window.innerHeight }, seen.holes)} />
          </svg>
        )}
        {seen.target !== null && step !== null && (
          <div className="course-tour__ring" aria-hidden="true" style={{ left: seen.target.left, top: seen.target.top, width: seen.target.width, height: seen.target.height }} />
        )}
        {coachShows && (
          <section ref={coach} className="course-tour__coach" aria-label="In the app" style={{ left: place.left, top: place.top }} onMouseDown={(e) => e.preventDefault()}>
            <p className="course-tour__where">In the app · {chapter.title}</p>
            <p className="course-tour__say" aria-live="polite" aria-atomic="true">
              {blocked ? (s.blocked ?? '') : (step?.say ?? '')}
            </p>
            {hint !== null && (
              <p className="course-tour__hint" aria-live="polite">
                {hint}
              </p>
            )}
            {doing && (
              <div className="course-tour__actions">
                {seen.showMe && canShow && (
                  <button type="button" className="course-tour__btn" onClick={showMe}>
                    Show me
                  </button>
                )}
                {canExample && (
                  <button type="button" className="course-tour__btn" onClick={useExample}>
                    {USE_AN_EXAMPLE}
                  </button>
                )}
                <button type="button" className="course-tour__btn" onClick={() => dispatch({ type: 'skip' })}>
                  Skip
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    )
  }

  return (
    <div ref={layer} className="course-tour" data-reduced-motion={reducedMotion ? 'true' : undefined}>
      <svg className="course-tour__dim" aria-hidden="true" width={seen.view.width || undefined} height={seen.view.height || undefined}>
        <path d={dimPath(seen.view.width > 0 ? seen.view : { width: window.innerWidth, height: window.innerHeight }, seen.holes)} />
      </svg>
      {seen.target !== null && step !== null && (
        <div className="course-tour__ring" aria-hidden="true" style={{ left: seen.target.left, top: seen.target.top, width: seen.target.width, height: seen.target.height }} />
      )}
      {/* A press on the coach card keeps the keyboard where it is: a name box or the card editor stays open. */}
      <section ref={coach} className="course-tour__coach" aria-label="Try it in the app" style={{ left: place.left, top: place.top }} onMouseDown={(e) => e.preventDefault()}>
        <p className="course-tour__where">Try it in the app · {chapter.title}</p>
        <p className="course-tour__say" aria-live="polite" aria-atomic="true">
          {line}
          {step !== null && (
            <span className="course-tour__count">
              Step {s.index + 1} of {s.steps.length}
            </span>
          )}
        </p>
        {hint !== null && (
          <p className="course-tour__hint" aria-live="polite">
            {hint}
          </p>
        )}
        <div className="course-tour__actions">
          {step !== null && seen.showMe && canShow && (
            <button type="button" className="course-tour__btn" onClick={showMe}>
              Show me
            </button>
          )}
          {canExample && (
            <button type="button" className="course-tour__btn" onClick={useExample}>
              {USE_AN_EXAMPLE}
            </button>
          )}
          {waitsForNext && (
            <button type="button" className="course-tour__btn course-tour__btn--primary" onClick={() => dispatch({ type: 'event', name: 'tour-next', at: performance.now() })}>
              Next
            </button>
          )}
          <button
            ref={back}
            type="button"
            className={`course-tour__btn${s.status === 'blocked' || s.status === 'finished' ? ' course-tour__btn--primary' : ''}`}
            onClick={() => (s.status === 'finished' ? end('finished') : dispatch({ type: 'leave' }))}
          >
            Back to the course
          </button>
          {step !== null && (
            <button type="button" className="course-tour__btn" onClick={() => dispatch({ type: 'skip' })}>
              Skip
            </button>
          )}
        </div>
      </section>
    </div>
  )
}
