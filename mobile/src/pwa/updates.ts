import { SKIP_WAITING } from './swCore'

/**
 * The page side of an update (YAZ-5087). The browser downloads a new version in the background (the worker installs
 * it whole, or not at all). This file notices it and makes it take over ONLY when the page says so:
 * - `swapAtStart`: at the start, before the app runs, a version that waits takes over at once ("the next open uses it").
 * - `createUpdates`: while the app runs, `ready()` says a new version waits; `apply()` makes it take over, then the page
 *   loads again ONE time. The app is never half old and half new: the old page keeps its old files until the reload.
 */

export const SW_URL = '/sw.js'
/** Ask the host for a new version at most this often (at the start, and when the app comes back from the background). */
export const CHECK_EVERY_MS = 30 * 60_000
/** At the start, wait at most this long for the waiting version to take over; then start the old one (never a blank screen). */
export const START_SWAP_WAIT_MS = 3_000

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
  controller: unknown | null
  getRegistration(): Promise<SwRegistrationLike | undefined>
  register(url: string, options: { scope: string; updateViaCache: 'none' }): Promise<SwRegistrationLike>
  addEventListener(type: 'controllerchange', fn: () => void): void
}

/** True when a new version took over and the page is loading again: do not start the app. */
export async function swapAtStart(container: SwContainerLike | undefined, reload: () => void, waitMs = START_SWAP_WAIT_MS): Promise<boolean> {
  if (!container) return false
  let reg: SwRegistrationLike | undefined
  try {
    reg = await container.getRegistration()
  } catch {
    return false
  }
  const waiting = reg?.waiting
  if (!waiting || container.controller === null) return false
  const took = new Promise<boolean>((resolve) => {
    container.addEventListener('controllerchange', () => resolve(true))
    setTimeout(() => resolve(false), waitMs)
  })
  waiting.postMessage({ type: SKIP_WAITING })
  if (!(await took)) return false
  reload()
  return true
}

export interface Updates {
  /** Registers the worker and starts to watch for a new version. Never throws. */
  start(): Promise<void>
  /** A new version is whole and waits, or it already took over and this page still runs the old one. */
  ready(): boolean
  /** The new version runs the page's requests; this page still runs the old files (kept by the worker). */
  tookOver(): boolean
  subscribe(fn: () => void): () => void
  /** The new version takes over; the page then loads again, one time. Call it at a safe moment only (`safeMoment.ts`). */
  apply(): void
  /**
   * The waiting version takes over, but the page is NOT loaded again (the app goes to the background). Safe at any
   * time: the open page keeps its old files, and the worker keeps the version before, so its lazy chunks still load.
   * Chrome activates a new worker only some seconds after the old one is idle, so this makes the later swap instant.
   */
  prepare(): void
  /** Ask the host for a new version (at most each `CHECK_EVERY_MS`). */
  check(): Promise<void>
}

export function createUpdates(deps: { container: SwContainerLike | undefined; reload: () => void; now: () => number }): Updates {
  const { container, reload, now } = deps
  let reg: SwRegistrationLike | null = null
  let lastCheck = -Infinity
  let reloadOnTakeover = false
  let reloaded = false
  let took = false
  let hadController = false
  const fns = new Set<() => void>()
  const tell = () => fns.forEach((fn) => fn())
  // A new version is ready when it is installed while an old one runs the page. With no old one (the first open),
  // it simply takes over: no line.
  const ready = () => took || (reg !== null && container?.controller != null && reg.waiting !== null && reg.waiting.state === 'installed')
  const reloadOnce = () => {
    if (reloaded) return
    reloaded = true
    reload()
  }

  const follow = (worker: SwWorkerLike | null) => worker?.addEventListener('statechange', tell)

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
    },
    ready,
    tookOver: () => took,
    subscribe(fn) {
      fns.add(fn)
      return () => fns.delete(fn)
    },
    apply() {
      if (took) return reloadOnce()
      const waiting = reg?.waiting
      if (!waiting) return
      reloadOnTakeover = true
      waiting.postMessage({ type: SKIP_WAITING })
    },
    prepare() {
      if (!took) reg?.waiting?.postMessage({ type: SKIP_WAITING })
    },
    async check() {
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
