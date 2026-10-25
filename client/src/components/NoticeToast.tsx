import { useEffect, useState } from 'react'
import type { Notice } from '../lib/notice'
import { NoticeIcon } from './NoticeIcon'

/**
 * The window's one toast (E1, GRO-2171; bottom-left since YAZ-1674). It owns its own clock, so a tick
 * or a hover renders this toast and never App (YAZ-3303 D9):
 * - it goes after `ms` (`noticeMs`: Settings › Notifications › Show for, an Undo at least 6 s); null stays;
 * - the mouse on it holds it, and when the mouse leaves the full time starts again;
 * - a small grey count of the seconds left sits before ✕. CSS draws it from `data-left`, so it is not
 *   in the toast's text, and the live region never reads a number each second;
 * - every toast has ✕ (YAZ-3303 D8): with "Until closed" it is the only way out. CSS draws the ✕ too, so the
 *   toast's text is its message (and its button's label), as before 3303.
 * A new notice (a new object) starts the clock again; the mouse that is on the toast still holds it.
 */
export function NoticeToast({ notice, ms, onClose }: { notice: Notice; ms: number | null; onClose: () => void }) {
  const [held, setHeld] = useState(false)
  const [left, setLeft] = useState(ms === null ? null : Math.ceil(ms / 1000))
  useEffect(() => {
    setLeft(ms === null ? null : Math.ceil(ms / 1000))
    if (ms === null || held) return
    const end = Date.now() + ms
    // Each tick sets the whole seconds left: React bails out while the number is the same.
    const tick = setInterval(() => setLeft(Math.max(1, Math.ceil((end - Date.now()) / 1000))), 250)
    const timer = setTimeout(onClose, ms)
    return () => {
      clearInterval(tick)
      clearTimeout(timer)
    }
  }, [notice, ms, held, onClose])
  return (
    // `data-icon` is a test / observability hook — nothing in the CSS selects it; the glyph is the SVG.
    <div
      className={`link-notice${notice.action === undefined ? '' : ' link-notice--action'}`}
      role="status"
      data-icon={notice.icon}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
    >
      <NoticeIcon icon={notice.icon} />
      <span className="link-notice__text">{notice.text}</span>
      {notice.action !== undefined && (
        <button
          type="button"
          className="link-notice__action"
          onClick={() => {
            notice.action?.run()
            onClose()
          }}
        >
          {notice.action.label}
        </button>
      )}
      {left !== null && (
        <span className="link-notice__clock" aria-hidden="true" data-left={`${left}s`} />
      )}
      <button type="button" className="link-notice__close" aria-label="Dismiss" onClick={onClose} />
    </div>
  )
}
