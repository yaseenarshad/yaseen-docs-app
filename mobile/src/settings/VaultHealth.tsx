import { useEffect, useState } from 'react'
import { useApp } from '../app/AppState'
import { readWakeLog, type WakeEntry } from '../store/wakeLog'
import { STATE_WORDS, healthLine, readVaultHealth, type HealthRow } from './healthRows'
import './vaultHealth.css'

/**
 * Settings › Vault health (YAZ-5559), its own chunk: one line for the open vault ("Using defaults: table look, icons");
 * a tap shows the list of its settings files, each "In the vault" or "Mac defaults". Read only: it changes nothing.
 */
export default function VaultHealth() {
  const app = useApp()
  const vault = app.vaultKey
  const store = app.services.store
  const [rows, setRows] = useState<HealthRow[] | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (vault === null) return
    let live = true
    void readVaultHealth(store, vault).then((next) => live && setRows(next))
    return () => {
      live = false
    }
  }, [store, vault])
  if (vault === null || rows === null) return null
  return (
    <div className="vault-health">
      <button type="button" className="row row__button vault-health__toggle" aria-expanded={open} aria-controls="vault-health-list" onClick={() => setOpen(!open)}>
        <span className="vault-health__words">
          Vault health <span className="vault-health__line">{healthLine(rows)}</span>
        </span>
        <span className="vault-health__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div id="vault-health-list" className="sheet" role="region" aria-label="Settings files of this vault">
          <p className="muted vault-health__note">Read only. Without its file, a setting uses the Mac's defaults.</p>
          <ul className="rows">
            {rows.map((r) => (
              <li key={r.file} className="row" data-state={r.state}>
                <span className="row__main">
                  {r.label.charAt(0).toUpperCase() + r.label.slice(1)}
                  <span className="vault-health__file">{r.file}</span>
                </span>
                <span className="row__side">{STATE_WORDS[r.state]}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <WakeLog />
    </div>
  )
}

const ms = (n: number | null) => (n === null ? '–' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`)
/** One entry as a line: when, start or return, the first sync, the storage calls, the time limits. */
export function wakeLine(e: WakeEntry): string {
  const when = new Date(e.at)
  const at = `${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
  const sync = e.syncMs === null ? 'sync –' : `sync ${ms(e.syncMs)} (${e.syncEnd})`
  const limits = e.timeouts > 0 ? ` · ${e.timeouts} storage time limit${e.timeouts === 1 ? '' : 's'}` : ''
  return `${at} · ${e.kind} · ${sync} · storage ${ms(e.storageMs)}, slowest ${ms(e.slowestMs)}${limits}`
}

/** YAZ-5596 (15): the wake log (the last 20 starts and returns), newest first, with Copy. */
function WakeLog() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const entries = open ? readWakeLog().reverse() : []
  const copy = () => {
    const text = ['Notecards wake log', ...entries.map(wakeLine)].join('\n')
    try {
      void navigator.clipboard.writeText(text).then(
        () => setCopied('Copied'),
        () => setCopied('Could not copy'),
      )
    } catch {
      setCopied('Could not copy')
    }
  }
  return (
    <>
      <button type="button" className="row row__button vault-health__toggle" aria-expanded={open} aria-controls="wake-log-list" onClick={() => setOpen(!open)}>
        <span className="vault-health__words">
          Wake log <span className="vault-health__line">Each start and return of the app</span>
        </span>
        <span className="vault-health__chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div id="wake-log-list" className="sheet" role="region" aria-label="Wake log">
          {entries.length === 0 ? (
            <p className="muted vault-health__note">Nothing yet.</p>
          ) : (
            <ul className="rows">
              {entries.map((e) => (
                <li key={e.at} className="row vault-health__wake">
                  {wakeLine(e)}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="row row__button" onClick={copy} disabled={entries.length === 0}>
            {copied ?? 'Copy'}
          </button>
        </div>
      )}
    </>
  )
}
