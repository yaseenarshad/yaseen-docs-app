/**
 * THE CARD COURSE (YAZ-5120, issue 6B of YAZ-5118): a full layer over the app window, loaded only when it opens
 * (`lazy` in App). Left: the chapter list, with a mark on each finished chapter. Right: the stage (the clip's scene),
 * the caption line (fixed height, always on screen), the progress bar (a scrubber: `CourseScrubber.tsx`), and the controls: Play / Pause, Back, Next,
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
 *   default: the course's scenes, silence, the real tour (`appTour`), and the host (the real one once App gives the vault's view, else one that makes nothing and says why).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { COURSE_SPEEDS, type CourseSpeed } from '@shared/courseState'
import { storage } from '../lib/storage'
import { COURSE, type CourseChapter, type CourseClip } from './script'
import { clipSeconds } from './courseTime'
import { WAITING_CLIPS } from './waits'
import { clipFraction, placeOf, startState, step, waitingForPerson, type PlayerAction, type PlayerContext, type PlayerEvent, type PlayerState } from './player'
import { SILENT_VOICE, type ChapterSound, type ClipSound, type Voice } from './courseVoice'
import { downloadedVoice } from './downloadedVoice'
import { CourseScrubber, type CourseScrubberHandle } from './CourseScrubber'
import { appTour, hasTour, type CourseTour } from './courseTour'
import { NO_VAULT, showOnlyHost, type CourseHost, type CourseVault } from './courseHost'
import { SHOW_ONLY, vaultCourseHost } from './courseCards'
import { courseScenes } from './scenes'
import { CourseEnd } from './scenes/finale'
import type { SceneClock, SceneFor, SceneTime } from './scene'
import './course.css'

export interface CardCourseProps {
  /** Open at the start of this chapter (its id in `script.ts`); absent: at the saved place. */
  chapter?: string
  /** The course's ONE vault for this run (YAZ-5201), for its side effects; null with none open. */
  vault: string | null
  onClose: () => void
  /** The seams, each with its default. `course` is the script; tests give a small one. */
  course?: readonly CourseChapter[]
  scenes?: SceneFor
  voice?: Voice
  tour?: CourseTour
  host?: CourseHost
  /**
   * The live view of the course's vault (YAZ-5124): with it, and no `host`, the course makes real files (`vaultCourseHost`).
   * The course is bound to its first view of `vault` for the whole run (YAZ-5201): a later view changes nothing. Until a
   * view comes, the course says that the vault is still loading.
   */
  courseVault?: CourseVault
  /** The vault kept with the course's place is not in the window (YAZ-5201): one line, no file is made, and a way to start over in the vault in front. */
  lost?: { line: string; startOver?: { label: string; run: () => void } }
}

/**
 * The voice starts with the first word (YAZ-5159): a chapter whose sound is not here yet holds its first clip at its
 * first frame this long at most (seconds of play), waiting for the sound; after `VOICE_LOADING_LINE_AFTER` the quiet
 * line says so. The same limit holds the clip's clock while its audio element has not started to move.
 *
 * While the downloader says the chapter's sound is DOWNLOADING (YAZ-5346), the hold lasts up to
 * `VOICE_DOWNLOAD_LIMIT` instead, with the line and "Play without sound" at once. It ends when the sound arrives (the
 * first word), when the download fails ("Try again"), on "Play without sound", on Mute, or at the limit (then the
 * chapter plays without the voice, and the "Try again" line says so).
 */
export const VOICE_WAIT_LIMIT = 2
export const VOICE_DOWNLOAD_LIMIT = 20
export const VOICE_LOADING_LINE_AFTER = 0.5
export const VOICE_LOADING_LINE = 'Loading the voice…'
export const PLAY_WITHOUT_SOUND = 'Play without sound'

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

export function CardCourse({ chapter: openAt, vault, onClose, course = COURSE, scenes = courseScenes, voice = SILENT_VOICE, tour: tourIn, host: hostIn, courseVault: courseVaultIn, lost }: CardCourseProps) {
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
  /** The next chapters already asked for (one ask each while the course is open). */
  const asked = useRef(new Set<string>())
  /** The first clip of a chapter whose sound is not here yet: held at its first frame, `held` seconds of play so far. */
  const voiceWait = useRef<{ clip: string; chapter: string; held: number } | null>(null)
  const [loadingVoice, setLoadingVoice] = useState(false)
  /** The chapters the downloader says are downloading now (YAZ-5346): their first clip holds longer. */
  const downloading = useRef(new Set<string>())
  /** The chapters the person chose to play without sound ("Play without sound"): no hold on them again. */
  const silentByChoice = useRef(new Set<string>())
  /** The chapters whose sound did not come within the wait: the "Try again" line shows on them. */
  const [late, setLate] = useState<ReadonlySet<string>>(() => new Set())
  const endVoiceWait = useCallback(() => {
    voiceWait.current = null
    setLoadingVoice(false)
  }, [])
  const endLate = useCallback(
    (chapterId: string) =>
      setLate((before) => {
        if (!before.has(chapterId)) return before
        const next = new Set(before)
        next.delete(chapterId)
        return next
      }),
    [],
  )
  /** `syncSound`, for the sound that arrives (it is defined below, with the audio element). */
  const syncSoundRef = useRef<(restart: boolean) => void>(() => undefined)
  const missingRef = useRef<ReadonlySet<string>>(new Set())
  /** A chapter starts with its first clip and no sound here yet: the clip waits for it (never on Mute, never with no voice). */
  const startVoiceWait = useCallback(
    (chapterId: string, clipId: string) => {
      const p = player.current
      if (voice === SILENT_VOICE || p.muted || p.t !== 0 || sounds.current.has(chapterId) || missingRef.current.has(chapterId) || silentByChoice.current.has(chapterId)) return
      voiceWait.current = { clip: clipId, chapter: chapterId, held: 0 }
    },
    [voice],
  )
  const fetchSound = useCallback(
    (chapterId: string) => {
      void voice.chapter(chapterId).then(
        (sound) => {
          if (sound === null) return
          sounds.current.set(chapterId, sound)
          endLate(chapterId)
          // A clip that has not started yet (or that waits for this sound) takes the sound now, from 0; a clip that
          // plays keeps its own to its end.
          const p = player.current
          const clip = course[p.chapter].clips[p.clip]
          const current = course[p.chapter].id === chapterId
          const waiting = voiceWait.current?.clip === clip.id
          if (current && p.phase === 'clip' && p.t === 0 && (!p.playing || waiting)) {
            frozen.current = { clip: clip.id, sound: soundOf(clip.id) }
            endVoiceWait()
            syncSoundRef.current(true)
            rerender()
          }
          // The next chapter's sound is asked for now, so the next chapter starts with its first word.
          const next = course[p.chapter + 1]
          if (current && next !== undefined && !sounds.current.has(next.id) && !asked.current.has(next.id)) {
            asked.current.add(next.id)
            fetchSound(next.id)
          }
        },
        () => undefined,
      )
    },
    [voice, course, soundOf, rerender, endVoiceWait, endLate],
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
    const p = player.current
    if (p.phase === 'clip') startVoiceWait(course[p.chapter].id, course[p.chapter].clips[p.clip].id)
    startChapter(course[p.chapter].id)
    return voice.onArrive(fetchSound)
  }, [voice, course, startChapter, fetchSound, startVoiceWait])
  /** The chapters whose sound could not come (6D1): the quiet line with "Try again" shows on them. */
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(
    () =>
      voice.onLoading?.((chapterId, isLoading) => {
        if (isLoading) downloading.current.add(chapterId)
        else downloading.current.delete(chapterId)
      }),
    [voice],
  )
  useEffect(
    () =>
      voice.onMissing?.((chapterId, isMissing) =>
        setMissing((before) => {
          // The download failed: a first clip that waits for it plays now, without the voice ("Try again" shows).
          if (isMissing && voiceWait.current?.chapter === chapterId) endVoiceWait()
          if (before.has(chapterId) === isMissing) return before
          const next = new Set(before)
          if (isMissing) next.add(chapterId)
          else next.delete(chapterId)
          return next
        }),
      ),
    [voice, endVoiceWait],
  )
  missingRef.current = missing
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
  const barRef = useRef<CourseScrubberHandle>(null)
  const paintBar = useCallback(() => barRef.current?.paint(), [])
  const readPlayer = useCallback(() => player.current, [])

  // ---- the sound ----
  const audio = useRef<HTMLAudioElement | null>(null)
  /** The next clip's file, loading while this clip plays, so a clip change in a chapter has no gap. */
  const nextAudio = useRef<HTMLAudioElement | null>(null)
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
        // The next clip of the chapter starts loading now.
        const after = c.course[s.chapter].clips[s.clip + 1]
        const nextUrl = after === undefined ? null : (soundOf(after.id)?.url ?? null)
        if (nextUrl !== null && typeof Audio === 'function') {
          if (nextAudio.current === null) {
            nextAudio.current = new Audio()
            nextAudio.current.preload = 'auto'
          }
          if (nextAudio.current.getAttribute('src') !== nextUrl) nextAudio.current.src = nextUrl
        }
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
    [audioOf, soundOf],
  )
  syncSoundRef.current = syncSound
  useEffect(
    () => () => {
      audio.current?.pause()
      audio.current = null
      nextAudio.current = null
    },
    [],
  )

  // ---- the player's events ----
  const handle = useCallback(
    (events: readonly PlayerEvent[]) => {
      for (const e of events) {
        if (e.kind === 'mark') clockRef.current.mark(e.index)
        else if (e.kind === 'enter') {
          const newChapter = e.chapter !== enteredChapter.current
          // Asked before the clip freezes its sound: a sound that is here already is used from the first word.
          if (newChapter) startChapter(e.chapter)
          frozen.current = { clip: e.clip, sound: soundOf(e.clip) }
          if (voiceWait.current !== null && voiceWait.current.clip !== e.clip) endVoiceWait()
          if (newChapter && frozen.current.sound === null) startVoiceWait(e.chapter, e.clip)
          enteredChapter.current = e.chapter
          storage.setCourse(placeOf(ctxRef.current, player.current))
        }
        else if (e.kind === 'chapter-end') storage.setCourse({ ...placeOf(ctxRef.current, player.current), finished: [...player.current.finished] })
        else storage.setCourse({ done: true, ...placeOf(ctxRef.current, player.current) })
      }
    },
    [soundOf, startChapter, startVoiceWait, endVoiceWait],
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
      // A seek moves the sound to the same moment (the sound's clock never goes back by itself).
      const sought = action.type === 'seek'
      if (moved || sought || state.playing !== before.playing || state.speed !== before.speed || state.muted !== before.muted || state.released !== before.released) {
        syncSound(moved || sought)
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
      const wait = voiceWait.current
      if (wait !== null && wait.clip === clip.id && p.t === 0 && !p.muted) {
        // The chapter's sound is on its way: the first frame and the caption hold, so the voice starts with the first word.
        wait.held += dt
        const loadingNow = downloading.current.has(wait.chapter)
        if (wait.held >= (loadingNow ? VOICE_DOWNLOAD_LIMIT : VOICE_WAIT_LIMIT)) {
          endVoiceWait()
          setLate((before) => (before.has(wait.chapter) ? before : new Set([...before, wait.chapter])))
        } else {
          if (loadingNow || wait.held >= VOICE_LOADING_LINE_AFTER) setLoadingVoice(true)
          raf = requestAnimationFrame(frame)
          return
        }
      } else if (wait !== null) endVoiceWait()
      const el = audio.current
      const sounding = el !== null && audioClip.current === clip.id && !broken.current.has(clip.id) && !el.paused && !el.ended && p.t < ctxRef.current.seconds(clip)
      if (sounding) {
        const at = el.currentTime
        if (at !== lastAudio.current.at) {
          lastAudio.current = { at, stalled: 0 }
          dispatch({ type: 'clock', t: at })
        } else {
          // Not started yet (a new file loading), or between coarse time updates: the clip's clock waits for the
          // element to move, so the first word is never cut. A sound that does not move runs on the page clock.
          lastAudio.current.stalled += dt
          if (lastAudio.current.stalled > VOICE_WAIT_LIMIT) {
            broken.current.add(clip.id)
            el.pause()
          }
        }
      } else dispatch({ type: 'tick', dt })
      raf = requestAnimationFrame(frame)
    })
    return () => cancelAnimationFrame(raf)
  }, [running, dispatch, syncSound, endVoiceWait])
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
  // The course's ONE vault (YAZ-5201): the vault it opened with, for the whole run. The tab in front may change
  // meanwhile. Its view is the first one App gives for THAT vault: when the view comes after the course opened, the
  // course takes it then; a later view (of this vault or another) changes nothing.
  const [boundVault] = useState(vault)
  const [boundView, setBoundView] = useState(() => (courseVaultIn?.root === vault ? courseVaultIn : undefined))
  if (boundView === undefined && courseVaultIn !== undefined && courseVaultIn.root === boundVault) setBoundView(courseVaultIn)
  const lostLine = lost?.line ?? null
  const host = useMemo(
    () =>
      hostIn ??
      (lostLine !== null
        ? showOnlyHost(null, lostLine)
        : boundVault === null
          ? showOnlyHost(null, NO_VAULT)
          : boundView === undefined
            ? showOnlyHost(boundVault, SHOW_ONLY.loading)
            : vaultCourseHost(boundView)),
    [hostIn, lostLine, boundVault, boundView],
  )
  // The AI step's watch and timer stop with the layer; its state stays for the next open (YAZ-5124).
  useEffect(() => () => host.agentStep.stop(), [host])
  // The real tour over the app (YAZ-5123), with the same host as the scenes.
  const tour = useMemo(() => tourIn ?? appTour(host), [tourIn, host])
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
  const goNext = useCallback(() => dispatch({ type: 'next' }), [dispatch])
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
            <Scene key={scenes.spanOf?.(clip.id) ?? `${chapter.id}/${clip.id}`} chapter={chapter} clip={clip} waits={waits} clock={clockRef.current.clock} done={done} reducedMotion={reducedMotion} host={host} next={goNext} />
          ) : (
            <div className="course-scene course-scene--end">
              <p className="course-scene__words">{s.phase === 'course-end' ? "That's the whole course." : `Chapter ${s.chapter + 1} done.`}</p>
              {s.phase === 'course-end' && <CourseEnd host={host} />}
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
        {lost !== undefined && (
          <p className="course__note" role="status">
            {lost.line}
            {lost.startOver !== undefined && (
              <>
                {' '}
                <button type="button" className="course__btn" onClick={lost.startOver.run}>
                  {lost.startOver.label}
                </button>
              </>
            )}
          </p>
        )}
        {loadingVoice && !(missing.has(chapter.id) || late.has(chapter.id)) && (
          <p className="course__note" role="status">
            {VOICE_LOADING_LINE}{' '}
            <button
              type="button"
              className="course__btn course__btn--quiet"
              onClick={() => {
                const wait = voiceWait.current
                if (wait !== null) silentByChoice.current.add(wait.chapter)
                endVoiceWait()
              }}
            >
              {PLAY_WITHOUT_SOUND}
            </button>
          </p>
        )}
        {(missing.has(chapter.id) || late.has(chapter.id)) && voice.retry !== undefined && (
          <p className="course__note" role="status">
            The sound is not here, so this chapter plays with captions.{' '}
            <button
              type="button"
              className="course__btn"
              onClick={() => {
                endLate(chapter.id)
                voice.retry?.(chapter.id)
              }}
            >
              Try again
            </button>
          </p>
        )}
        <CourseScrubber ref={barRef} ctx={ctx} read={readPlayer} dispatch={dispatch} />
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

/**
 * The layer with the downloaded voice (YAZ-5159, 6D1): App loads this one. It tells main that the course is open while
 * it is mounted, so main downloads only then. A `voice` prop still wins (a test, another source).
 */
export function VoicedCardCourse(props: CardCourseProps) {
  const voice = useMemo(() => downloadedVoice(), [])
  useEffect(() => {
    voice.open(true)
    return () => voice.open(false)
  }, [voice])
  return <CardCourse {...props} voice={props.voice ?? voice} />
}
