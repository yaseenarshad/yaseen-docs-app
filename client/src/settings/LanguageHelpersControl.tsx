import { useEffect, useRef, useState } from 'react'
import { installErrorText, type LspInstallProgress, type LspInstallResult } from '@shared/lspInstall'
import { api } from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Segmented } from './controls'
import { ON_OFF_OPTIONS } from './options'

/**
 * SETTINGS › CODE › "JUMP ACROSS FILES (Cmd+click, Shift+F12)" (YAZ-3500; YAZ-3439 "Download the helpers on
 * first switch-on, after a box that explains"). Off by default. The app ships no helper:
 *  - On, with the helpers there (downloaded before, or a dev build's `node_modules`): the switch goes on. No box.
 *  - On, without them: the box below, in the approved words. Cancel: the switch stays off, nothing downloads.
 *    "Download and turn on": main downloads and checks them (`lsp.install`); the box shows each step, then
 *    closes and the switch goes on. A failure: one sentence in the box, the switch stays off, and the
 *    button tries again. Cancel during the download stops it, and main deletes what it wrote.
 *  - Off: the switch goes off; main stops every helper.
 * The renderer only asks; main picks the URL, the version and the folder.
 */

export const HELPERS_BOX_TITLE = 'Turn on jump across files?'
export const HELPERS_BOX_TEXT =
  "Cmd+click a name to open the file where it's made. Shift+F12 lists every place that uses it. This works for TypeScript, JavaScript, React and Python. It needs two helper tools (about 15 MB). They run only while a code file is open."
export const HELPERS_BOX_CONFIRM = 'Download and turn on'

const HELPER_NAMES = { typescript: 'TypeScript', python: 'Python' } as const

/** The box's line during the download. */
export function progressText(p: LspInstallProgress): string {
  const which = p.count > 1 ? ` (${p.index} of ${p.count})` : ''
  const name = HELPER_NAMES[p.helper]
  if (p.phase === 'unpack') return `Unpacking the ${name} helper${which}…`
  const amount = p.total !== null && p.total > 0 ? `${Math.min(100, Math.floor((p.received * 100) / p.total))}%` : `${(p.received / (1024 * 1024)).toFixed(1)} MB`
  return `Downloading the ${name} helper${which}… ${amount}`
}

interface Box {
  busy: boolean
  /** Progress while busy; the reason after a failure; null before the first click. */
  line: string | null
}

export function LanguageHelpersControl({ on, onSet }: { on: boolean; onSet: (on: boolean) => void }) {
  const [box, setBox] = useState<Box | null>(null)
  // The latest door: a download ends long after the click, and the settings may have moved on.
  const setRef = useRef(onSet)
  setRef.current = onSet
  /** Raised by each download and each Cancel: an answer for an older one changes nothing. */
  const attempt = useRef(0)
  useEffect(
    () => () => {
      attempt.current++
    },
    [],
  )

  const turnOn = async (): Promise<void> => {
    let ready = false
    try {
      ready = (await api.lsp.helpers()).ready
    } catch {
      // No answer: the box asks, and a download that cannot start says why.
    }
    if (ready) setRef.current(true)
    else setBox({ busy: false, line: null })
  }

  const download = async (): Promise<void> => {
    const mine = ++attempt.current
    setBox({ busy: true, line: 'Starting the download…' })
    let off = (): void => undefined
    try {
      off = api.lsp.onInstallProgress((p) => {
        if (attempt.current === mine) setBox({ busy: true, line: progressText(p) })
      })
    } catch {
      // No progress line; the answer still comes.
    }
    try {
      let result: LspInstallResult
      try {
        result = await api.lsp.install()
      } catch {
        result = { ok: false, error: 'disk' }
      }
      if (attempt.current !== mine) return
      if (result.ok) {
        setBox(null)
        setRef.current(true)
      } else {
        setBox({ busy: false, line: installErrorText(result) })
      }
    } finally {
      off()
    }
  }

  const cancel = (): void => {
    if (box?.busy) void api.lsp.cancelInstall().catch(() => undefined)
    attempt.current++
    setBox(null)
  }

  return (
    <>
      <Segmented
        options={ON_OFF_OPTIONS}
        value={on}
        onChange={(next) => {
          if (next === on || box !== null) return
          if (next) void turnOn()
          else setRef.current(false)
        }}
        ariaLabel="Jump across files"
      />
      {box !== null && (
        <ConfirmSheet
          labelId="confirm-language-helpers-text"
          text={
            <>
              <span className="confirm__title">{HELPERS_BOX_TITLE}</span>
              {HELPERS_BOX_TEXT}
            </>
          }
          confirmLabel={HELPERS_BOX_CONFIRM}
          confirmDisabled={box.busy}
          keys="contained"
          onConfirm={() => void download()}
          onCancel={cancel}
        >
          {box.line !== null && (
            <p className={box.busy ? 'confirm__status' : 'confirm__status confirm__status--error'} role={box.busy ? 'status' : 'alert'}>
              {box.line}
            </p>
          )}
        </ConfirmSheet>
      )}
    </>
  )
}
