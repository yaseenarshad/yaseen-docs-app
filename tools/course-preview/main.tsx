/**
 * THE COURSE SCENES PREVIEW (YAZ-5121): mounts any clip's scene with the same seam the course layer gives it (clock,
 * marks, `done`, `host`, reduced motion), so a person can look at the scenes without the app. See `build.mjs`.
 *
 * - Pick the chapter and the clip; Play, a scrubber for the clip's progress, a button for each mark.
 * - Light and dark (the app's `data-theme`), reduced motion, three stage sizes, auto-advance through the chapter
 *   (a span keeps its scene mounted across its clips, as in the layer).
 * - A clip that waits shows how many times its scene called `done()`; it holds at its end until then.
 * - The host: "makes files" (the course's test double `memoryHost`: `makeFirstCard` answers a made-up path) or "only shows".
 * - The address keeps the place: `#c2-07@0.5`.
 */
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { COURSE, type CourseClip } from '../../client/src/course/script'
import { WAITING_CLIPS } from '../../client/src/course/waits'
import { clipSeconds } from '../../client/src/course/courseTime'
import { showOnlyHost, type CourseHost, type MadeCard } from '../../client/src/course/courseHost'
import { SHOW_ONLY } from '../../client/src/course/courseCards'
import { memoryHost as courseMemoryHost } from '../../client/src/course/scenes/testing'
import type { SceneClock, SceneTime } from '../../client/src/course/scene'
import { courseScenes } from '../../client/src/course/scenes'
import '../../client/src/app.css'
import '../../client/src/course/course.css'
import './preview.css'

type Voice = Record<string, { seconds: number }>

const clips = COURSE.flatMap((ch) => ch.clips.map((clip) => ({ chapter: ch, clip })))

/** A clock the preview drives: the same shape as the layer's. */
function createClock() {
  let time: SceneTime = { t: 0, length: 1, fraction: 0, playing: false }
  const frames = new Set<() => void>()
  const marks = new Set<(i: number) => void>()
  const clock: SceneClock = {
    now: () => time,
    subscribe: (fn) => {
      frames.add(fn)
      return () => frames.delete(fn)
    },
    onMark: (fn) => {
      marks.add(fn)
      return () => marks.delete(fn)
    },
  }
  return {
    clock,
    set(next: SceneTime, fired: number[]) {
      time = next
      fired.forEach((i) => marks.forEach((fn) => fn(i)))
      frames.forEach((fn) => fn())
    },
  }
}

/** A host that makes the card (a made-up path), as the real one does (YAZ-5124), a moment later. */
function memoryHost(made: (card: MadeCard) => void): CourseHost {
  const host = courseMemoryHost('/Demo vault')
  return {
    ...host,
    makeFirstCard: (input) =>
      host.makeFirstCard(input).then((card) => {
        if ('path' in card) made(card)
        return new Promise((done) => setTimeout(() => done(card), 300))
      }),
  }
}

function readHash(): { clip: string; at: number } {
  const m = /^#([a-z0-9-]+)(?:@([0-9.]+))?$/.exec(location.hash)
  return { clip: m?.[1] ?? clips[0].clip.id, at: m?.[2] === undefined ? 0 : Number(m[2]) }
}

const SIZES = { Wide: [900, 470], Narrow: [440, 300], Tall: [360, 480] } as const

function Preview() {
  const start = readHash()
  const [index, setIndex] = useState(() => Math.max(0, clips.findIndex((c) => c.clip.id === start.clip)))
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const [reduced, setReduced] = useState(false)
  const [size, setSize] = useState<keyof typeof SIZES>('Wide')
  const [auto, setAuto] = useState(true)
  const [makes, setMakes] = useState(true)
  const [voice, setVoice] = useState<Voice>({})
  const [audioOn, setAudioOn] = useState(true)
  const [doneCount, setDoneCount] = useState<Record<string, number>>({})
  const [log, setLog] = useState<string[]>([])
  const { chapter, clip } = clips[index]
  const waits = WAITING_CLIPS.has(clip.id)
  const length = clipSeconds(clip, voice[clip.id]?.seconds ?? null)
  const released = (doneCount[clip.id] ?? 0) > 0

  // The voice's lengths (and its files), when the build copied them.
  useEffect(() => {
    void fetch('./audio.json')
      .then((r) => r.json() as Promise<{ chapters: string[] }>)
      .then(async ({ chapters }) => {
        const all: Voice = {}
        for (const ch of chapters) Object.assign(all, (await (await fetch(`./audio/${ch}/voice.json`)).json()) as Voice)
        setVoice(all)
      })
      .catch(() => undefined)
  }, [])

  const clockRef = useRef(createClock())
  const firedRef = useRef(0)
  useEffect(() => {
    const marks = clip.marks ?? []
    const fraction = Math.min(1, t / length)
    const fired: number[] = []
    let n = firedRef.current
    if (marks.filter((m) => fraction >= m).length < n) n = 0
    while (n < marks.length && fraction >= marks[n]) fired.push(n++)
    firedRef.current = n
    clockRef.current.set({ t: Math.min(t, length), length, fraction, playing }, fired)
  }, [t, length, playing, clip])

  // The sound: the clip's file, kept in step with the clock.
  const audio = useRef<HTMLAudioElement | null>(null)
  const hasAudio = audioOn && voice[clip.id] !== undefined
  useEffect(() => {
    if (!hasAudio) {
      audio.current?.pause()
      return
    }
    const el = audio.current ?? (audio.current = new Audio())
    const src = `./audio/${chapter.id}/${clip.id}.m4a`
    if (!el.src.endsWith(src.slice(1))) el.src = src
    if (playing && t < length) {
      if (Math.abs(el.currentTime - t) > 0.25) el.currentTime = t
      void el.play().catch(() => undefined)
    } else el.pause()
  }, [hasAudio, playing, chapter.id, clip.id, t, length])

  // The frame loop.
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let raf = requestAnimationFrame(function frame(now) {
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      setT((v) => {
        const el = audio.current
        const next = hasAudio && el !== null && !el.paused ? el.currentTime : v + dt
        return next
      })
      raf = requestAnimationFrame(frame)
    })
    return () => cancelAnimationFrame(raf)
  }, [playing, hasAudio])

  // The end of a clip: hold (a clip that waits, not done yet), stop, or go on.
  useEffect(() => {
    if (t < length + 0.45) return
    if (waits && !released) {
      setT(length)
      return
    }
    if (auto && index + 1 < clips.length && clips[index + 1].chapter.id === chapter.id) go(index + 1, true)
    else {
      setT(length)
      setPlaying(false)
    }
  }, [t]) // eslint-disable-line

  const go = useCallback((i: number, keepPlaying = false, at = 0) => {
    setIndex(i)
    firedRef.current = 0
    setT(at)
    if (!keepPlaying) setPlaying(false)
    history.replaceState(null, '', `#${clips[i].clip.id}${at > 0 ? `@${at.toFixed(2)}` : ''}`)
  }, [])
  useEffect(() => {
    if (start.at > 0) setT(start.at * length)
  }, []) // eslint-disable-line

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const host = useMemo(() => (makes ? memoryHost((card) => setLog((l) => [...l, `makeFirstCard: "${card.title}" → ${card.path}\n${card.text}`])) : showOnlyHost('/Demo vault', SHOW_ONLY.readOnly)), [makes])
  const done = useCallback(() => setDoneCount((c) => ({ ...c, [clips[index].clip.id]: (c[clips[index].clip.id] ?? 0) + 1 })), [index])
  const Scene = courseScenes(clip.id)
  const key = courseScenes.spanOf(clip.id) ?? clip.id
  const [w, h] = SIZES[size]
  const chapterClips = clips.filter((c) => c.chapter.id === chapter.id)

  return (
    <div className="pv">
      <header className="pv__bar">
        <select value={chapter.id} onChange={(e) => go(clips.findIndex((c) => c.chapter.id === e.target.value))}>
          {COURSE.map((ch, i) => (
            <option key={ch.id} value={ch.id}>
              {i + 1}. {ch.title}
            </option>
          ))}
        </select>
        <select value={clip.id} onChange={(e) => go(clips.findIndex((c) => c.clip.id === e.target.value))}>
          {chapterClips.map(({ clip: c }) => (
            <option key={c.id} value={c.id}>
              {c.id}
              {WAITING_CLIPS.has(c.id) ? ' (waits)' : ''} · {c.text.slice(0, 50)}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => index > 0 && go(index - 1)}>
          ◀ Clip
        </button>
        <button type="button" className="pv__play" onClick={() => (t >= length && (!waits || released) ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => index + 1 < clips.length && go(index + 1)}>
          Clip ▶
        </button>
        <label>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-advance
        </label>
        <span className="pv__sep" />
        <button type="button" onClick={() => setTheme((v) => (v === 'light' ? 'dark' : 'light'))}>
          {theme === 'light' ? 'Dark' : 'Light'}
        </button>
        <label>
          <input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> Reduced motion
        </label>
        <select value={size} onChange={(e) => setSize(e.target.value as keyof typeof SIZES)}>
          {Object.keys(SIZES).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={makes} onChange={(e) => setMakes(e.target.checked)} /> Host makes files
        </label>
        {Object.keys(voice).length > 0 && (
          <label>
            <input type="checkbox" checked={audioOn} onChange={(e) => setAudioOn(e.target.checked)} /> Voice
          </label>
        )}
      </header>
      <div className="pv__scrub">
        <input type="range" min={0} max={1000} value={Math.round((Math.min(t, length) / length) * 1000)} onChange={(e) => setT((Number(e.target.value) / 1000) * length)} aria-label="Progress in the clip" />
        <span className="pv__time">
          {Math.min(t, length).toFixed(2)} / {length.toFixed(2)} s · {(Math.min(1, t / length) * 100).toFixed(0)}%
        </span>
        {(clip.marks ?? []).map((m, i) => (
          <button key={i} type="button" onClick={() => setT(m * length)}>
            Mark {i + 1} ({m.toFixed(3)})
          </button>
        ))}
      </div>
      <p className="pv__status">
        {chapter.id} / {clip.id}
        {waits && ` · waits: done() called ${doneCount[clip.id] ?? 0} time(s)${released ? '' : ', holding'}`}
        {courseScenes.spanOf(clip.id) !== undefined && ` · span ${courseScenes.spanOf(clip.id)}`}
      </p>
      <div className="pv__frame" style={{ width: w }}>
        <div className="course__stage pv__stage" style={{ height: h }}>
          <Scene key={key} chapter={chapter} clip={clip as CourseClip} waits={waits} clock={clockRef.current.clock} done={done} reducedMotion={reduced} host={host} />
        </div>
        <p className="course__caption">{clip.text}</p>
      </div>
      {log.length > 0 && <pre className="pv__log">{log.join('\n\n')}</pre>}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
)
