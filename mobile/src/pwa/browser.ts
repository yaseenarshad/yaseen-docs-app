import { createUpdates, swapAtStart, type SwContainerLike, type Updates } from './updates'

/**
 * The browser side of the home-screen app (YAZ-5087), for `main.tsx`. Only the real build has a service worker: not
 * the dev server (`vite`), not the screenshot build (`--mode fixtures`), not the tests.
 */
const enabled = import.meta.env.PROD && import.meta.env.MODE !== 'fixtures'
const container = (): SwContainerLike | undefined => (enabled && 'serviceWorker' in navigator ? (navigator.serviceWorker as unknown as SwContainerLike) : undefined)
const reload = () => location.reload()

/** At the start: a version that waits takes over now, before the app runs. True: the page loads again; start nothing. */
export const swapWaitingVersion = (): Promise<boolean> => swapAtStart(container(), reload)

/** The worker, registered; and the update the line watches. Null: no service worker here. */
export function startUpdates(): Updates | null {
  const c = container()
  if (!c) return null
  const updates = createUpdates({ container: c, reload, now: Date.now })
  void updates.start()
  return updates
}
