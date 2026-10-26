import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Notice } from '../lib/notice'
import { NoticeIcon } from './NoticeIcon'

/**
 * The window's one toast (E1, GRO-2171; bottom-left since YAZ-1674). It owns its own clock (YAZ-3303 D9):
 * - it goes after `ms` (`noticeMs`: Settings › Notifications › Show for, an Undo at least 6 s); null stays;
 * - the mouse on it holds it, and when the mouse leaves the full time starts again;
 * - a small grey count of the seconds left sits before ✕. CSS counts it down (`.link-notice__clock--running`,
 *   one step a second from `--left`): no JS tick, so nothing renders while it counts. A 250 ms interval that
 *   rendered the count kept the app from quitting while a toast showed (YAZ-3341). The count
 *   is drawn by CSS, so it is not in the toast's text, and the live region never reads a number each second;
 * - every toast has ✕ (YAZ-3303 D8): with "Until closed" it is the only way out. CSS draws the ✕ too, so the
 *   toast's text is its message (and its button's label), as before 3303.
 * A new notice (a new object) starts the clock again; the mouse that is on the toast still holds it.
 * A long message WRAPS to three lines at most, then ends in "…" (YAZ-3343 D36: "we can't read the entire
 * line"); cut, the pointer on it shows it whole (`title`). The count, ✕ and an action stay on its first line.
 */
export function NoticeToast({ notice, ms, onClose }: { notice: Notice; ms: number | null; onClose: () => void }) {
  const [held, setHeld] = useState(false)
  // Each start of the clock gets a new count element, so its CSS countdown starts from the full time.
  const [run, setRun] = useState(0)
  useEffect(() => {
    if (ms === null || held) return
    setRun((n) => n + 1)
    const timer = setTimeout(onClose, ms)
    return () => clearTimeout(timer)
  }, [notice, ms, held, onClose])
  const seconds = ms === null ? null : Math.ceil(ms / 1000)
  // Whether the message is cut at its three lines: then its whole text is the pointer's to read.
  const textRef = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const el = textRef.current
    setCut(el !== null && el.scrollHeight > el.clientHeight + 1)
  }, [notice.text])
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
      <span ref={textRef} className="link-notice__text" title={cut ? notice.text : undefined}>
        {notice.text}
      </span>
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
      {seconds !== null && (
        <span
          key={run}
          className={`link-notice__clock${held ? '' : ' link-notice__clock--running'}`}
          aria-hidden="true"
          data-seconds={seconds}
          // The count's end closes the toast too: the timer of a window out of sight runs late, and the
          // toast would wait there on "0s". Held, the count does not run, so it has no end.
          onAnimationEnd={onClose}
          style={{ '--left': seconds, '--count-steps': seconds, '--count-ms': `${ms}ms` } as CSSProperties}
        />
      )}
      <button type="button" className="link-notice__close" aria-label="Dismiss" onClick={onClose} />
    </div>
  )
}
