import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * An ask before a step that cannot be undone, in place under its button. The safe choice comes first and takes the
 * focus, so VoiceOver reads the question and a stray tap does nothing. Escape is Cancel (YAZ-5344). A question can
 * be several short parts (one paragraph each). `extra` goes between the question and the buttons (a safer way).
 *
 * YAZ-5360: the ask fits the part of the screen that shows (between the top bar and the tab bar, safe areas included):
 * it is never taller than its scrolling screen. A long question scrolls inside the ask; the buttons stay under it and
 * always show. The ask opens at its top (the loss comes first, YAZ-5344), never with its top hidden.
 */
export function fitAsk(box: HTMLElement): void {
  const screen = box.closest('.screen') ?? box.parentElement
  if (!(screen instanceof HTMLElement)) return
  const cs = getComputedStyle(screen)
  const own = getComputedStyle(box)
  const room = screen.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - (parseFloat(own.marginTop) || 0) - (parseFloat(own.marginBottom) || 0)
  if (room > 0) box.style.setProperty('--confirm-room', `${Math.floor(room)}px`)
  // The ask's top at the top of the screen's view (or as far as the screen scrolls): with the room above, it all shows.
  const top = box.getBoundingClientRect().top - screen.getBoundingClientRect().top - (parseFloat(cs.paddingTop) || 0) - (parseFloat(own.marginTop) || 0)
  if (top < 0 || box.getBoundingClientRect().bottom > screen.getBoundingClientRect().bottom) screen.scrollTop += top
}

export function Confirm({
  question,
  yes,
  onYes,
  onNo,
  busy = false,
  extra,
}: {
  question: string | readonly string[]
  yes: string
  onYes: () => void
  onNo: () => void
  busy?: boolean
  extra?: ReactNode
}) {
  const cancel = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const words = useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = useState(false)
  useLayoutEffect(() => {
    const fit = () => {
      if (!box.current) return
      fitAsk(box.current)
      const w = words.current
      setScrolls(w !== null && w.scrollHeight > w.clientHeight + 1)
    }
    fit()
    if (words.current) words.current.scrollTop = 0
    // `preventScroll`: the focus must not scroll the ask again (to its middle, where Cancel is).
    cancel.current?.focus({ preventScroll: true })
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onNo()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onNo, busy])
  const parts = typeof question === 'string' ? [question] : question
  return (
    <div ref={box} className="problem confirm" role="alertdialog" aria-label={yes} aria-describedby="confirm-question">
      {/* When the question scrolls, it is a stop of its own for the keyboard, and a line under it shows that more is there. */}
      <div ref={words} id="confirm-question" className={scrolls ? 'confirm__question confirm__question--scrolls' : 'confirm__question'} tabIndex={scrolls ? 0 : undefined}>
        {parts.map((part, i) => (
          <p key={i}>{part}</p>
        ))}
      </div>
      {extra && <div className="confirm__extra">{extra}</div>}
      <div className="stack confirm__buttons">
        <button ref={cancel} type="button" className="btn btn--wide" onClick={onNo} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--wide btn--danger" onClick={onYes} disabled={busy} aria-busy={busy}>
          {busy ? 'Working…' : yes}
        </button>
      </div>
    </div>
  )
}
