import { useRef, useState } from 'react'
import { useApp } from '../app/AppState'
import { vaultId } from '../store'
import { vaultName } from './Frame'
import { VaultBadge, vaultNumber } from './VaultBadge'

/** Dropdown menu for `VaultSwitcher`, lazy-loaded on first open so `VaultBadge` adds zero first-load JS (YAZ-6560). */
export function VaultSwitcherMenu({ onClose }: { onClose: () => void }) {
  const app = useApp()
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const vaults = app.list.vaults

  const q = query.trim().toLowerCase()
  const shown = vaults.filter((v) => !q || vaultName(v.repo).toLowerCase().includes(q) || v.repo.toLowerCase().includes(q))

  return (
    <>
      <div className="vault-switcher__scrim" aria-hidden="true" onClick={onClose} />
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
                    onClose()
                    if (!active) void app.switchVault(id)
                  }}
                >
                  {num !== null && (
                    <VaultBadge
                      n={num}
                      name={vaultName(v.repo)}
                      icon={app.vaultIcons[id]}
                      className="vault-switcher__item-badge"
                    />
                  )}
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
  )
}
