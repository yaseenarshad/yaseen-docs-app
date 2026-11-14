import { useApp } from '../app/AppState'

/**
 * The Review tab: a slot that 4B (YAZ-5078) fills. The shell (4A) draws this component for the tab "Review"; it reads the
 * app's state with `useApp()` (the open vault, its word for "page" as `unit`, the sync state, `go` to move).
 */
export function Review() {
  const { unit } = useApp()
  return (
    <section className="placeholder" aria-label="Review">
      <p>{unit('Review comes in the next build.')}</p>
    </section>
  )
}
