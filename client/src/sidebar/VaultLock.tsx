/**
 * THE VAULT'S LOCK in the sidebar's header (YAZ-4985), modelled on a page's "Read only" chip (`ReadOnlyChip`). It shows
 * only for a vault that is read only (Settings › This vault › Read only): a small closed lock. The files look as always
 * and the menus are as always; a file change there asks first (App's door). A click opens the chip's kind of box:
 * "Allow file changes for 1 minute" (first, so Enter takes it) · "10 minutes" · Cancel. That is the vault's ONE allowance
 * (`ReadOnlyVaultState.allowFileActions`), the same one the ask box's "1 minute" and "10 minutes" start, so the two always
 * agree. While it runs the lock is amber with the time left ("9:52"), "Lock now" beside it; at zero the vault locks again
 * by itself (the state's own timer) and the lock turns back. The 1-second tick is here alone, only while it runs.
 *
 * The box closes on Cancel, Esc, a press outside it (capture `pointerdown`, as the chip's) and the window's blur. The
 * hover text is the app's own box (`HoverTip`): a native `title` shows nothing in the app.
 *
 * The vault's name keeps priority in the header (YAZ-4964 round 2, item 6). While the allowance runs, the lock holds
 * two forms of its time: the long one ("9:52", with "Lock now" beside it) and a short one ("10m", "58s"). The CSS
 * (`.vault-lock--allowed` in app.css) shows the long form while the header has room; when it does not, the lock
 * shrinks first, to the short form with no "Lock now" beside it, and only then is the name cut. So the box also offers
 * "Lock now" while the allowance runs.
 */
import { useEffect, useReducer, useRef, useState } from 'react'
import { HoverTip } from '../components/HoverTip'
import { LockIcon } from '../views/view/icons'
import type { FileActionsFor } from '../vault/readOnlyVault'

export interface VaultLockProps {
  /** The vault's name: said in the hover text only when the window shows two or more vaults. */
  name?: string
  /** When the allowance ends (ms since the epoch), or null while the vault is locked. */
  until: number | null
  onAllow: (choice: FileActionsFor) => void
  onLock: () => void
}

/** The time left, as the chip's countdown: "9:52". */
export function timeLeft(until: number, now: number): string {
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

/** The time left in a few letters, for a narrow header: whole minutes up ("10m", "1m"), then seconds ("58s"). */
export function shortTimeLeft(until: number, now: number): string {
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return left >= 60 ? `${Math.ceil(left / 60)}m` : `${left}s`
}

export function VaultLock({ name, until, onAllow, onLock }: VaultLockProps) {
  const [asking, setAsking] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const allowed = until !== null
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (until === null) return
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [until])
  useEffect(() => {
    if (!asking) return
    const onOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setAsking(false)
    }
    const onBlur = () => setAsking(false)
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onOutside, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [asking])
  const whose = name === undefined ? 'This vault' : name
  const tip = allowed ? `File changes are allowed in ${name ?? 'this vault'} for now. Click for another time.` : `${whose} is read only. Click to allow file changes.`
  const allow = (choice: FileActionsFor) => {
    setAsking(false)
    onAllow(choice)
  }
  return (
    <div
      ref={rootRef}
      className={`read-only-chip vault-lock${allowed ? ' vault-lock--allowed' : ''}`}
      onKeyDown={(event) => {
        if (!asking || event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        setAsking(false)
        buttonRef.current?.focus()
      }}
    >
      <HoverTip text={tip}>
        <button
          ref={buttonRef}
          type="button"
          className={`read-only-chip__button vault-lock__button${allowed ? ' read-only-chip__button--editing' : ''}`}
          aria-label={allowed ? `File changes allowed, ${timeLeft(until, Date.now())} left` : `${whose} is read only`}
          aria-haspopup="dialog"
          aria-expanded={asking}
          // The header's own mousedown (the switcher's surface) must not take this press.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setAsking((open) => !open)}
        >
          <LockIcon size={12} />
          {allowed && (
            <>
              <span className="vault-lock__time vault-lock__time--long">{timeLeft(until, Date.now())}</span>
              <span className="vault-lock__time vault-lock__time--short" aria-hidden="true">{shortTimeLeft(until, Date.now())}</span>
            </>
          )}
        </button>
      </HoverTip>
      {allowed && (
        <button type="button" className="read-only-chip__lock" onMouseDown={(e) => e.stopPropagation()} onClick={onLock}>
          Lock now
        </button>
      )}
      {asking && (
        <div className="read-only-chip__ask vault-lock__ask" role="dialog" aria-label="Allow file changes">
          <p>Allow file changes?</p>
          <div className="read-only-chip__times">
            <button type="button" className="read-only-chip__allow" autoFocus onClick={() => allow('minute')}>Allow file changes for 1 minute</button>
            <button type="button" onClick={() => allow('ten')}>10 minutes</button>
          </div>
          <div className="read-only-chip__actions">
            {allowed && (
              // The narrow header hides the "Lock now" beside the lock: here it is always at hand.
              <button
                type="button"
                onClick={() => {
                  setAsking(false)
                  onLock()
                }}
              >
                Lock now
              </button>
            )}
            <button type="button" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
