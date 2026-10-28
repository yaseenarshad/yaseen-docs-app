/**
 * THE CODE OUTLINE'S FEED (YAZ-3486): one per code tab, made with its editor. It reads the file's
 * symbols and Monaco's markers, and keeps the Outline's snapshot: the tree (`buildTree`) and the
 * markers. `CodeOutline.tsx` subscribes (`useSyncExternalStore`).
 *
 * NEVER ON THE KEYSTROKE PATH. An edit only re-arms one timer; `READ_DELAY_MS` after the last edit
 * the symbols are read again (a worker or the helper does the work), and the tree is built once
 * when the answer comes. A TS or JS file's answer is the tree itself, built in the TS worker
 * (YAZ-3501): the page only takes it. An answer that a newer read overtook is thrown away. The first
 * read is at once, so a file opens with its Outline.
 *
 * OFF READS NOTHING. While the Outline is off (Settings › Table of contents › Off), `setActive(false)`
 * stops the reads: an edit arms no timer. Turning it on reads at once.
 *
 * Markers come from Monaco (the TS worker's errors, the helper's none): a change of this model's
 * markers is a new snapshot, with no new read.
 */
import { monaco } from '../monaco'
import { buildTree, type CodeSymbol, type MarkerLike, type OutlineTree } from './outlineModel'

type Model = ReturnType<typeof monaco.editor.createModel>
type Editor = ReturnType<typeof monaco.editor.create>

/** The wait after the last edit before the symbols are read again. */
export const READ_DELAY_MS = 300

export interface OutlineSnapshot {
  /** Null until the first answer, and while no source answers (S11: no Outline). */
  tree: OutlineTree | null
  markers: readonly MarkerLike[]
}

export interface OutlineFeed {
  getState(): OutlineSnapshot
  subscribe(listener: () => void): () => void
  /** The Outline shows (true) or is off (false): only a shown Outline reads symbols. */
  setActive(active: boolean): void
  dispose(): void
}

/** A read's answer: a built tree (the TS worker's, YAZ-3501), a provider's symbols, or null for no answer. */
export type ReadSymbols = (editor: Editor, model: Model) => Promise<OutlineTree | readonly CodeSymbol[] | null>

const EMPTY: OutlineSnapshot = { tree: null, markers: [] }

const isTree = (answer: OutlineTree | readonly CodeSymbol[]): answer is OutlineTree => !Array.isArray(answer)

/** Starts the feed of one code tab. `read` is `symbolSource.readSymbols`, given by the caller. */
export function attachOutlineFeed(editor: Editor, model: Model, read: ReadSymbols, active = true): OutlineFeed {
  let snapshot = EMPTY
  let disposed = false
  let on = active
  /** An edit came while off: the symbols are stale when it turns on. */
  let stale = false
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Raised for each read: an answer whose number is not the last one is stale. */
  let asked = 0
  const listeners = new Set<() => void>()
  const set = (next: OutlineSnapshot): void => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const markersNow = (): readonly MarkerLike[] => monaco.editor.getModelMarkers({ resource: model.uri })

  const readNow = async (): Promise<void> => {
    timer = undefined
    const mine = ++asked
    const symbols = await read(editor, model).catch(() => null)
    // No answer (a helper that timed out, a provider that failed): the last tree stands, so the
    // Outline never blinks away for one bad read. An empty answer is a file with no symbol now.
    if (disposed || mine !== asked || model.isDisposed() || symbols === null) return
    const tree = isTree(symbols) ? (symbols.size === 0 ? null : symbols) : symbols.length === 0 ? null : buildTree(symbols)
    if (tree === null && snapshot.tree === null) return
    set({ tree, markers: tree === null ? [] : markersNow() })
  }

  const edits = model.onDidChangeContent(() => {
    if (!on) {
      stale = true
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => void readNow(), READ_DELAY_MS)
  })
  const marks = monaco.editor.onDidChangeMarkers((uris) => {
    if (disposed || !uris.some((uri) => uri.toString() === model.uri.toString())) return
    set({ ...snapshot, markers: markersNow() })
  })
  if (on) void readNow()
  else stale = true

  return {
    getState: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setActive(next) {
      if (next === on || disposed) return
      on = next
      if (!on) {
        clearTimeout(timer)
        timer = undefined
        // A read under way is thrown away when it comes.
        asked++
        if (snapshot.tree !== null) stale = true
        return
      }
      if (stale || snapshot.tree === null) {
        stale = false
        void readNow()
      }
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      edits.dispose()
      marks.dispose()
      listeners.clear()
    },
  }
}
