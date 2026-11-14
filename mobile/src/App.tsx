import { AppProvider, type AppServices } from './app/AppState'
import { Shell } from './screens/Shell'
import type { Updates } from './pwa/updates'
import { UpdateLine } from './pwa/UpdateLine'

/**
 * Notecards: the app state (`AppProvider`) around the shell. `main.tsx` passes the real services; tests pass fakes.
 * `updates` (YAZ-5087): the service worker's update, for the "A new version is ready" line; none in dev and tests.
 */
export function App({ services, updates }: { services: AppServices; updates?: Updates | null }) {
  return (
    <AppProvider services={services}>
      <Shell />
      {updates && <UpdateLine updates={updates} />}
    </AppProvider>
  )
}

/** The browser gives no storage (Private Browsing, or blocked site data): the app cannot keep a vault. */
/** The words when the phone's store cannot open (also the dot's end state for a store that stops answering, YAZ-5302). */
export const NO_STORAGE_MESSAGE = 'This browser does not let Notecards keep your vault on the phone. Turn off Private Browsing, or open Notecards from the Home Screen.'

export function NoStorage() {
  return (
    <div className="app">
      <main className="screen">
        <h1 className="title">Notecards</h1>
        <div className="problem" role="alert">
          <p>{NO_STORAGE_MESSAGE}</p>
        </div>
      </main>
    </div>
  )
}
