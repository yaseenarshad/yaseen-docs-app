import { useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small (i) whose sentence shows on hover, keyboard focus or a click (YAZ-4713 C8A, YAZ-4770), in the app's own box
 * under it, as the folder ⚙'s (YAZ-3746 13BP): a native title shows nothing in the app. The box is in a portal on the
 * page, so a row that clips its text (a Columns part's title) can not cut it.
 */
export function InfoTip({ text }: { text: string }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setAt({ left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 248)), top: r.bottom + 6 })
  }
  return (
    <span className="info-tip">
      <button type="button" className="info-tip__button" aria-label="About this" aria-expanded={at !== null}
        onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setAt(null)} onFocus={(e) => show(e.currentTarget)} onBlur={() => setAt(null)} onClick={(e) => show(e.currentTarget)}>
        <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden>
          <circle cx="8" cy="8" r="6.3" /><path d="M8 7.4v3.4M8 5v.2" />
        </svg>
      </button>
      {at !== null && createPortal(<span className="info-tip__box" role="tooltip" style={{ left: at.left, top: at.top }}>{text}</span>, document.body)}
    </span>
  )
}
