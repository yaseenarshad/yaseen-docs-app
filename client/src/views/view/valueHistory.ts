/**
 * ⌘Z / ⇧⌘Z for the folder table's value changes (YAZ-4612 S41): one history per folder page, in memory only. A step
 * is one gesture — a typed cell, a paste, a fill, a clear, a Set value, a New row below — however many notes it wrote.
 * Undo runs the step's `undo` and moves it to the redo list; a new step empties that list. A step with no `redo` (New
 * row below: its undo trashes the note) leaves no redo. At most `MAX_STEPS` steps a page, and `MAX_PAGES` pages, the
 * oldest out. A toast's Undo is `undoStep` on its own step (YAZ-4637 T9e): the same move to the redo list as ⌘Z.
 * The notes a step writes are `PathRef`s (T3): a rename remaps them and a delete retires them, so a step written
 * before a retitle still reaches its note — and never another file at the old path.
 */
export interface HistoryStep {
  undo: () => void
  redo?: () => void
  /** The notes the step writes (YAZ-4637 T3), remapped by `renameHistoryPaths`, retired by `dropHistoryPaths`. */
  notes?: PathRef[]
}

/** A note as a step holds it: its current path, or null once the note was deleted. */
export interface PathRef {
  path: string | null
}

export const noteRef = (path: string): PathRef => ({ path })

export interface ValueHistory {
  push: (step: HistoryStep) => void
  /** False when there was nothing to undo (or redo): the key is then not the table's. */
  undo: () => boolean
  redo: () => boolean
  /** Undo THIS step, wherever it stands in the past, and move it to the redo list as ⌘Z would (T9e). False when it is not in the past. */
  undoStep: (step: HistoryStep) => boolean
}

export const MAX_STEPS = 100
export const MAX_PAGES = 50

const pages = new Map<string, { past: HistoryStep[]; future: HistoryStep[] }>()

/** The history of the folder page `key` (its folder path): the same lists for every view and tab on that page. */
export function valueHistory(key: string): ValueHistory {
  const lists = () => {
    let page = pages.get(key)
    if (page === undefined) {
      page = { past: [], future: [] }
      pages.set(key, page)
      if (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value!)
    }
    return page
  }
  const undoAt = (page: { past: HistoryStep[]; future: HistoryStep[] }, at: number): boolean => {
    if (at < 0) return false
    const [step] = page.past.splice(at, 1)
    step.undo()
    if (step.redo !== undefined) page.future.push(step)
    return true
  }
  return {
    push: (step) => {
      const page = lists()
      page.past.push(step)
      if (page.past.length > MAX_STEPS) page.past.shift()
      page.future = []
    },
    undo: () => {
      const page = lists()
      return undoAt(page, page.past.length - 1)
    },
    undoStep: (step) => {
      const page = lists()
      return undoAt(page, page.past.indexOf(step))
    },
    redo: () => {
      const page = lists()
      const step = page.future.pop()
      if (step === undefined) return false
      step.redo!()
      page.past.push(step)
      return true
    },
  }
}

/** For tests: every page's history gone. */
export const dropAllHistories = (): void => pages.clear()

const isAtOrUnder = (path: string, at: string): boolean => path === at || path.startsWith(`${at}/`)

/** Every step's refs, in every page's past and future. */
function eachRef(visit: (ref: PathRef) => void): void {
  for (const page of pages.values()) for (const step of [...page.past, ...page.future]) for (const ref of step.notes ?? []) visit(ref)
}

/** A note or folder renamed (App's `file:renamed`, YAZ-4637 T3): every step's note at or under it follows. */
export function renameHistoryPaths(oldPath: string, newPath: string): void {
  eachRef((ref) => {
    if (ref.path !== null && isAtOrUnder(ref.path, oldPath)) ref.path = newPath + ref.path.slice(oldPath.length)
  })
}

/** A note or folder deleted (App's `file:deleted`, T3): every step's note at or under it is retired — an Undo writes nothing there. */
export function dropHistoryPaths(path: string): void {
  eachRef((ref) => {
    if (ref.path !== null && isAtOrUnder(ref.path, path)) ref.path = null
  })
}

/** At most this many notes are written at once (S48): a big paste does not start hundreds of writes together. */
export const WRITE_BATCH = 8

/** Run `jobs` with at most `WRITE_BATCH` running at a time; resolves when all settle, rejects with the first failure. */
export async function inBatches(jobs: readonly (() => Promise<unknown>)[]): Promise<void> {
  let next = 0
  let failure: unknown = null
  const lane = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      try {
        await job()
      } catch (error) {
        failure ??= error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(WRITE_BATCH, jobs.length) }, lane))
  if (failure !== null) throw failure
}
