/**
 * The full date and time over a row's short date (YAZ-3511 D25), sooner than the system tooltip: `DATE_TIP_MS` after the
 * pointer rests on a `.tree__date`, as a small box above it, right-aligned with it. One listener on the list for every row;
 * the box goes when the pointer leaves the date, on a press, and on a scroll. The text is the date's `data-full`.
 */
import { useEffect, useState, type RefObject } from 'react'

/** The rest before the box shows (the system's is about a second and cannot change). */
export const DATE_TIP_MS = 300

export function RowDateTip({ body }: { body: RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<{ text: string; right: number; top: number } | null>(null)
  useEffect(() => {
    const list = body.current
    if (list === null) return
    let timer: number | undefined
    const hide = () => {
      window.clearTimeout(timer)
      setTip(null)
    }
    const over = (e: MouseEvent) => {
      const date = e.target instanceof Element ? e.target.closest<HTMLElement>('.tree__date[data-full]') : null
      if (date === null) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const r = date.getBoundingClientRect()
        setTip({ text: date.dataset.full ?? '', right: window.innerWidth - r.right, top: r.top })
      }, DATE_TIP_MS)
    }
    const out = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest('.tree__date') !== null) hide()
    }
    list.addEventListener('mouseover', over)
    list.addEventListener('mouseout', out)
    list.addEventListener('mousedown', hide)
    list.addEventListener('scroll', hide, true)
    return () => {
      hide()
      list.removeEventListener('mouseover', over)
      list.removeEventListener('mouseout', out)
      list.removeEventListener('mousedown', hide)
      list.removeEventListener('scroll', hide, true)
    }
  }, [body])
  return tip === null ? null : (
    <div className="tree__date-tip" role="tooltip" style={{ right: tip.right, top: tip.top }}>
      {tip.text}
    </div>
  )
}
