import { Component, lazy, Suspense, useMemo, useState, type ComponentType, type ReactNode } from 'react'

/**
 * THE ONE WAY THE APP LOADS A SCREEN OF ITS OWN CHUNK (YAZ-5230): `lazyScreen(load)`. A chunk can fail to load: no
 * signal at a cold start, or a new build whose old file names are gone. Without a boundary React unmounts the whole
 * app and the screen goes blank. With it, only the screen's place says so, in plain words, with "Try again" (a new
 * import, not React's cached failure), and "‹ Back" for a screen over the tabs. The tabs, the dot and the waiting
 * answers stay. Every lazy screen of `mobile/src` uses it (Review, the page view, the card view).
 */
export function lazyScreen<P extends object>(load: () => Promise<{ default: ComponentType<P> }>, options: { waiting?: ReactNode } = {}) {
  function LazyScreen(props: P & { onBack?: () => void }) {
    const [attempt, setAttempt] = useState(0)
    // A new `lazy` for each attempt: React keeps a failed import's error, so "Try again" needs a fresh one.
    const Screen = useMemo(() => lazy(load), [attempt]) // eslint-disable-line react-hooks/exhaustive-deps
    const { onBack, ...rest } = props
    return (
      <ChunkBoundary key={attempt} onRetry={() => setAttempt((n) => n + 1)} onBack={onBack}>
        <Suspense fallback={options.waiting ?? <div className="lazy-screen" aria-busy="true" />}>
          <Screen {...(rest as P)} />
        </Suspense>
      </ChunkBoundary>
    )
  }
  return LazyScreen
}

/** The plain words when a screen's chunk does not load. */
export const CHUNK_FAILED = 'This screen did not load. It needs a connection the first time. Your answers are safe on this phone.'

class ChunkBoundary extends Component<{ children: ReactNode; onRetry: () => void; onBack?: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(): void {
    // Shown on the screen; nothing to log (no raw error text reaches the person, YAZ-5076).
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
