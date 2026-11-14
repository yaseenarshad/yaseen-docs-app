import { lazy, Suspense } from 'react'
import { useApp } from '../app/AppState'
import { syncHelp } from '../app/help'
import { topRoute, type Route, type Tab } from '../app/nav'
import { FirstDownload } from './FirstDownload'
import { ForwardButton, Frame, vaultName } from './Frame'
import { Friends } from './Friends'
import { Review } from './Review'
import { ScanCode } from './ScanCode'
import { Search } from './Search'
import { Settings } from './Settings'
import { SetupGuide } from './SetupGuide'
import { SignIn } from './SignIn'

/** The reader (4C, YAZ-5079): a chunk of its own, with the Markdown renderer, so the tabs do not load it. */
const PageView = lazy(() => import('../page/PageView'))
const CardView = lazy(() => import('../page/CardView'))

/** Each tab draws one component from its own file; 4B, 4C and 4E replace the placeholders (decision 21). */
const TAB_SCREENS: Record<Tab, () => React.JSX.Element> = { friends: Friends, review: Review, search: Search }

/**
 * The app (decision 21; YAZ-5077): sign-in when the phone has no vault (row F1), the first download (row F2), then
 * the three tabs with the gear. Screens that Settings opens stack over the tabs.
 */
export function Shell() {
  const app = useApp()
  const route = topRoute(app.nav)

  if (app.phase === 'loading') return <div className="app" aria-busy="true" />

  // Before a vault is ready: the sign-in, and the two screens it links to.
  if (app.phase !== 'ready' || app.vault === null) {
    if (route !== null && route.kind !== 'settings') return <RouteScreen route={route} />
    return app.phase === 'sign-in-again' && app.vaultKey !== null ? <SignIn mode={{ kind: 'again', vault: app.vaultKey }} /> : <SignIn mode={{ kind: 'first' }} />
  }

  if (route !== null) return <RouteScreen route={route} />

  const downloading = app.sync.vault === app.vaultKey && !app.sync.ready
  const help = syncHelp(app.sync, app.vault, app.unit, downloading)
  if (downloading) return <FirstDownload help={help} />

  const TabScreen = TAB_SCREENS[app.nav.tab]
  // A problem the person must act on (red: N6, R12, F6). The passing ones are the dot's (4D).
  const notice =
    help === null ? undefined : (
      <div className="notice" role="alert">
        <p>{help.message}</p>
        <ForwardButton forward={help.forward} />
      </div>
    )
  return (
    <Frame title={vaultName(app.vault.repo)} gear tabs notice={notice}>
      <TabScreen />
    </Frame>
  )
}

function RouteScreen({ route }: { route: Route }) {
  switch (route.kind) {
    case 'settings':
      return <Settings />
    case 'add-vault':
      return <SignIn mode={{ kind: 'add' }} />
    case 'replace-token':
      return <SignIn mode={{ kind: 'again', vault: route.vault }} />
    case 'guide':
      return <SetupGuide />
    case 'scan':
      return <ScanCode vault={route.vault} />
    case 'page':
      return (
        <Suspense fallback={<div className="app" aria-busy="true" />}>
          <PageView key={route.path} path={route.path} at={route.at} />
        </Suspense>
      )
    case 'card':
      return (
        <Suspense fallback={<div className="app" aria-busy="true" />}>
          <CardView key={`${route.path}#${route.id}`} path={route.path} id={route.id} />
        </Suspense>
      )
  }
}
