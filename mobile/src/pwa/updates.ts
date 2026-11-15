import { PAGE_READY, SKIP_WAITING, UPDATE_MARK, type WorkerState } from './swCore'

/**
 * The page side of an update (YAZ-5087; YAZ-5555). The browser downloads a new version in the background (the worker
 * installs it whole, or not at all). This file notices it; the new version runs ONLY after the person taps Restart:
 * - `ready()` says a new version is there: one waits (installed), or it is active but not chosen (the browser activated
 *   it at a cold start; the worker still serves the chosen version: `swCore.ts`), or it took over this open page.
 * - `apply()` (the tap): the new version takes over and the page loads it, ONE time, with `UPDATE_MARK` in its address,
 *   which makes the worker choose it. The app is never half old and half new.
 * - Nothing here switches by itself: not at a cold start, not when the app comes back (YAZ-5555, Yaseen: "I'll always
 *   know when to restart"). At the start and at each return, the state is read again, so the line shows reliably.
 */

export const SW_URL = '/sw.js'
/** Ask the host for a new version at most this often (at the start, and when the app comes back from the background). */
export const CHECK_EVERY_MS = 30 * 60_000

export interface SwWorkerLike {
  state: string
  postMessage(message: unknown): void
  addEventListener(type: 'statechange', fn: () => void): void
}
export interface SwRegistrationLike {
  waiting: SwWorkerLike | null
  installing: SwWorkerLike | null
  update(): Promise<unknown>
  addEventListener(type: 'updatefound', fn: () => void): void
}
export interface SwContainerLike {
  /** The worker that runs this page now; null on the first open (no version kept yet). */
  controller: { postMessage?(message: unknown): void } | null
  getRegistration(): Promise<SwRegistrationLike | undefined>
  register(url: string, options: { scope: string; updateViaCache: 'none' }): Promise<SwRegistrationLike>
  addEventListener(type: 'controllerchange', fn: () => void): void
}

export interface Updates {
  /** Registers the worker and starts to watch for a new version. Never throws. */
  start(): Promise<void>
  /** A new version is whole and waits, is active but not chosen, or took over and this page still runs the old one. */
  ready(): boolean
  /** The new version runs the page's requests; this page still runs the old files (kept by the worker). */
  tookOver(): boolean
  subscribe(fn: () => void): () => void
  /** The tap on Restart: the new version takes over; the page loads it, one time. Only when `swapNow` says so. */
  apply(): void
  /** Read the worker's state again (each time), and ask the host for a new version (at most each `CHECK_EVERY_MS`). */
  check(): Promise<void>
}

/** The address that loads the new version (the worker chooses it): this address with `UPDATE_MARK`. */
export function updateAddress(href: string): string {
  const url = new URL(href)
  url.searchParams.set(UPDATE_MARK, '1')
  return url.href
}

/** The address without `UPDATE_MARK` (the app removes it from the address bar at its start), or null when it has none. */
export function withoutUpdateMark(href: string): string | null {
  const url = new URL(href)
  if (!url.searchParams.has(UPDATE_MARK)) return null
  url.searchParams.delete(UPDATE_MARK)
  return url.href
}

export function createUpdates(deps: {
  container: SwContainerLike | undefined
  /** Loads the new version (`updateAddress`), one time. */
  reload: () => void
  now: () => number
  /** YAZ-5555: the worker's { active, chosen } (`STATE_ASK`); null when it does not say (an older worker, no worker). */
  readState?: () => Promise<WorkerState | null>
}): Updates {
  const { container, reload, now, readState } = deps
  let reg: SwRegistrationLike | null = null
  let lastCheck = -Infinity
  let reloadOnTakeover = false
  let reloaded = false
  let took = false
  let hadController = false
  /** YAZ-5555: the active version is not the chosen one (the browser activated it; the page runs the chosen one). */
  let pinned = false
  const fns = new Set<() => void>()
  const tell = () => fns.forEach((fn) => fn())
  // A new version is ready when it is installed while an old one runs the page. With no old one (the first open),
  // it simply takes over: no line.
  const ready = () => took || pinned || (reg !== null && container?.controller != null && reg.waiting !== null && reg.waiting.state === 'installed')
  const reloadOnce = () => {
    if (reloaded) return
    reloaded = true
    reload()
  }

  const follow = (worker: SwWorkerLike | null) => worker?.addEventListener('statechange', tell)
  const readPinned = async () => {
    if (readState === undefined || container?.controller == null) return
    const state = await readState().catch(() => null)
    const next = state !== null && typeof state.active === 'string' && typeof state.chosen === 'string' && state.active !== state.chosen
    if (next !== pinned) {
      pinned = next
      tell()
    }
  }

  return {
    async start() {
      if (!container) return
      try {
        reg = await container.register(SW_URL, { scope: '/', updateViaCache: 'none' })
      } catch {
        return
      }
      // Registering an existing worker again does not look for a new one; ask now. The browser also asks on its own
      // when a page opens, but not at once.
      lastCheck = now()
      void reg.update().catch(() => {})
      // YAZ-5303: this page has started, so the page it replaced is gone: the worker may remove a version no page runs.
      container.controller?.postMessage?.({ type: PAGE_READY })
      hadController = container.controller !== null
      container.addEventListener('controllerchange', () => {
        // The first install's takeover (`clients.claim`): this page is simply kept from now on. No line, no reload.
        if (!hadController) {
          hadController = true
          return
        }
        // A new version runs the page's requests now. Only `apply` loads the page again; else the line shows.
        took = true
        tell()
        if (reloadOnTakeover) reloadOnce()
      })
      reg.addEventListener('updatefound', () => {
        follow(reg!.installing)
        tell()
      })
      follow(reg.installing)
      follow(reg.waiting)
      tell()
      await readPinned()
    },
    ready,
    tookOver: () => took,
    subscribe(fn) {
      fns.add(fn)
      return () => fns.delete(fn)
    },
    apply() {
      if (took || pinned) return reloadOnce()
      const waiting = reg?.waiting
      if (!waiting) return
      reloadOnTakeover = true
      waiting.postMessage({ type: SKIP_WAITING })
    },
    async check() {
      await readPinned()
      if (reg === null || now() - lastCheck < CHECK_EVERY_MS) return
      lastCheck = now()
      try {
        await reg.update()
      } catch {
        // No signal, or the host is down: the next check tries again. The running version is not touched.
      }
    },
  }
}
