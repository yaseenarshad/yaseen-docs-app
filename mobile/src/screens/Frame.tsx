import { useRef, type ReactNode } from 'react'
import { useApp } from '../app/AppState'
import { FORWARD_LABEL, type Forward } from '../app/help'
import { showsTabBar, tabsOf } from '../app/nav'
import { TodayTab } from '../daily/TodayTab'
import { setReviewTop } from './reviewTop'
import { SyncStatus } from './SyncStatus'
import { useEdgeBack } from './useEdgeBack'

/**
 * The frame of every screen: the top bar, the screen, and (when a vault is open) the tab bar. The bars keep clear of
 * the notch and the home bar (safe areas, `styles.css`). Every control is at least 44 pt and has a VoiceOver name.
 * The bar holds the open vault's tabs (`tabsOf`) and Today; with Search alone it is not drawn (`showsTabBar`).
 */
export function Frame({
  title,
  back,
  gear = false,
  tabs = false,
  notice,
  review = false,
  reader = false,
  chip,
  kind,
  tools,
  foot,
  children,
}: {
  title: string
  /** Shows "←" (VoiceOver: "Back") before the title. */
  back?: () => void
  /** Shows the status slot (4D) and the gear. */
  gear?: boolean
  tabs?: boolean
  /** A problem line under the top bar. */
  notice?: ReactNode
  /**
   * The Review tab (as Mochi): ONE line — the Review screen's "▣ All cards ▾ 3 / 12" first (`reviewTop.ts`),
   * then the sync dot (its words in its sheet) and the gear on the right, as on every other screen. The
   * screen fills the space between the bars.
   */
  review?: boolean
  /** A page or a card: no scroll bar; a soft fade at the bottom, as the Review card. */
  reader?: boolean
  /** The kind of the open file, a small glyph just before the title (the Mac sidebar's; VoiceOver says it). */
  kind?: FileKind
  /** The page's tools (its "⋯"), before the dot. */
  tools?: ReactNode
  /** After the title: the page's ID chip. */
  chip?: ReactNode
  /** Over the tab bar: the page arrows. */
  foot?: ReactNode
  children: ReactNode
}) {
  const app = useApp()
  const route = app.nav.stack.at(-1)
  const frame = useRef<HTMLDivElement>(null)
  // A screen with Back also goes back on a swipe from the left edge (the Home Screen app only).
  useEdgeBack(frame, back)
  return (
    <div className="app" ref={frame}>
      <header className={review ? 'topbar topbar--review' : 'topbar'}>
        {back && (
          <button type="button" className="icon-btn back" aria-label="Back" onClick={back}>
            ←
          </button>
        )}
        {kind !== undefined && <KindIcon kind={kind} className="topbar__kind" />}
        <h1 className={review ? 'topbar__title sr-only' : 'topbar__title'}>{title}</h1>
        {chip}
        {tools}
        {review && <div ref={setReviewTop} className="topbar__review" />}
        {gear && <SyncStatus />}
        {gear && (
          <button type="button" className="icon-btn topbar__gear" aria-label="Settings" onClick={() => app.go({ type: 'open', route: { kind: 'settings' } })}>
            ⚙
          </button>
        )}
      </header>
      {notice}
      <main className={review ? 'screen screen--review' : reader ? 'screen screen--reader' : 'screen'}>{children}</main>
      {foot}
      {tabs && showsTabBar(app.tabs) && (
        <nav className="tabbar" role="tablist" aria-label="Tabs">
          {tabsOf(app.tabs).map((t) => (
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
          {app.tabs.daily && <TodayTab />}
        </nav>
      )}
    </div>
  )
}

/** The kinds of file the reader opens, and their words. (The phone opens no drawing file alone: a drawing is in a page.) */
export type FileKind = 'page' | 'card' | 'card-file'
export const KIND_WORD: Record<FileKind, string> = { page: 'page', card: 'card', 'card-file': 'card file' }

/** The Mac sidebar's glyph of a kind (`styles.css`): a page's, or the card's for a card and a card file. */
export function KindIcon({ kind, className, hidden = false }: { kind: FileKind; className?: string; hidden?: boolean }) {
  return (
    <span
      className={className === undefined ? 'file-icon' : `file-icon ${className}`}
      data-kind={kind === 'page' ? 'markdown' : 'card'}
      {...(hidden ? { 'aria-hidden': true } : { role: 'img', 'aria-label': KIND_WORD[kind] })}
    />
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
