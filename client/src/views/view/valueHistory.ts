/**
 * ⌘Z / ⇧⌘Z for the folder table's value changes (YAZ-4612 S41): one history per folder page, in memory only. A step
 * is one gesture — a typed cell, a paste, a fill, a clear, a Set value, a New row below — however many notes it wrote.
 * Undo runs the step's `undo` and moves it to the redo list; a new step empties that list. A step with no `redo` (New
 * row below: its undo trashes the note) leaves no redo. At most `MAX_STEPS` steps a page, and `MAX_PAGES` pages, the
 * oldest out.
 */
export interface HistoryStep {
  undo: () => void
  redo?: () => void
}

export interface ValueHistory {
  push: (step: HistoryStep) => void
  /** False when there was nothing to undo (or redo): the key is then not the table's. */
  undo: () => boolean
  redo: () => boolean
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
  return {
    push: (step) => {
      const page = lists()
      page.past.push(step)
      if (page.past.length > MAX_STEPS) page.past.shift()
      page.future = []
    },
    undo: () => {
      const page = lists()
      const step = page.past.pop()
      if (step === undefined) return false
      step.undo()
      if (step.redo !== undefined) page.future.push(step)
      return true
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
