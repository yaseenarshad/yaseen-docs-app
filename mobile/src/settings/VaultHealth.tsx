import { useEffect, useState } from 'react'
import { useApp } from '../app/AppState'
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
    </div>
  )
}
