import type { ReactNode } from 'react'
import { useApp } from '../app/AppState'
import { FORWARD_LABEL, type Forward } from '../app/help'
import { TABS } from '../app/nav'
import { SyncStatus } from './SyncStatus'

/**
 * The frame of every screen: the top bar, the screen, and (when a vault is open) the tab bar. The bars keep clear of
 * the notch and the home bar (safe areas, `styles.css`). Every control is at least 44 pt and has a VoiceOver name.
 */
export function Frame({
  title,
  back,
  gear = false,
  tabs = false,
  notice,
  children,
}: {
  title: string
  /** Shows "‹ Back" before the title. */
  back?: () => void
  /** Shows the status slot (4D) and the gear. */
  gear?: boolean
  tabs?: boolean
  /** A problem line under the top bar. */
  notice?: ReactNode
  children: ReactNode
}) {
  const app = useApp()
  const route = app.nav.stack.at(-1)
  return (
    <div className="app">
      <header className="topbar">
        {back && (
          <button type="button" className="link-btn back" onClick={back}>
            ‹ Back
          </button>
        )}
        <h1 className="topbar__title">{title}</h1>
        {gear && <SyncStatus />}
        {gear && (
          <button type="button" className="icon-btn" aria-label="Settings" onClick={() => app.go({ type: 'open', route: { kind: 'settings' } })}>
            ⚙
          </button>
        )}
      </header>
      {notice}
      <main className="screen">{children}</main>
      {tabs && (
        <nav className="tabbar" role="tablist" aria-label="Tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="tabbar__tab"
              aria-selected={route === undefined && app.nav.tab === t.id}
              onClick={() => app.go({ type: 'tab', tab: t.id })}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

/** A problem with its plain words and one way forward. `role="alert"`, so VoiceOver reads it when it shows. */
export function Problem({ message, action, onAction, quiet = false }: { message: string; action?: string; onAction?: () => void; quiet?: boolean }) {
  return (
    <div className={quiet ? 'problem problem--quiet' : 'problem'} role="alert">
      <p>{message}</p>
      {action && onAction && (
        <button type="button" className="btn" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  )
}

/** The vault's name in the top bar: the repo's name, as the Mac names a vault by its folder. */
export const vaultName = (repo: string): string => repo.split('/')[1] ?? repo

/** The way forward of a sync problem. */
export function ForwardButton({ forward }: { forward: Forward }) {
  const app = useApp()
  const act = () => {
    if (forward === 'sign-in-again' && app.vaultKey !== null) app.go({ type: 'open', route: { kind: 'replace-token', vault: app.vaultKey } })
    else if (forward === 'settings') app.go({ type: 'open', route: { kind: 'settings' } })
    else if (forward === 'token-guide' || forward === 'repo-guide') app.go({ type: 'open', route: { kind: 'guide' } })
    else void app.services.sync.syncNow()
  }
  return (
    <button type="button" className="btn" onClick={act}>
      {FORWARD_LABEL[forward]}
    </button>
  )
}
