/**
 * The "Connect your phone" dialog (YAZ-5098): this vault's code, for the phone's "Add a vault › Scan a code".
 *
 * THE CODE HOLDS THE TOKEN, so (the brief's "Safety"):
 * - it shows only after a click on "Show code", in this dialog, and the dialog says in one line who can use it;
 * - it hides after `seconds`, when the window loses the focus or the page is hidden, and when the dialog closes;
 * - it is pixels on a canvas, never text: main answers the QR grid (`phone:code`), never the token or the code's text,
 *   and the grid is painted and dropped, not kept in state. Hiding wipes the canvas and takes it out of the page.
 *
 * Made like the app's sheets (`ConfirmSheet`'s classes and keys): Esc closes it and stops there, so Settings stays.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PhoneCodeProblem } from '@shared/types'
import { paintQr, QR_QUIET } from '@shared/qrPaint'
import { api } from '../api'

/** Pixels a square on the canvas; the page shows it smaller and sharp (`image-rendering: pixelated`). */
const SCALE = 8

type View =
  | { kind: 'loading' }
  | { kind: 'shown'; repo: string; branch: string }
  | { kind: 'hidden' }
  | { kind: 'problem'; problem: PhoneCodeProblem }
  | { kind: 'failed' }

/** Plain words for each vault that has no code. None holds a value from the token or the remote. */
const PROBLEM_WORDS: Record<PhoneCodeProblem, string> = {
  'no-token': 'Save a GitHub token in Phone and friends first.',
  'no-git': 'Git is not on this Mac, so the app cannot find the repo of this vault.',
  'not-a-repo': 'This vault is not a git repo. The phone gets the vault from a GitHub repo, so the vault must be the top folder of one.',
  'no-remote': 'This vault has no GitHub remote. The phone gets the vault from GitHub, so the vault needs a remote origin on github.com.',
  'not-github': 'The remote of this vault is not on GitHub. The phone app works only with a repo on github.com.',
  'no-branch': 'This vault is not on a branch now. Change to a branch, then try again.',
}

export default function ConnectPhoneSheet({ root, seconds, onClose }: { root: string; seconds: number; onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** The grid between main's answer and the paint: one render long, then dropped. */
  const toPaint = useRef<boolean[][] | null>(null)
  /** Each ask and each hide moves it on, so an answer that comes after a hide or a close is never painted. */
  const attempt = useRef(0)
  const doneRef = useRef<HTMLButtonElement>(null)
  /** The canvas that holds a code now. Its own ref: React lets go of `canvasRef` before a close's cleanup runs. */
  const painted = useRef<HTMLCanvasElement | null>(null)

  const wipe = useCallback(() => {
    toPaint.current = null
    const canvas = painted.current
    painted.current = null
    if (canvas === null) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    canvas.width = 0
    canvas.height = 0
  }, [])

  const hide = useCallback(() => {
    attempt.current++
    wipe()
    setView((v) => (v.kind === 'shown' || v.kind === 'loading' ? { kind: 'hidden' } : v))
  }, [wipe])

  const show = useCallback(async () => {
    const id = ++attempt.current
    setView({ kind: 'loading' })
    let answer
    try {
      answer = await api.phone.code(root)
    } catch {
      if (id === attempt.current) setView({ kind: 'failed' })
      return
    }
    if (id !== attempt.current) return
    if (!answer.ok) {
      setView({ kind: 'problem', problem: answer.problem })
      return
    }
    toPaint.current = answer.grid
    setView({ kind: 'shown', repo: answer.repo, branch: answer.branch })
  }, [root])

  // The click on "Show code" that opened the dialog is the action: ask at once.
  useEffect(() => {
    void show()
    doneRef.current?.focus()
    return () => {
      attempt.current++
      wipe()
    }
  }, [show, wipe])

  // Paint as the canvas comes into the page, then let the grid go.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const grid = toPaint.current
    if (view.kind !== 'shown' || canvas === null || grid === null) return
    toPaint.current = null
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    canvas.width = canvas.height = (grid.length + 2 * QR_QUIET) * SCALE
    paintQr(ctx, grid, SCALE)
    painted.current = canvas
  }, [view])

  // Hide after `seconds`, and at once when the window loses the focus or the page is hidden.
  useEffect(() => {
    if (view.kind !== 'shown') return
    const timer = window.setTimeout(hide, seconds * 1000)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hide()
    }
    window.addEventListener('blur', hide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('blur', hide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [view.kind, seconds, hide])

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  return (
    <div className="confirm-overlay" onMouseDown={(e) => (e.stopPropagation(), onClose())} onKeyDown={onKey}>
      <div className="confirm phone-code" role="dialog" aria-modal="true" aria-labelledby="connect-phone-title" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text">
          <span className="confirm__title" id="connect-phone-title">
            Connect your phone
          </span>
          {view.kind === 'shown' && 'In the phone app, tap Add a vault › Scan a code. Then point the camera at this code.'}
        </p>
        {view.kind === 'shown' && (
          <>
            <canvas ref={canvasRef} className="phone-code__canvas" role="img" aria-label={`Code for ${view.repo}`} />
            <p className="phone-code__repo">
              {view.repo} · {view.branch}
            </p>
            <p className="confirm__status phone-code__warning" role="note">
              Anyone who can see this code can change your vault. It hides after {seconds} seconds.
            </p>
          </>
        )}
        {view.kind === 'loading' && <p className="confirm__status">…</p>}
        {view.kind === 'hidden' && <p className="confirm__status">The code is hidden.</p>}
        {view.kind === 'problem' && (
          <p className="confirm__status confirm__status--error" role="alert">
            {PROBLEM_WORDS[view.problem]}
          </p>
        )}
        {view.kind === 'failed' && (
          <p className="confirm__status confirm__status--error" role="alert">
            The code could not be made. Try again.
          </p>
        )}
        <div className="confirm__actions">
          {(view.kind === 'hidden' || view.kind === 'failed') && (
            <button type="button" className="confirm__btn" onClick={() => void show()}>
              Show code
            </button>
          )}
          <button ref={doneRef} type="button" className="confirm__btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
