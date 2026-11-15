import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '../app/AppState'
import type { ShellSyncEvent } from '../app/syncPort'
import { tokenEndWarning } from '../auth/expiry'
import { lazyScreen } from '../screens/LazyScreen'
import { Toast, useToast } from '../screens/Toast'
import { answersPart, syncDot, type Dot } from './dot'
import { useLastSync } from './lastSync'
import { useStuck } from './storeCheck'
import { useDotAnswers } from './useDotAnswers'
import { useOnline } from './useOnline'
import './status.css'

/** YAZ-5451: the sheet is a chunk of its own (the first load stays under its ceiling); it loads after the first paint. */
const loadSheet = () => import('./StatusSheet')
const StatusSheet = lazyScreen(loadSheet, { waiting: false })
/** YAZ-5469: the toast's words are a chunk of their own too. */
const loadWords = () => import('./passWords')

/**
 * The sync status in the top bar (decision 12; YAZ-5080; YAZ-5451). One button; VoiceOver reads its state in its name
 * ("Sync status: Synced. Sync now").
 *  - Green, blue and grey: the DOT ONLY. A tap syncs now (`syncNow`); the dot is blue while it runs. The app still
 *    checks GitHub every 15 s on its own. YAZ-5469: after the tap's pass, a quiet toast under the bar says how it went
 *    ("Synced · 3 pages updated", "Synced · up to date", "No signal · will sync later"); the 15 s passes say nothing.
 *  - Amber and red, and "Can't sync now": the dot AND its few words (what is wrong, never cut). A tap opens the sheet:
 *    why, the time of the last sync, and the way forward (Sign in again, Try now, Discard, Replace token).
 */
export function SyncStatus() {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const [toast, say] = useToast()
  useEffect(() => void loadSheet().catch(() => {}), [])
  const online = useOnline()
  const answers = useDotAnswers(app.services.sync, app.vaultKey)
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    button.current?.focus()
  }, [])
  const now = (app.services.now ?? Date.now)()
  const token = tokenEndWarning(app.vaultKey === null ? null : (app.accounts[app.vaultKey]?.expiresAt ?? null), now)
  const stuck = useStuck(app.services.store, app.vaultKey, answers.state !== null || answers.noList)
  const said = syncDot({ sync: app.sync, answers: answersPart(answers.state, answers.waiting, answers.noList, stuck), online, token })
  const loud = dotIsLoud(said)
  const dot: Dot = busy && !loud ? { ...said, state: 'syncing', words: 'Syncing…', short: 'Syncing…', bar: 'Syncing…', count: null, reason: 'syncing' } : said
  const lastAt = useLastSync(app.services.store, app.vaultKey, app.sync.lastSyncedAt, answers.state?.lastSentAt)
  const tap = () => {
    if (loud) return setOpen(true)
    setBusy(true)
    const sync = app.services.sync
    // The events of this pass: the `changed` ones say how many files came in.
    const seen: ShellSyncEvent[] = []
    const stop = sync.subscribe((e) => void seen.push(e))
    void sync
      .syncNow()
      .catch(() => {})
      .then(() => (stop(), setBusy(false), loadWords()))
      .then((m) => say(m.passWords(sync.state(), seen, navigator.onLine)))
      .catch(() => {})
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        className={loud ? 'sync-status' : 'sync-status sync-status--dot'}
        aria-label={`Sync status: ${dot.words}${loud || dot.state === 'syncing' ? '' : '. Sync now'}`}
        aria-haspopup={loud ? 'dialog' : undefined}
        aria-expanded={loud ? open : undefined}
        onClick={tap}
      >
        <span className={`sync-dot sync-dot--${dot.state}`} aria-hidden="true" />
        {loud && <DotWords dot={dot} />}
      </button>
      {toast !== null && <Toast text={toast} top />}
      {open && (
        <StatusSheet
          dot={dot}
          token={token}
          answers={answers}
          now={now}
          lastAt={lastAt}
          onClose={close}
          onBack={close}
        />
      )}
    </>
  )
}

/** YAZ-5451: the states whose words stay in the top bar: the person must know (amber, red) or act ("Can't sync now"). */
export const dotIsLoud = (dot: Dot): boolean => dot.state === 'pending' || dot.state === 'attention' || dot.reason === 'no-list'

/**
 * The words next to the dot: one span, or the bar's words and the short form when they differ (YAZ-5216: CSS picks by
 * width). YAZ-5521: and the count alone, which a top bar with a page's ID chip shows in their place.
 */
export function DotWords({ dot }: { dot: Dot }) {
  const count =
    dot.count === null ? null : (
      <span className="sync-status__words sync-status__words--count" aria-hidden="true">
        {dot.count}
      </span>
    )
  if (dot.short === dot.bar)
    return (
      <>
        <span className="sync-status__words" aria-hidden="true">
          {dot.bar}
        </span>
        {count}
      </>
    )
  return (
    <>
      <span className="sync-status__words sync-status__words--full" aria-hidden="true">
        {dot.bar}
      </span>
      <span className="sync-status__words sync-status__words--short" aria-hidden="true">
        {dot.short}
      </span>
      {count}
    </>
  )
}
