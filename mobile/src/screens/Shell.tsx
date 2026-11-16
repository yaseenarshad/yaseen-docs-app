import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from '../app/AppState'
import { useReaderAhead } from '../explore/openReady'
import { syncHelp } from '../app/help'
import { topRoute, type Route, type Tab } from '../app/nav'
import { FirstDownload } from './FirstDownload'
import { ForwardButton, Frame, vaultName } from './Frame'
import { Friends } from './Friends'
import { lazyScreen } from './LazyScreen'
import { CardView, PageView, routeWaiting } from './PageScreen'
import { Review } from './Review'
import './reviewSlot.css'
import { Search } from './Search'
import { SignIn } from './SignIn'

// The reader (4C) and the card view: `PageScreen.tsx`.
/** A drawing file on its own: with the sheets' reader parts. */
const DrawingView = lazyScreen(() => import('../explore/DrawingView'), { waiting: routeWaiting })
/** A folder's page and its views, read only: a chunk of its own, with the Mac's view engine. */
const FolderView = lazyScreen(() => import('../folders/FolderView'), { waiting: routeWaiting })
/** "You vs <friend>" (4E4): in the friends chunk. */
const VsScreen = lazyScreen(() => import('../friends/ui/VsScreen'), { waiting: routeWaiting })
/** "Set up your phone": a chunk of its own (YAZ-5446 keeps the first load under its ceiling). */
const SetupGuide = lazyScreen(() => import('./SetupGuide'), { waiting: routeWaiting })
/** Settings (the gear): a chunk of its own, after a tap (makes room in the first load under its ceiling). */
const Settings = lazyScreen<object>(() => import('./Settings').then((m) => ({ default: m.Settings })), { waiting: routeWaiting })

/** Each tab draws one component from its own file; 4B, 4C and 4E replace the placeholders (decision 21). */
const TAB_SCREENS: Record<Exclude<Tab, 'review'>, () => React.JSX.Element> = { friends: Friends, search: Search }

/**
 * The Review tab KEEPS its session while the person looks away (a page or a card over the tabs, another tab,
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
 * The app (decision 21): sign-in when the phone has no vault (row F1), the first download (row F2), then
 * the three tabs with the gear. Screens that Settings opens stack over the tabs.
 */
export function Shell() {
  const app = useApp()
  // YAZ-5589: the reader read ahead once the app is idle, so any page opens drawn, at once.
  useReaderAhead(app)
  const route = topRoute(app.nav)
  const reviewHost = useMemo(() => Object.assign(document.createElement('div'), { className: 'review-host' }), [])
  const [reviewKept, setReviewKept] = useState(false)
  const tabsReady = app.phase === 'ready' && app.vault !== null && !(app.sync.vault === app.vaultKey && !app.sync.ready)
  useEffect(() => {
    if (tabsReady && route === null && app.nav.tab === 'review') setReviewKept(true)
  }, [tabsReady, route, app.nav.tab])
  // The keyboard of a field (Search's box) can push the whole document up on iOS, and it stayed up: the next
  // screen's finger then moved the frame. When a field lets go of the keyboard, and on each new screen, the document
  // goes back to its place (it never scrolls on its own: `styles.css`).
  useEffect(() => {
    const home = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
    }
    home()
    document.addEventListener('focusout', home)
    return () => document.removeEventListener('focusout', home)
  }, [route])
  const reviewShown = route === null && app.nav.tab === 'review'
  // The kept Review, always the SECOND child of what the shell returns once the tabs are ready, so it never remounts.
  // Only while the open vault has Review on; another vault's Review is not kept.
  const kept = tabsReady && app.tabs.review && (reviewKept || reviewShown) ? createPortal(<Review shown={reviewShown} />, reviewHost) : null

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
      <Frame title={vaultName(app.vault.repo)} gear tabs notice={notice} review={TabScreen === null}>
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
      return <SetupGuide onBack={back} />
    case 'page':
      return <PageView key={route.path} path={route.path} at={route.at} heading={route.heading} onBack={back} />
    case 'friend':
      return <VsScreen route={route} onBack={back} />
    case 'card':
      return <CardView key={`${route.path}#${route.id}`} path={route.path} id={route.id} onBack={back} />
    case 'drawing':
      return <DrawingView key={route.path} path={route.path} onBack={back} />
    case 'folder':
      return <FolderView key={route.path} path={route.path} onBack={back} />
  }
}
