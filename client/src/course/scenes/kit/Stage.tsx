/**
 * THE STAGE (YAZ-5121): the frame of every scene, and the hook that gives a scene its beat.
 *
 * - `useBeat(props)`: the clip's beat (`beat.ts`), drawn again on each frame of the layer's clock. Every piece takes it.
 * - `<Stage beat>`: fills the layer's stage (`.course__stage`); a size container, so type and pieces scale with the
 *   window (`cqmin`); a safe inset on every side; `data-paused` stops any CSS motion (the caret) while paused.
 * - `<Layer>`: one centred layer on the stage (they stack); `<Words>`: the stage's type scale (`display`, `title`,
 *   `label`, `kicker`, `page`).
 * Light and dark come from the app's tokens (`--bg`, `--fg`, `--accent` …); nothing here sets a colour of its own.
 *
 * THE SMALLEST READABLE SIZE (YAZ-5128): no text on the stage is under `MIN_TEXT_PX` (11 px) as the person sees it.
 * CSS sizes take `var(--kit-min-text)` as their floor; `Fit` never scales its content's body text below it; and the
 * stage gives each drawing (`svg`) its scale (`--svg-scale`), so a drawing's labels grow back to it when the drawing
 * is drawn small. A scene that does not fit then shows less at once, pans (`Fit`'s `focus`) or steps; it never shrinks
 * the type.
 */
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
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

/** The kit's one smallest readable size, in CSS px as the person sees it (`--kit-min-text` in `kit.css`). */
export const MIN_TEXT_PX = 11

/** Gives each drawing on the stage its scale on screen, as `--svg-scale` (rendered width / its view's width). */
function useSvgScale(root: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const el = root.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const seen = new Set<SVGSVGElement>()
    const rescale = (svg: SVGSVGElement): void => {
      const view = svg.viewBox.baseVal
      const width = svg.getBoundingClientRect().width
      if (view === null || view.width === 0 || width === 0) return
      const scale = Math.min(width / view.width, (svg.getBoundingClientRect().height || width) / (view.height || view.width))
      svg.style.setProperty('--svg-scale', scale.toFixed(3))
    }
    const ro = new ResizeObserver((entries) => entries.forEach((e) => rescale(e.target as SVGSVGElement)))
    const scan = (): void => {
      for (const svg of el.querySelectorAll<SVGSVGElement>('svg[viewBox]')) {
        if (seen.has(svg)) continue
        seen.add(svg)
        ro.observe(svg)
        rescale(svg)
      }
    }
    const mo = new MutationObserver(scan)
    mo.observe(el, { childList: true, subtree: true })
    scan()
    return () => {
      mo.disconnect()
      ro.disconnect()
    }
  }, [root])
}

export function Stage({ beat, children, className, label }: { beat: Beat; children: ReactNode; className?: string; label?: string }) {
  const root = useRef<HTMLDivElement>(null)
  useSvgScale(root)
  return (
    <div
      ref={root}
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

type WordsSize = 'display' | 'title' | 'label' | 'kicker' | 'page'

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
 *
 * The floor (YAZ-5128): the content never scales below the size where its body text (the font size most of its text
 * has) is `MIN_TEXT_PX`; `min` raises the floor. When the content does not fit at the floor, it pans: `focus` 0 shows
 * its top, 1 its bottom (a scene follows the part it lights, `litFocus`); across, it keeps its middle in view.
 */
export function Fit({ children, max = 1, min = 0, focus = 0.5 }: { children: ReactNode; max?: number; min?: number; focus?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 1, over: 0 })
  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (o === null || i === null || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const w = i.offsetWidth
      const h = i.offsetHeight
      if (w === 0 || h === 0) return
      const floor = Math.min(max, Math.max(min, MIN_TEXT_PX / bodyTextPx(i)))
      const next = Math.max(floor, Math.min(max, o.clientWidth / w, o.clientHeight / h))
      const over = Math.max(0, h * next - o.clientHeight)
      setFit((f) => (Math.abs(f.scale - next) < 0.005 && Math.abs(f.over - over) < 1 ? f : { scale: next, over }))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(o)
    ro.observe(i)
    measure()
    return () => ro.disconnect()
  }, [max, min])
  const pan = fit.over > 0 ? (0.5 - Math.min(1, Math.max(0, focus))) * fit.over : 0
  const transform = `${pan === 0 ? '' : `translateY(${pan.toFixed(1)}px) `}${fit.scale === 1 ? '' : `scale(${fit.scale.toFixed(4)})`}`.trim()
  return (
    <div ref={outer} className="kit-fit">
      <div ref={inner} className="kit-fit__inner" style={transform === '' ? undefined : { transform }}>
        {children}
      </div>
    </div>
  )
}

/** The font size (px, before any scale) that most of the text in `el` has: its body text. */
function bodyTextPx(el: HTMLElement): number {
  const weight = new Map<number, number>()
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const length = n.textContent?.trim().length ?? 0
    const parent = n.parentElement
    if (length === 0 || parent === null) continue
    const px = parseFloat(getComputedStyle(parent).fontSize)
    if (px > 0) weight.set(px, (weight.get(px) ?? 0) + length)
  }
  let best = MIN_TEXT_PX
  let most = 0
  for (const [px, n] of weight) if (n > most) [best, most] = [px, n]
  return best
}

/**
 * Where a `Fit` that pans should look: the lit parts of a card, as a place from 0 (the first part) to 1 (the last of
 * `count`), weighted by how lit each one is; `rest` when none is lit. With reduced motion it jumps to the most lit part
 * (no glide).
 */
export function litFocus(b: Beat, lit: readonly (number | undefined)[], count: number, rest = 0): number {
  let sum = 0
  let at = 0
  let best = -1
  let bestLit = 0
  lit.forEach((l, i) => {
    const v = Math.min(1, Math.max(0, l ?? 0))
    sum += v
    at += v * (count <= 1 ? 0 : i / (count - 1))
    if (v > bestLit) {
      bestLit = v
      best = i
    }
  })
  if (sum <= 0) return rest
  if (b.reduced) return count <= 1 ? 0 : best / (count - 1)
  return at / sum
}
