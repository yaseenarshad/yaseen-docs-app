import { useEffect, useMemo, type RefObject } from 'react'
import { ENOUGH_ROWS, headingRows, landOn } from '../headings'

/**
 * THE PAGE'S HEADINGS: the Mac's table of contents as a list (`headings.ts`: H1 to H5 in page order, each at
 * its level), in a sheet from the bottom. The row of the part on screen is marked (the Mac's scroll spy: the last
 * heading at or above 40 px under the top). A tap closes the sheet and lands on the heading (the Mac's landing, a
 * little under the top, and one flash). A page with fewer than two headings says so (the Mac draws no list then).
 */
const CURRENT_LINE_PX = 40

export default function HeadingsSheet({ host, onClose }: { host: RefObject<HTMLElement | null>; onClose: () => void }) {
  const rows = useMemo(() => (host.current === null ? [] : headingRows(host.current)), [host])
  const current = useMemo(() => {
    const scroller = host.current?.closest('.screen')
    if (scroller == null) return -1
    const top = scroller.getBoundingClientRect().top + CURRENT_LINE_PX
    let at = -1
    rows.forEach((row, i) => {
      if (row.element.getBoundingClientRect().top <= top) at = i
    })
    return at
  }, [rows, host])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  const least = rows.reduce((n, r) => Math.min(n, r.level), 6)
  return (
    <div className="headings-sheet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="headings-sheet__panel" role="dialog" aria-label="Headings">
        <div className="headings-sheet__head">
          <h2 className="headings-sheet__title">Headings</h2>
          <button type="button" className="icon-btn headings-sheet__close" aria-label="Close headings" onClick={onClose}>
            ✕
          </button>
        </div>
        {rows.length < ENOUGH_ROWS ? (
          <p className="muted headings-sheet__none">This page has no headings to list.</p>
        ) : (
          <ul className="headings-sheet__list">
            {rows.map((row, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="headings-sheet__row"
                  aria-current={i === current ? 'location' : undefined}
                  style={{ paddingLeft: `${12 + (row.level - least) * 16}px` }}
                  data-level={row.level}
                  onClick={() => {
                    onClose()
                    landOn(row.element)
                  }}
                >
                  {row.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
