import { useApp } from '../app/AppState'
// The one door to open a file. Q4: the Today button is a tab screen's first open, so ALWAYS a full page.
import { openFile } from '../explore/openFile'
import { Toast, useToast } from '../screens/Toast'

const load = () => import('./today')

/**
 * The "Today" button of the tab bar, right of Search: the frame shows it only in a vault with Daily pages on
 * (`.yaseendocs/daily-pages.json`, read with the vault's other tab settings: `app/vaultTabs.ts`). A tap opens
 * today's daily page, else the latest one before it (`today.ts`); with none at all, a short line.
 */
export function TodayTab() {
  const app = useApp()
  const { store } = app.services
  const vault = app.vaultKey
  const [toast, say] = useToast()
  if (vault === null) return null
  const tap = () =>
    void load()
      .then((m) => m.findToday(store, vault, new Date((app.services.now ?? Date.now)())))
      .then((found) => (found === null ? say('No daily notes yet') : openFile(app, { kind: 'page', path: found.path }, { from: 'tab' })))
      .catch(() => say('Could not open the daily note'))
  return (
    <>
      <button type="button" className="tabbar__tab tabbar__today" onClick={tap}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
          <rect x="1.75" y="2.75" width="12.5" height="11.5" rx="1.5" />
          <path d="M1.75 6.25h12.5M5 1.25V4m6-2.75V4" />
        </svg>
        Today
      </button>
      {toast !== null && <Toast text={toast} />}
    </>
  )
}
