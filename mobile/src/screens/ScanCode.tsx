import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/AppState'
import { FORWARD_LABEL, SAVE_FAILED, signInHelp, type Help } from '../app/help'
import { parseScanCode, scanCodeMessage, type ScanCode as Code } from '../auth/scanCode'
import { ScanError, scanProblemMessage, type ScanSession } from '../scan/scanner'
import { vaultId } from '../store'
import { Frame, Problem } from './Frame'

/**
 * "Scan a code" (round 11, item 23): the camera reads the code that the Mac shows (YAZ-5098 "Connect your phone"). The
 * code holds the repo, the branch and the token; they go through the same check as typed ones (3E's `signIn`). The
 * token from the code is never shown. The reader loads only when this screen opens (`scan/camera.ts`).
 *
 * `vault` set: the code must be for that vault, and only its token is used (row N6, "Sign in again").
 */
export function ScanCode({ vault }: { vault?: string }) {
  const app = useApp()
  const video = useRef<HTMLVideoElement>(null)
  const session = useRef<ScanSession | null>(null)
  const code = useRef<Code | null>(null)
  const busy = useRef(false)
  const [round, setRound] = useState(0)
  const [state, setState] = useState<'starting' | 'scanning' | 'checking' | 'stopped'>('starting')
  const [hint, setHint] = useState<string | null>(null)
  const [help, setHelp] = useState<Help | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const stopCamera = () => {
    session.current?.stop()
    session.current = null
  }

  const check = async (found: Code) => {
    busy.current = true
    setState('checking')
    setHint(null)
    setHelp(null)
    try {
      const outcome = vault === undefined ? await app.addVault({ repo: found.repo, branch: found.branch, token: found.token, expiresAt: found.expiresAt }) : await app.replaceToken(vault, found.token, found.expiresAt)
      if (!outcome.ok) {
        setHelp(signInHelp(outcome.error))
        setOpenId(outcome.error.kind === 'already-added' ? vaultId(outcome.error) : null)
        setState('stopped')
      }
    } catch {
      setHelp(SAVE_FAILED)
      setState('stopped')
    } finally {
      busy.current = false
    }
  }

  useEffect(() => {
    if (video.current === null) return
    let live = true
    setState('starting')
    app.services.scanner
      .start(video.current, (text) => {
        if (!live || busy.current) return
        const parsed = parseScanCode(text)
        if (!parsed.ok) return setHint(scanCodeMessage(parsed.error))
        if (vault !== undefined && vaultId(parsed.code) !== vault) {
          const want = app.list.vaults.find((v) => vaultId(v) === vault)?.repo ?? vault
          return setHint(`This code is for ${parsed.code.repo}. Show the code for ${want} on your Mac.`)
        }
        code.current = parsed.code
        stopCamera()
        void check(parsed.code)
      })
      .then(
        (started) => {
          if (live) {
            session.current = started
            setState((s) => (s === 'starting' ? 'scanning' : s))
          } else started.stop()
        },
        (error: unknown) => {
          if (!live) return
          setHint(null)
          setHelp({ message: scanProblemMessage(error instanceof ScanError ? error.problem : 'no-camera'), forward: 'edit-repo' })
          setState('stopped')
        },
      )
    return () => {
      live = false
      stopCamera()
    }
    // Only a new round restarts the camera ("Scan again"); the other values are read when a code arrives.
  }, [round])

  const forward = () => {
    switch (help?.forward) {
      case 'token-guide':
      case 'repo-guide':
        app.go({ type: 'open', route: { kind: 'guide' } })
        break
      case 'open-vault':
        if (openId !== null) void app.switchVault(openId)
        break
      case 'retry':
        if (code.current !== null) void check(code.current)
        else setRound((r) => r + 1)
        break
      case 'edit-repo':
        // The camera cannot help: the typed form is the way forward.
        app.go({ type: 'back' })
        break
    }
  }

  return (
    <Frame title="Scan a code" back={() => app.go({ type: 'back' })}>
      <p className="lead">On your Mac, open Settings › Review › Connect your phone. Point the camera at the code.</p>
      <div className="camera">
        <video ref={video} aria-label="Camera" playsInline muted />
      </div>
      {state === 'starting' && <p className="muted">Opening the camera…</p>}
      {state === 'checking' && (
        <p className="muted" role="status">
          Code read. Checking the token…
        </p>
      )}
      {hint !== null && <Problem message={hint} quiet />}
      {help !== null && (
        <Problem message={help.message} action={help.forward === 'edit-repo' ? 'Type the repo and token' : FORWARD_LABEL[help.forward]} onAction={forward} />
      )}
      {state === 'stopped' && help !== null && help.forward !== 'edit-repo' && (
        <button
          type="button"
          className="btn btn--wide"
          onClick={() => {
            code.current = null
            setHelp(null)
            setRound((r) => r + 1)
          }}
        >
          Scan again
        </button>
      )}
    </Frame>
  )
}
