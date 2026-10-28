/**
 * THE CODE OUTLINE'S FEED (YAZ-3486): one per code tab, made with its editor. It reads the file's
 * symbols and Monaco's markers, and keeps the Outline's snapshot: the tree (`buildTree`) and the
 * markers. `CodeOutline.tsx` subscribes (`useSyncExternalStore`).
 *
 * NEVER ON THE KEYSTROKE PATH. An edit only re-arms one timer; `READ_DELAY_MS` after the last edit
 * the symbols are read again (a worker does the work; a `.py` file is read from its text), and the tree is built once
 * when the answer comes. A TS or JS file's answer is the tree itself, built in the TS worker
 * (YAZ-3501): the page only takes it. An answer that a newer read overtook is thrown away. The first
 * read is at once, so a file opens with its Outline.
 *
 * NAMES INSIDE FUNCTIONS (YAZ-3507) are left out where the tree is built (the TS worker, or `buildTree`
 * here), never per render. `setLocals` ("…" › Show › "Variables inside functions") reads again at once.
 *
 * A LANGUAGE THAT GETS READY LATER (YAZ-3527). Monaco sets up a language's smart help after its first model
 * exists (a dynamic import): until then a JSON, CSS or HTML file has no symbol provider, and the TS worker
 * accessor rejects ("TypeScript not registered!"). So the first read of a tab restored at launch, or of the
 * first such file of a session, answered nothing. The feed reads again when a symbol provider for the model
 * registers (`onSymbolProviderChange`, `monacoInternals.ts`): an event, no timer.
 *
 * OFF READS NOTHING. While the Outline is off (Settings › Table of contents › Off), `setActive(false)`
 * stops the reads: an edit arms no timer. Turning it on reads at once.
 *
 * Markers come from Monaco's own workers (`getModelMarkers`): a change of this model's
 * markers is a new snapshot, with no new read.
 */
import { monaco } from '../monaco'
import { onSymbolProviderChange } from '../monacoInternals'
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
  /** Keep (true) or leave out (false) the names inside functions: a change reads again (YAZ-3507). */
  setLocals(show: boolean): void
  dispose(): void
}

/** A read's answer: a built tree (the TS worker's, YAZ-3501), a provider's symbols, or null for no answer. */
export type ReadSymbols = (editor: Editor, model: Model, showLocals: boolean) => Promise<OutlineTree | readonly CodeSymbol[] | null>

const EMPTY: OutlineSnapshot = { tree: null, markers: [] }

const isTree = (answer: OutlineTree | readonly CodeSymbol[]): answer is OutlineTree => !Array.isArray(answer)

/** Starts the feed of one code tab. `read` is `symbolSource.readSymbols`, given by the caller. */
export function attachOutlineFeed(editor: Editor, model: Model, read: ReadSymbols, active = true, showLocals = false): OutlineFeed {
  let snapshot = EMPTY
  let disposed = false
  let on = active
  let locals = showLocals
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
    const asLocals = locals
    const symbols = await read(editor, model, asLocals).catch(() => null)
    // No answer (a worker that failed, a provider that failed): the last tree stands, so the
    // Outline never blinks away for one bad read. An empty answer is a file with no symbol now.
    if (disposed || mine !== asked || model.isDisposed() || symbols === null) return
    const tree = isTree(symbols) ? (symbols.size === 0 ? null : symbols) : symbols.length === 0 ? null : buildTree(symbols, asLocals)
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
  // The language's providers registered after the first read (YAZ-3527): read again. A TS read asks for the
  // worker through a dynamic import, so it runs after Monaco's set-up has also made the worker accessor.
  const providers = onSymbolProviderChange(editor, () => {
    if (disposed) return
    if (!on) {
      stale = true
      return
    }
    clearTimeout(timer)
    void readNow()
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
    setLocals(next) {
      if (next === locals || disposed) return
      locals = next
      if (!on) {
        // The next switch-on reads with the new choice.
        if (snapshot.tree !== null) stale = true
        return
      }
      clearTimeout(timer)
      void readNow()
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      edits.dispose()
      marks.dispose()
      providers?.dispose()
      listeners.clear()
    },
  }
}
