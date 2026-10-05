import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { nowIso } from '@shared/comments'
import { addReview, deleteReview, setInReview as withReview, type ReviewSettings } from '@shared/reviews'
import { isInReview, reviewQueue } from '@shared/schedule'
import type { IndexRecord } from '@shared/types'
import type { NoticeKind } from '../lib/notice'
import { folderTitle } from '../links/shortcuts'
import { transformFile } from '../views/writeProperty'

/**
 * Upkeep review as App sees it (YAZ-2322): how many notes are due, and the one review session
 * a window can have open. Everything is derived from the index snapshot and the vault's settings;
 * the only thing a review writes is one line in the note's own `reviews` (🔒 D1/D2).
 *
 * A session takes its queue ONCE, at start (🔒 D8). A note is checked against the live index
 * only when its turn comes — gone, turned off or no longer due, it is passed over — and never
 * while it is showing, because editing the page it shows is exactly what makes it no longer due.
 */

export interface ReviewSession {
  /** "Inbox", or the folder's title (YAZ-2420 🔒 D14). */
  label: string
  /** The note showing; null once nothing is left. */
  path: string | null
  /** The showing note's place among the `total` the session started with. */
  position: number
  total: number
  canUndo: boolean
}

export interface ReviewApi {
  dueCount: number
  session: ReviewSession | null
  /** `folder` is root-relative; none is the whole vault. */
  start: (folder?: string) => void
  /** "Still relevant": one line in the note's log, then the next note. */
  keep: () => Promise<void>
  /** Nothing written; the note comes back after the others. */
  skip: () => void
  /** Removes the line `keep` just wrote and shows that note again. */
  undo: () => Promise<void>
  close: () => void
  /** Whether a note is in review; null for a path that is not a note, and for every path while upkeep is off. */
  inReview: (path: string) => boolean | null
  setInReview: (path: string, on: boolean) => Promise<void>
}

interface Session {
  label: string
  /** Paths still to show; the first is the one showing. */
  queue: string[]
  total: number
  undo: { path: string; at: string } | null
}

interface IndexSource {
  readonly records: readonly IndexRecord[]
  readonly folders: readonly IndexRecord[]
  subscribe(listener: () => void): () => void
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function useReview(root: string | null, source: IndexSource, settings: ReviewSettings, onNotice: (text: string, icon?: NoticeKind) => void): ReviewApi {
  const records = useSyncExternalStore(source.subscribe, () => source.records)
  const [session, setSession] = useState<Session | null>(null)
  // "Due now" runs to local midnight, so the count moves at midnight with no file changing.
  const [day, setDay] = useState(0)
  useEffect(() => {
    const timer = setTimeout(() => setDay((d) => d + 1), new Date().setHours(24, 0, 0, 0) - Date.now())
    return () => clearTimeout(timer)
  }, [day])
  // A session ends with its vault, and when upkeep is turned off.
  useEffect(() => setSession(null), [root, settings.enabled])

  const dueCount = useMemo(() => reviewQueue(records, settings, Date.now()).length, [records, settings, day])

  // The callbacks read the latest snapshot at call time; their identities stay stable for memoised children.
  const live = useRef({ records, settings, session })
  live.current = { records, settings, session }
  const busy = useRef(false)

  /** Drops the notes at the head of the queue that are no longer due: their turn came. */
  const settle = useCallback((queue: string[]): string[] => {
    const due = new Set(reviewQueue(live.current.records, live.current.settings, Date.now()).map((r) => r.path))
    const first = queue.findIndex((path) => due.has(path))
    return first === -1 ? [] : queue.slice(first)
  }, [])

  const start = useCallback((folder?: string) => {
    if (!live.current.settings.enabled) return
    const queue = reviewQueue(live.current.records, live.current.settings, Date.now(), folder).map((r) => r.path)
    const label = folder ? folderTitle(source.folders, `${root}/${folder}`) : 'Inbox'
    setSession({ label, queue, total: queue.length, undo: null })
  }, [root, source])

  const keep = useCallback(async () => {
    const path = live.current.session?.queue[0]
    if (path === undefined || busy.current) return
    busy.current = true
    const at = nowIso()
    const undo = await transformFile(path, (content) => addReview(content, at)).then(
      () => ({ path, at }),
      (err: unknown) => {
        onNotice(`Can't save the review: ${reason(err)}`, 'error')
        return null
      },
    )
    busy.current = false
    setSession((s) => (s === null || s.queue[0] !== path ? s : { ...s, queue: settle(s.queue.slice(1)), undo: undo ?? s.undo }))
  }, [onNotice, settle])

  const skip = useCallback(() => {
    setSession((s) => (s === null || s.queue.length === 0 ? s : { ...s, queue: settle([...s.queue.slice(1), s.queue[0]]) }))
  }, [settle])

  const undo = useCallback(async () => {
    const last = live.current.session?.undo
    if (last == null || busy.current) return
    busy.current = true
    const undone = await transformFile(last.path, (content) => deleteReview(content, last.at)).then(
      () => true,
      (err: unknown) => {
        onNotice(`Can't undo the review: ${reason(err)}`, 'error')
        return false
      },
    )
    busy.current = false
    if (undone) setSession((s) => (s === null || s.undo !== last ? s : { ...s, queue: [last.path, ...s.queue], undo: null }))
  }, [onNotice])

  const close = useCallback(() => setSession(null), [])

  const inReview = useCallback((path: string) => {
    if (!live.current.settings.enabled) return null
    const record = live.current.records.find((r) => r.path === path)
    return record === undefined ? null : isInReview(record, live.current.settings)
  }, [])

  const setInReview = useCallback(
    (path: string, on: boolean) =>
      transformFile(path, (content) => withReview(content, on, live.current.settings)).then(
        () => undefined,
        (err: unknown) => onNotice(`Can't turn review ${on ? 'on' : 'off'}: ${reason(err)}`, 'error'),
      ),
    [onNotice],
  )

  const shown = useMemo<ReviewSession | null>(
    () =>
      session && {
        label: session.label,
        path: session.queue[0] ?? null,
        position: Math.min(session.total - session.queue.length + 1, session.total),
        total: session.total,
        canUndo: session.undo !== null,
      },
    [session],
  )

  return { dueCount, session: shown, start, keep, skip, undo, close, inReview, setInReview }
}
