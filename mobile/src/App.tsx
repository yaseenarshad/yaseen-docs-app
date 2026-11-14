import { AppProvider, type AppServices } from './app/AppState'
import { Shell } from './screens/Shell'

/** Notecards: the app state (`AppProvider`) around the shell. `main.tsx` passes the real services; tests pass fakes. */
export function App({ services }: { services: AppServices }) {
  return (
    <AppProvider services={services}>
      <Shell />
    </AppProvider>
  )
}

/** The browser gives no storage (Private Browsing, or blocked site data): the app cannot keep a vault. */
export function NoStorage() {
  return (
    <div className="app">
      <main className="screen">
        <h1 className="title">Notecards</h1>
        <div className="problem" role="alert">
          <p>This browser does not let Notecards keep your vault on the phone. Turn off Private Browsing, or open Notecards from the Home Screen.</p>
        </div>
      </main>
    </div>
  )
}
