/**
 * THE STAGE (YAZ-5121): the frame of every scene, and the hook that gives a scene its beat.
 *
 * - `useBeat(props)`: the clip's beat (`beat.ts`), drawn again on each frame of the layer's clock. Every piece takes it.
 * - `<Stage beat>`: fills the layer's stage (`.course__stage`); a size container, so type and pieces scale with the
 *   window (`cqmin`); a safe inset on every side; `data-paused` stops any CSS motion (the caret) while paused.
 * - `<Layer>`: one centred layer on the stage (they stack); `<Words>`: the stage's type scale (`display`, `title`,
 *   `label`, `kicker`, `note`).
 * Light and dark come from the app's tokens (`--bg`, `--fg`, `--accent` …); nothing here sets a colour of its own.
 */
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { SceneProps } from '../../scene'
import { firedCount, type Beat } from './beat'
import './kit.css'

/** The beat of the scene's clip, from the layer's clock; the scene draws again on each frame, pause, play and seek. */
export function useBeat({ clock, clip, reducedMotion }: Pick<SceneProps, 'clock' | 'clip' | 'reducedMotion'>): Beat {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => clock.subscribe(redraw), [clock])
  const now = clock.now()
  const marks = clip.marks ?? []
  const progress = Number.isFinite(now.fraction) ? Math.min(1, Math.max(0, now.fraction)) : 0
  return { t: now.t, length: now.length, progress, marks, fired: firedCount(marks, progress), reduced: reducedMotion, playing: now.playing }
}

export function Stage({ beat, children, className, label }: { beat: Beat; children: ReactNode; className?: string; label?: string }) {
  return (
    <div
      className={`course-kit kit-stage${className === undefined ? '' : ` ${className}`}`}
      data-reduced={beat.reduced ? 'true' : undefined}
      data-paused={beat.playing ? undefined : 'true'}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
    >
      {children}
    </div>
  )
}

/** One layer of the stage: centred, with the stage's safe inset. `place` puts it on a part of the stage. */
export function Layer({ children, style, place = 'center', className }: { children: ReactNode; style?: CSSProperties; place?: 'center' | 'top' | 'bottom' | 'left' | 'right' | 'fill'; className?: string }) {
  return (
    <div className={`kit-layer kit-layer--${place}${className === undefined ? '' : ` ${className}`}`} style={style}>
      {children}
    </div>
  )
}

export type WordsSize = 'display' | 'title' | 'label' | 'kicker' | 'note'

/** Words on the stage, in the kit's type scale. `tone="accent"` for the one thing to look at. */
export function Words({ size = 'title', tone, children, style, as: Tag = 'p' }: { size?: WordsSize; tone?: 'accent' | 'muted' | 'ok' | 'danger'; children: ReactNode; style?: CSSProperties; as?: 'p' | 'span' | 'div' }) {
  return (
    <Tag className={`kit-words kit-words--${size}${tone === undefined ? '' : ` kit-tone--${tone}`}`} style={style}>
      {children}
    </Tag>
  )
}

/**
 * Fit: its content, scaled down (never up past `max`) to fit the layer it is in, so a long card or a big drawing
 * never runs off the stage at a small window. It measures with `ResizeObserver`; without one (a test), scale 1.
 */
export function Fit({ children, max = 1 }: { children: ReactNode; max?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (o === null || i === null || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const w = i.offsetWidth
      const h = i.offsetHeight
      if (w === 0 || h === 0) return
      const next = Math.min(max, o.clientWidth / w, o.clientHeight / h)
      setScale((s) => (Math.abs(s - next) < 0.005 ? s : next))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(o)
    ro.observe(i)
    measure()
    return () => ro.disconnect()
  }, [max])
  return (
    <div ref={outer} className="kit-fit">
      <div ref={inner} className="kit-fit__inner" style={scale === 1 ? undefined : { transform: `scale(${scale.toFixed(4)})` }}>
        {children}
      </div>
    </div>
  )
}
