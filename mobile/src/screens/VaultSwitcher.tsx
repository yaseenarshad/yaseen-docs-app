import { lazy, Suspense, useEffect, useRef, useState } from 'react'

const VaultSwitcherMenu = lazy(() => import('./VaultSwitcherMenu').then((m) => ({ default: m.VaultSwitcherMenu })))

/**
 * Top-left mobile Vault Switcher: turns the topbar vault title into a tappable dropdown
 * modeled after Desktop's `All Folders ▾` switcher, with search (when > 4 vaults)
 * and active checkmark. Adding vaults lives in Settings only.
 */
export function VaultSwitcher({ title }: { title: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

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
        <Suspense fallback={null}>
          <VaultSwitcherMenu onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
