/**
 * THE CARD COURSE (YAZ-5120, issue 6B of YAZ-5118): a full layer over the app window, loaded only when it opens
 * (`lazy` in App). Left: the chapter list, with a mark on each finished chapter. Right: the stage (the clip's scene),
 * the caption line (fixed height, always on screen), the progress bar, and the controls: Play / Pause, Back, Next,
 * Next chapter, Mute, Speed (1×, 1.25×, 1.5×), "Try it in the app" (only on a chapter with `tryIt`), Close.
 *
 * - The player is pure (`player.ts`); this file is its clock and its sound. While it plays, each frame sends `clock`
 *   (the sound's own time) or `tick` (the page clock: no sound, a muted-in-error clip, the gap after the words).
 *   Mute only mutes the sound: it still plays, so the timing stays the same.
 * - The place, the finished chapters, Mute and Speed are `AppState.course` (`storage.setCourse`), kept per Mac.
 * - Keys: Space plays or pauses while the course has the keyboard and no text field or button has it; Esc closes the
 *   course (it is a dialog in the app's Esc order, step 2); Tab stays inside the layer; no key reaches the app under it.
 *   Closing gives the keyboard back to where it was.
 * - `prefers-reduced-motion`: the scenes and the layer cross-fade in place of movement (`course.css`, `reducedMotion`).
 * - The seams: `scenes` (6C: `scenes/index.ts`; a span of clips keeps one scene mounted), `voice` (6D1: per chapter, downloaded when needed), `tour` (6E), `host` (6F). Each has a
 *   default: the course's scenes (the placeholder for a chapter not built yet), silence, "coming next", and a host that makes nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { COURSE_SPEEDS, type CourseSpeed } from '@shared/courseState'
import { storage } from '../lib/storage'
import { COURSE, type CourseChapter, type CourseClip } from './script'
import { clipSeconds } from './courseTime'
import { WAITING_CLIPS } from './waits'
import { chapterFraction, clipFraction, placeOf, startState, step, waitingForPerson, type PlayerAction, type PlayerContext, type PlayerEvent, type PlayerState } from './player'
import { SILENT_VOICE, type ChapterSound, type ClipSound, type Voice } from './courseVoice'
import { comingNextTour, hasTour, type CourseTour } from './courseTour'
import { showOnlyHost, type CourseHost } from './courseHost'
import { courseScenes } from './scenes'
import type { SceneClock, SceneFor, SceneTime } from './scene'
import './course.css'

export interface CardCourseProps {
  /** Open at the start of this chapter (its id in `script.ts`); absent: at the saved place. */
  chapter?: string
  /** The window's active vault, for the course's side effects; null with none open. */
  vault: string | null
  onClose: () => void
  /** The seams, each with the frame's default. `course` is the script; tests give a small one. */
  course?: readonly CourseChapter[]
  scenes?: SceneFor
  voice?: Voice
  tour?: CourseTour
  host?: CourseHost
}

const SPEED_LABEL: Record<CourseSpeed, string> = { 1: '1×', 1.25: '1.25×', 1.5: '1.5×' }
const FIELD = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
/** What Space already presses (a button, a link, a tab): Space is theirs there, not the player's. */
const PRESSABLE = 'button, a[href], [role="button"], [role="tab"], [role="radio"], [role="checkbox"], summary'
const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'

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

/** A clock that scenes subscribe to: it changes each frame, and the layer does not render for it. */
function createClock(read: () => SceneTime) {
  const frames = new Set<() => void>()
  const marks = new Set<(index: number) => void>()
  const clock: SceneClock = {
    now: read,
    subscribe: (fn) => {
      frames.add(fn)
      return () => frames.delete(fn)
    },
    onMark: (fn) => {
      marks.add(fn)
      return () => marks.delete(fn)
    },
  }
  return { clock, frame: () => frames.forEach((fn) => fn()), mark: (index: number) => marks.forEach((fn) => fn(index)) }
}

export function CardCourse({ chapter: openAt, vault, onClose, course = COURSE, scenes = courseScenes, voice = SILENT_VOICE, tour: tourIn, host: hostIn }: CardCourseProps) {
  const reducedMotion = useReducedMotion()

  // ---- the voice (6D1): each chapter's sound once it is here; the clip that plays keeps what it started with ----
  const sounds = useRef(new Map<string, ChapterSound>())
  const chapterOfClip = useMemo(() => new Map(course.flatMap((ch) => ch.clips.map((c) => [c.id, ch.id] as const))), [course])
  const soundOf = useCallback(
    (clipId: string): ClipSound | null => {
      const sound = sounds.current.get(chapterOfClip.get(clipId) ?? '')?.clip(clipId) ?? null
      return sound !== null && Number.isFinite(sound.seconds) && sound.seconds > 0 ? sound : null
    },
    [chapterOfClip],
  )
  /** The sound the playing clip started with (null: silent). A sound that arrives later is used from the next clip. */
  const frozen = useRef<{ clip: string; sound: ClipSound | null }>({ clip: '', sound: null })
  const soundNow = (clip: CourseClip): ClipSound | null => (frozen.current.clip === clip.id ? frozen.current.sound : soundOf(clip.id))
  const soundNowRef = useRef(soundNow)
  soundNowRef.current = soundNow

  const ctx: PlayerContext = useMemo(
    () => ({ course, seconds: (clip: CourseClip) => clipSeconds(clip, soundNowRef.current(clip)?.seconds ?? null), waits: (clip: CourseClip) => WAITING_CLIPS.has(clip.id) }),
    [course],
  )
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  // The player: in a ref, so a frame changes no React state; `version` renders what the eye needs (not each frame).
  const player = useRef<PlayerState>(null as unknown as PlayerState)
  if (player.current === null) player.current = startState(ctx, storage.getCourse(), openAt)
  const enteredChapter = useRef(course[player.current.chapter].id)
  if (frozen.current.clip === '') frozen.current = { clip: course[player.current.chapter].clips[player.current.clip].id, sound: null }
  const [, setVersion] = useState(0)
  const rerender = useCallback(() => setVersion((v) => v + 1), [])
  const fetchSound = useCallback(
    (chapterId: string) => {
      void voice.chapter(chapterId).then(
        (sound) => {
          if (sound === null) return
          sounds.current.set(chapterId, sound)
          // A clip that has not started yet takes the sound now; a clip that plays keeps its own to its end.
          const p = player.current
          const clip = course[p.chapter].clips[p.clip]
          if (p.phase === 'clip' && !p.playing && p.t === 0 && course[p.chapter].id === chapterId) {
            frozen.current = { clip: clip.id, sound: soundOf(clip.id) }
            rerender()
          }
        },
        () => undefined,
      )
    },
    [voice, course, soundOf, rerender],
  )
  /** A chapter starts: the downloader hears of it, and the course takes its sound if it is here already. */
  const startChapter = useCallback(
    (chapterId: string) => {
      voice.chapterStarting(chapterId)
      fetchSound(chapterId)
    },
    [voice, fetchSound],
  )
  useEffect(() => {
    startChapter(course[player.current.chapter].id)
    return voice.onArrive(fetchSound)
  }, [voice, course, startChapter, fetchSound])
  const [page, setPage] = useState<string | null>(null)
  const [touring, setTouring] = useState(false)

  const clockRef = useRef<ReturnType<typeof createClock>>(null as unknown as ReturnType<typeof createClock>)
  if (clockRef.current === null) {
    clockRef.current = createClock(() => {
      const s = player.current
      const c = ctxRef.current
      const clip = c.course[s.chapter].clips[s.clip]
      const length = c.seconds(clip)
      return { t: Math.min(s.t, length), length, fraction: clipFraction(c, s), playing: s.playing }
    })
  }
  const barRef = useRef<HTMLSpanElement>(null)
  const paintBar = useCallback(() => {
    const fraction = chapterFraction(ctxRef.current, player.current)
    if (barRef.current !== null) barRef.current.style.transform = `scaleX(${fraction.toFixed(4)})`
  }, [])

  // ---- the sound ----
  const audio = useRef<HTMLAudioElement | null>(null)
  const audioClip = useRef<string | null>(null)
  const broken = useRef(new Set<string>())
  const lastAudio = useRef({ at: -1, stalled: 0 })
  const audioOf = useCallback((): HTMLAudioElement | null => {
    if (audio.current === null && typeof Audio === 'function') {
      const el = new Audio()
      el.preload = 'auto'
      el.addEventListener('error', () => {
        if (audioClip.current !== null) broken.current.add(audioClip.current)
      })
      audio.current = el
    }
    return audio.current
  }, [])
  /** The sound follows the player: the clip's file, at the clip's time, the speed and Mute; paused unless it plays. */
  const syncSound = useCallback(
    (restart: boolean) => {
      const s = player.current
      const c = ctxRef.current
      const clip = c.course[s.chapter].clips[s.clip]
      const url = s.phase === 'clip' && !broken.current.has(clip.id) ? (soundNowRef.current(clip)?.url ?? null) : null
      const el = url === null ? audio.current : audioOf()
      if (el === null) return
      if (url === null) {
        el.pause()
        return
      }
      if (audioClip.current !== clip.id) {
        el.src = url
        audioClip.current = clip.id
        lastAudio.current = { at: -1, stalled: 0 }
      }
      el.muted = s.muted
      el.playbackRate = s.speed
      const length = c.seconds(clip)
      if (s.playing && s.t < length - 0.05) {
        if (restart || Math.abs(el.currentTime - s.t) > 0.3) {
          try {
            el.currentTime = s.t
          } catch {
            // Not seekable yet: it starts from 0, which is where a new clip is.
          }
        }
        const started = el.play()
        started?.catch?.((err: unknown) => {
          if (!(err instanceof DOMException && err.name === 'AbortError')) broken.current.add(clip.id)
        })
      } else el.pause()
    },
    [audioOf],
  )
  useEffect(
    () => () => {
      audio.current?.pause()
      audio.current = null
    },
    [],
  )

  // ---- the player's events ----
  const handle = useCallback(
    (events: readonly PlayerEvent[]) => {
      for (const e of events) {
        if (e.kind === 'mark') clockRef.current.mark(e.index)
        else if (e.kind === 'enter') {
          frozen.current = { clip: e.clip, sound: soundOf(e.clip) }
          if (e.chapter !== enteredChapter.current) startChapter(e.chapter)
          enteredChapter.current = e.chapter
          storage.setCourse(placeOf(ctxRef.current, player.current))
        }
        else if (e.kind === 'chapter-end') storage.setCourse({ ...placeOf(ctxRef.current, player.current), finished: [...player.current.finished] })
        else storage.setCourse({ done: true, ...placeOf(ctxRef.current, player.current) })
      }
    },
    [soundOf, startChapter],
  )
  const dispatch = useCallback(
    (action: PlayerAction) => {
      const before = player.current
      const { state, events } = step(ctxRef.current, before, action)
      if (state === before) return
      player.current = state
      handle(events)
      const moved = state.chapter !== before.chapter || state.clip !== before.clip || state.phase !== before.phase || events.some((e) => e.kind === 'enter')
      if (action.type === 'speed') storage.setCourse({ speed: state.speed })
      if (action.type === 'mute') storage.setCourse({ muted: state.muted })
      if (moved || state.playing !== before.playing || state.speed !== before.speed || state.muted !== before.muted || state.released !== before.released) {
        syncSound(moved)
        rerender()
      }
      if (waitingForPerson(ctxRef.current, state) !== waitingForPerson(ctxRef.current, before)) rerender()
      paintBar()
      clockRef.current.frame()
    },
    [handle, syncSound, rerender, paintBar],
  )

  // ---- the clock: one frame loop while it plays ----
  const s = player.current
  const running = s.playing && s.phase === 'clip' && !touring
  useEffect(() => {
    if (!running) {
      audio.current?.pause()
      return
    }
    syncSound(false)
    let last = performance.now()
    let raf = requestAnimationFrame(function frame(now) {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const p = player.current
      const clip = ctxRef.current.course[p.chapter].clips[p.clip]
      const el = audio.current
      const sounding = el !== null && audioClip.current === clip.id && !broken.current.has(clip.id) && !el.paused && !el.ended && p.t < ctxRef.current.seconds(clip)
      if (sounding) {
        const at = el.currentTime
        if (at !== lastAudio.current.at) {
          lastAudio.current = { at, stalled: 0 }
          dispatch({ type: 'clock', t: at })
        } else {
          // Not started yet, or between coarse time updates: a short wait. A sound that does not move runs on the page clock.
          lastAudio.current.stalled += dt
          if (lastAudio.current.stalled > 1.5) {
            broken.current.add(clip.id)
            el.pause()
          }
        }
      } else dispatch({ type: 'tick', dt })
      raf = requestAnimationFrame(frame)
    })
    return () => cancelAnimationFrame(raf)
  }, [running, dispatch, syncSound])
  useEffect(() => {
    paintBar()
  })

  // ---- the keys ----
  const layer = useRef<HTMLDivElement>(null)
  const playButton = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    audio.current?.pause()
    onClose()
  }, [onClose])
  const keys = useRef({ close, dispatch })
  keys.current = { close, dispatch }
  useEffect(() => {
    const opener = document.activeElement
    playButton.current?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  useEffect(() => {
    if (touring) return
    const onKey = (e: KeyboardEvent): void => {
      const inside = e.target instanceof Node && layer.current?.contains(e.target) === true
      if (e.key === 'Escape') {
        if (e.isComposing) return
        e.preventDefault()
        e.stopPropagation()
        keys.current.close()
        return
      }
      if (!inside) {
        // A key aimed at the app under the course: swallowed, and the keyboard comes back into the course.
        e.preventDefault()
        e.stopPropagation()
        layer.current?.focus()
        return
      }
      const target = e.target instanceof Element ? e.target : null
      if (e.key === ' ' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && target?.closest(FIELD) == null && target?.closest(PRESSABLE) == null) {
        e.preventDefault()
        keys.current.dispatch({ type: 'toggle' })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [touring])
  const onLayerKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // No key typed in the course travels on to the app (its Esc, its shortcuts).
    e.stopPropagation()
    if (e.key !== 'Tab') return
    const all = [...(layer.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (all.length === 0) return
    const i = all.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    all[e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : (i + 1) % all.length]?.focus()
  }

  // ---- the tour ----
  const tour = useMemo(() => tourIn ?? comingNextTour((line) => setPage(line)), [tourIn])
  const host = useMemo(() => hostIn ?? showOnlyHost(vault), [hostIn, vault])
  const tryIt = useCallback(() => {
    const chapter = ctxRef.current.course[player.current.chapter]
    if (!hasTour(chapter)) return
    keys.current.dispatch({ type: 'pause' })
    setPage(null)
    setTouring(true)
    void tour
      .start(chapter, chapter.tryIt ?? [])
      .catch(() => 'left' as const)
      .then(() => {
        setTouring(false)
        requestAnimationFrame(() => playButton.current?.focus())
      })
  }, [tour])

  // ---- what shows ----
  const chapter = ctx.course[s.chapter]
  const clip = chapter.clips[s.clip]
  const Scene = scenes(clip.id)
  const waits = ctx.waits(clip)
  const done = useCallback(() => keys.current.dispatch({ type: 'release' }), [])
  const finished = new Set(s.finished)
  const last = s.chapter === ctx.course.length - 1
  const caption = s.phase === 'clip' ? clip.text : s.phase === 'chapter-end' ? `Chapter ${s.chapter + 1} done. Next: ${ctx.course[s.chapter + 1].title}.` : "That's the whole course."
  const tourButton = hasTour(chapter) && (
    <button type="button" className="course__btn course__btn--try" onClick={tryIt}>
      Try it in the app
    </button>
  )

  return (
    <div
      ref={layer}
      className="course"
      role="dialog"
      aria-modal="true"
      aria-label="Card course"
      tabIndex={-1}
      hidden={touring}
      data-reduced-motion={reducedMotion ? 'true' : undefined}
      onKeyDown={onLayerKey}
    >
      <nav className="course__chapters" aria-label="Chapters">
        <p className="course__name">Card course</p>
        <ol className="course__list">
          {ctx.course.map((ch, i) => (
            <li key={ch.id}>
              <button
                type="button"
                className="course__chapter"
                aria-current={i === s.chapter ? 'step' : undefined}
                data-finished={finished.has(ch.id) ? 'true' : undefined}
                onClick={() => dispatch({ type: 'chapter', index: i })}
              >
                <span className="course__mark" aria-hidden="true">
                  {finished.has(ch.id) ? '✓' : ''}
                </span>
                <span className="course__number">{i + 1}</span>
                <span className="course__title">{ch.title}</span>
                {finished.has(ch.id) && <span className="course__vh">, finished</span>}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="course__main">
        <div className="course__head">
          <p className="course__where">
            Chapter {s.chapter + 1} of {ctx.course.length} · {chapter.title}
          </p>
          <button type="button" className="course__btn course__btn--close" aria-label="Close the course" onClick={close}>
            Close
          </button>
        </div>
        <div className="course__stage" role="region" aria-label="Lesson">
          {s.phase === 'clip' ? (
            <Scene key={scenes.spanOf?.(clip.id) ?? `${chapter.id}/${clip.id}`} chapter={chapter} clip={clip} waits={waits} clock={clockRef.current.clock} done={done} reducedMotion={reducedMotion} host={host} />
          ) : (
            <div className="course-scene course-scene--end">
              <p className="course-scene__words">{s.phase === 'course-end' ? "That's the whole course." : `Chapter ${s.chapter + 1} done.`}</p>
              <div className="course__end-actions">
                {tourButton}
                {s.phase === 'chapter-end' ? (
                  <button type="button" className="course__btn course__btn--primary" onClick={() => dispatch({ type: 'next' })}>
                    Next chapter
                  </button>
                ) : (
                  <>
                    <button type="button" className="course__btn" onClick={() => dispatch({ type: 'play' })}>
                      Start again
                    </button>
                    <button type="button" className="course__btn course__btn--primary" onClick={close}>
                      Close
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <p className="course__caption" aria-live="polite">
          {caption}
        </p>
        {page !== null && (
          <p className="course__note" role="status">
            {page}
          </p>
        )}
        <div className="course__bar" aria-hidden="true">
          <span ref={barRef} />
        </div>
        <div className="course__controls">
          <button ref={playButton} type="button" className="course__btn course__btn--play" aria-label={s.playing ? 'Pause' : 'Play'} onClick={() => dispatch({ type: 'toggle' })}>
            {s.playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="course__btn" aria-label="Back one step" onClick={() => dispatch({ type: 'back' })}>
            Back
          </button>
          <button type="button" className="course__btn" aria-label="Next step" disabled={s.phase === 'course-end'} onClick={() => dispatch({ type: 'next' })}>
            Next
          </button>
          <button type="button" className="course__btn" disabled={last} onClick={() => dispatch({ type: 'next-chapter' })}>
            Next chapter
          </button>
          <span className="course__spacer" />
          <button type="button" className="course__btn" aria-pressed={s.muted} onClick={() => dispatch({ type: 'mute', muted: !s.muted })}>
            {s.muted ? 'Unmute' : 'Mute'}
          </button>
          <span className="course__speed" role="group" aria-label="Speed">
            {COURSE_SPEEDS.map((speed) => (
              <button key={speed} type="button" className="course__btn course__btn--speed" aria-pressed={s.speed === speed} onClick={() => dispatch({ type: 'speed', speed })}>
                {SPEED_LABEL[speed]}
              </button>
            ))}
          </span>
          {s.phase === 'clip' && tourButton}
        </div>
      </div>
    </div>
  )
}
