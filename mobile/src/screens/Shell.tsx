import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../app/AppState'
import { syncHelp } from '../app/help'
import { topRoute, type Route, type Tab } from '../app/nav'
import { FirstDownload } from './FirstDownload'
import { ForwardButton, Frame, vaultName } from './Frame'
import { Friends } from './Friends'
import { lazyScreen } from './LazyScreen'
import { Review } from './Review'
import { ScanCode } from './ScanCode'
import { Search } from './Search'
import { Settings } from './Settings'
import { SetupGuide } from './SetupGuide'
import { SignIn } from './SignIn'

/** The reader (4C, YAZ-5079): a chunk of its own, with the Markdown renderer, so the tabs do not load it. */
const routeWaiting = <div className="app" aria-busy="true" />
const PageView = lazyScreen(() => import('../page/PageView'), { waiting: routeWaiting })
const CardView = lazyScreen(() => import('../page/CardView'), { waiting: routeWaiting })

/** Each tab draws one component from its own file; 4B, 4C and 4E replace the placeholders (decision 21). */
const TAB_SCREENS: Record<Exclude<Tab, 'review'>, () => React.JSX.Element> = { friends: Friends, search: Search }

/**
 * YAZ-5224: the Review tab KEEPS its session while the person looks away (a page or a card over the tabs, another tab,
 * Settings), as the Mac's Inbox tab stays mounted behind a page tab. Once opened, `Review` is ONE element at a fixed
 * place of the shell's tree, drawn through a portal into a box of its own (`host`); the Review tab puts that box on
 * the screen, any other screen takes it off. Off the screen the box is out of the document (no hidden text, no hidden
 * buttons), the session, the shown side and Undo stay, and `shown` is false (the answer timer and the Wake Lock rest).
 */
function ReviewSlot({ host }: { host: HTMLElement }) {
  const place = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = place.current
    if (el === null) return
    el.append(host)
    return () => host.remove()
  }, [host])
  return <div ref={place} className="review-slot" />
}

/**
 * The app (decision 21; YAZ-5077): sign-in when the phone has no vault (row F1), the first download (row F2), then
 * the three tabs with the gear. Screens that Settings opens stack over the tabs.
 */
export function Shell() {
  const app = useApp()
  const route = topRoute(app.nav)
  const reviewHost = useMemo(() => Object.assign(document.createElement('div'), { className: 'review-host' }), [])
  const [reviewKept, setReviewKept] = useState(false)
  const tabsReady = app.phase === 'ready' && app.vault !== null && !(app.sync.vault === app.vaultKey && !app.sync.ready)
  useEffect(() => {
    if (tabsReady && route === null && app.nav.tab === 'review') setReviewKept(true)
  }, [tabsReady, route, app.nav.tab])
  const reviewShown = route === null && app.nav.tab === 'review'
  // The kept Review, always the SECOND child of what the shell returns once the tabs are ready, so it never remounts.
  const kept = tabsReady && (reviewKept || reviewShown) ? createPortal(<Review shown={reviewShown} />, reviewHost) : null

  if (app.phase === 'loading') return <div className="app" aria-busy="true" />

  // Before a vault is ready: the sign-in, and the two screens it links to.
  if (app.phase !== 'ready' || app.vault === null) {
    if (route !== null && route.kind !== 'settings') return <RouteScreen route={route} />
    return app.phase === 'sign-in-again' && app.vaultKey !== null ? <SignIn mode={{ kind: 'again', vault: app.vaultKey }} /> : <SignIn mode={{ kind: 'first' }} />
  }

  if (route !== null)
    return (
      <>
        <RouteScreen route={route} />
        {kept}
      </>
    )

  const downloading = app.sync.vault === app.vaultKey && !app.sync.ready
  const help = syncHelp(app.sync, app.vault, app.unit, downloading)
  if (downloading) return <FirstDownload help={help} />

  const TabScreen = app.nav.tab === 'review' ? null : TAB_SCREENS[app.nav.tab]
  // A problem the person must act on (red: N6, R12, F6). The passing ones are the dot's (4D).
  const notice =
    help === null ? undefined : (
      <div className="notice" role="alert">
        <p>{help.message}</p>
        <ForwardButton forward={help.forward} />
      </div>
    )
  return (
    <>
      <Frame title={vaultName(app.vault.repo)} gear tabs notice={notice}>
        {TabScreen === null ? <ReviewSlot host={reviewHost} /> : <TabScreen />}
      </Frame>
      {kept}
    </>
  )
}

function RouteScreen({ route }: { route: Route }) {
  const app = useApp()
  const back = () => app.go({ type: 'back' })
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
      return <PageView key={route.path} path={route.path} at={route.at} onBack={back} />
    case 'card':
      return <CardView key={`${route.path}#${route.id}`} path={route.path} id={route.id} onBack={back} />
  }
}
