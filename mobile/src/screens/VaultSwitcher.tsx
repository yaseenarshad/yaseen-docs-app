import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/AppState'
import { vaultId } from '../store'
import { vaultName } from './Frame'
import { VaultBadge, vaultNumber } from './VaultBadge'

/**
 * Top-left mobile Vault Switcher: turns the topbar vault title into a tappable dropdown
 * modeled after Desktop's `All Folders ▾` switcher, with search (when > 4 vaults)
 * and active checkmark. Adding vaults lives in Settings only.
 */
export function VaultSwitcher({ title }: { title: string }) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const vaults = app.list.vaults

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const q = query.trim().toLowerCase()
  const shown = vaults.filter((v) => !q || vaultName(v.repo).toLowerCase().includes(q) || v.repo.toLowerCase().includes(q))

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="vault-switcher">
      <button
        ref={triggerRef}
        type="button"
        className="vault-switcher__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Switch vault (${title})`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="topbar__title vault-switcher__label">{title}</span>
        <span className={open ? 'vault-switcher__caret is-open' : 'vault-switcher__caret'} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <>
          <div className="vault-switcher__scrim" aria-hidden="true" onClick={close} />
          <div className="vault-switcher__menu" role="menu" aria-label="Switch vault">
            {vaults.length > 4 && (
              <div className="vault-switcher__search-wrap">
                <input
                  ref={searchRef}
                  type="search"
                  className="vault-switcher__search"
                  placeholder="Switch vault…"
                  aria-label="Filter vaults"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
            <div className="vault-switcher__list">
              {shown.length === 0 ? (
                <p className="vault-switcher__empty">No matching vaults</p>
              ) : (
                shown.map((v) => {
                  const id = vaultId(v)
                  const active = id === app.vaultKey
                  const num = vaultNumber(vaults, id)
                  const [owner] = v.repo.split('/')
                  return (
                    <button
                      key={id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={active ? 'vault-switcher__item is-active' : 'vault-switcher__item'}
                      onClick={() => {
                        close()
                        if (!active) void app.switchVault(id)
                      }}
                    >
                      {num !== null && <VaultBadge n={num} className="vault-switcher__item-badge" />}
                      <span className="vault-switcher__item-main">
                        <span className="vault-switcher__item-name">{vaultName(v.repo)}</span>
                        <span className="vault-switcher__item-sub">
                          {owner} · {v.branch}
                        </span>
                      </span>
                      {active && (
                        <span className="vault-switcher__check" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
