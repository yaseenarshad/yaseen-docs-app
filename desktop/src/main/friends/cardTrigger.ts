/**
 * WHEN THE MAC TRIES A SEND (YAZ-5086; round 13, item 7): "when a file with cards changes (a review on the Mac, or a pull
 * by GitHub AutoSync)". The vault watcher of each open vault tells of each page that changes. After a quiet moment, the
 * live index says which pages hold cards: a change of one (or of a page that held cards before) starts ONE try. The
 * shared rules then decide (5 minutes at most, the budget). A page with no cards, a picture or a settings file starts
 * nothing. There is no timer that runs on its own: only a change, the app's start and a retry at a time GitHub gave.
 */
import type { WatchEvent } from '@shared/types'

/** The quiet moment after the last change: the live index has the new cards by then, and a burst is one try. */
export const CARD_CHANGE_QUIET_MS = 3000

export interface CardTriggerDeps {
  /** The open vaults now. */
  roots(): readonly string[]
  /** Hear each change of the open vaults; returns its unsubscribe. */
  onRootsChange(listener: () => void): () => void
  /** The vault watcher (`fs/watchers.ts` `subscribe`). */
  subscribe(root: string, listener: (ev: WatchEvent) => void): () => void
  /** The pages of `root` that hold cards now (the live index). */
  cardPaths(root: string): Promise<Set<string>>
  fire(): void
}

const isPage = (p: string) => /\.(md|markdown)$/i.test(p)

export function watchCardFiles(deps: CardTriggerDeps): () => void {
  const subs = new Map<string, () => void>()
  const known = new Map<string, Set<string>>()
  const pending = new Map<string, Set<string>>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const flush = async () => {
    timer = null
    const work = [...pending]
    pending.clear()
    let hit = false
    for (const [root, paths] of work) {
      if (!subs.has(root)) continue
      const before = known.get(root) ?? new Set<string>()
      const now = await deps.cardPaths(root).catch(() => before)
      known.set(root, now)
      if ([...paths].some((p) => now.has(p) || before.has(p))) hit = true
    }
    if (hit && !stopped) deps.fire()
  }

  const listen = (root: string) => (ev: WatchEvent) => {
    if (stopped || (ev.type !== 'add' && ev.type !== 'change' && ev.type !== 'unlink') || !isPage(ev.path)) return
    const set = pending.get(root) ?? new Set<string>()
    set.add(ev.path)
    pending.set(root, set)
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => void flush(), CARD_CHANGE_QUIET_MS)
    timer.unref?.()
  }

  const sync = () => {
    if (stopped) return
    const roots = new Set(deps.roots())
    for (const [root, off] of subs) {
      if (roots.has(root)) continue
      off()
      subs.delete(root)
      known.delete(root)
      pending.delete(root)
    }
    for (const root of roots) {
      if (subs.has(root)) continue
      subs.set(root, deps.subscribe(root, listen(root)))
      // What held cards before the first change, so a page that loses its last card counts too.
      void deps.cardPaths(root).then(
        (paths) => void (known.has(root) || !subs.has(root) ? undefined : known.set(root, paths)),
        () => undefined,
      )
    }
  }

  const offRoots = deps.onRootsChange(sync)
  sync()
  return () => {
    stopped = true
    offRoots()
    for (const off of subs.values()) off()
    subs.clear()
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
}
