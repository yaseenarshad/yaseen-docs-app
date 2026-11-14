import { useApp } from '../app/AppState'

/**
 * The Search tab: a slot that 4C (YAZ-5079) fills. The shell (4A) draws this component for the tab "Search"; it reads the
 * app's state with `useApp()` (the open vault, its word for "page" as `unit`, the sync state, `go` to move).
 */
export function Search() {
  const { unit } = useApp()
  return (
    <section className="placeholder" aria-label="Search">
      <p>{unit('Search for cards and pages comes in the next build.')}</p>
    </section>
  )
}
