import { Component, lazy, Suspense, useMemo, useState, type ComponentType, type ReactNode } from 'react'

/**
 * THE ONE WAY THE APP LOADS A SCREEN OF ITS OWN CHUNK: `lazyScreen(load)`. A chunk can fail to load: no
 * signal at a cold start, or a new build whose old file names are gone. Without a boundary React unmounts the whole
 * app and the screen goes blank. With it, only the screen's place says so, in plain words, with "Try again" (a new
 * import, not React's cached failure), and "‹ Back" for a screen over the tabs. The tabs, the dot and the waiting
 * answers stay. Every lazy screen of `mobile/src` uses it (Review, the page view, the card view).
 *
 * YAZ-5589: `preload()` loads the chunk ahead (the Today button, once the app is idle). A screen whose chunk is
 * loaded draws AT ONCE, in the same frame as the tap: no `lazy`, so no `waiting` frame (the page view's is an empty
 * screen with no bars: the "flash" of Today).
 */
export function lazyScreen<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, options: { waiting?: ReactNode } = {}) {
  type M = { default: ComponentType<P> }
  let loaded: M | null = null
  let loading: Promise<M> | null = null
  const loadOnce = (): Promise<M> => {
    loading ??= load().then(
      (m) => (loaded = m),
      (error: unknown) => {
        // A failed load is tried again at the next call (no cached failure).
        loading = null
        throw error
      },
    )
    return loading
  }
  function LazyScreen(props: P & { onBack?: () => void }) {
    const [attempt, setAttempt] = useState(0)
    // A new `lazy` for each attempt: React keeps a failed import's error, so "Try again" needs a fresh one.
    const Screen = useMemo(() => lazy(loadOnce), [attempt]) // eslint-disable-line react-hooks/exhaustive-deps
    const { onBack, ...rest } = props
    // Chosen once, at mount: a screen drawn through `lazy` keeps that place (a change of the tree would remount it).
    const [Loaded] = useState(() => loaded?.default)
    return (
      <ChunkBoundary key={attempt} onRetry={() => void relinkFailedStyles().then(() => setAttempt((n) => n + 1))} onBack={onBack}>
        <Suspense fallback={options.waiting ?? <div className="lazy-screen" aria-busy="true" />}>
          {Loaded !== undefined ? <Loaded {...(rest as P)} /> : <Screen {...(rest as P)} />}
        </Suspense>
      </ChunkBoundary>
    )
  }
  return Object.assign(LazyScreen, { preload: loadOnce })
}

/** A stylesheet that loaded (it has a sheet whose rules can be read). A failed or a cross-origin one has none. */
function sheetLoaded(link: HTMLLinkElement): boolean {
  try {
    return link.sheet !== null && link.sheet.cssRules !== undefined
  } catch {
    return false
  }
}

/**
 * Before "Try again", each stylesheet of a chunk (`/assets/…`) that did not load is linked again: a NEW
 * `<link>` to the same file, which the browser fetches again. Vite's preload helper links a chunk's CSS one time and
 * skips it at the next import of that chunk, so without this the screen comes back with no styles of its own. A sheet
 * that loaded stays as it is. Resolves when each new link has loaded or failed (at most 10 s).
 */
export function relinkFailedStyles(doc: Document = document): Promise<void> {
  const failed = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].filter((l) => /^\/assets\//.test(l.getAttribute('href') ?? '') && !sheetLoaded(l))
  return Promise.all(
    failed.map(
      (old) =>
        new Promise<void>((done) => {
          const fresh = old.cloneNode() as HTMLLinkElement
          fresh.addEventListener('load', () => done(), { once: true })
          fresh.addEventListener('error', () => done(), { once: true })
          setTimeout(done, 10_000)
          old.replaceWith(fresh)
        }),
    ),
  ).then(() => undefined)
}

/** The plain words when a screen's chunk does not load. */
export const CHUNK_FAILED = 'This screen did not load. It needs a connection the first time. Your answers are safe on this phone.'

class ChunkBoundary extends Component<{ children: ReactNode; onRetry: () => void; onBack?: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(): void {
    // Shown on the screen; nothing to log (no raw error text reaches the person).
  }
  render() {
    if (!this.state.failed) return this.props.children
    const { onRetry, onBack } = this.props
    return (
      <div className="lazy-screen lazy-screen--failed" role="alert">
        <p>{CHUNK_FAILED}</p>
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
        {onBack !== undefined && (
          <button type="button" className="link-btn" onClick={onBack}>
            ‹ Back
          </button>
        )}
      </div>
    )
  }
}
