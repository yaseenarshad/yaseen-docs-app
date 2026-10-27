/**
 * A code tab's folds, remembered (YAZ-3451; YAZ-3438 D7): in the app state, `folders[root].folds[path]`,
 * the store note folds use — never in the file.
 *
 * KEYED BY TEXT, NOT BY LINE NUMBER. A fold's key is the text of its first line, trimmed and cut at
 * `MAX_KEY_TEXT`; the 2nd, 3rd, … line with the same text gets `\0<n>` after it. So when another app adds
 * lines above a folded function, the fold finds the function again (S2), and a key whose line is gone
 * finds nothing and is dropped (S3).
 *
 * NOTHING PER KEYSTROKE OR SCROLL. Monaco's public `onDidChangeHiddenAreas` (a fold opened or closed)
 * starts one timer; when it fires, the folded start lines are read from `saveViewState()` and the keys
 * written only when they changed. The pending keys are written when the tab closes.
 *
 * THE ONE INTERNAL DOOR. Monaco has no public "fold the region that starts on line n": the restore asks
 * the folding controller (`editor.contrib.folding`) for its model. That use is here alone, behind
 * `FoldingModelLike`; when it is missing (a file too big to fold, a later Monaco), nothing folds and
 * nothing throws.
 */

/** Longest first-line text a key keeps: a minified line must not put a page of code into the app state. */
export const MAX_KEY_TEXT = 200
/** The wait after the last fold change before the keys are written. */
export const FOLD_WRITE_DELAY_MS = 400

const FOLDING = 'editor.contrib.folding'

/** What the keys need of a text model: its lines, 1-based. */
export interface LinesLike {
  getLineCount(): number
  getLineContent(lineNumber: number): string
}

const keyText = (line: string): string => line.trim().slice(0, MAX_KEY_TEXT)
const keyOf = (text: string, occurrence: number): string => (occurrence === 1 ? text : `${text}\u0000${occurrence}`)

/** The keys of the folds that start on `starts` (1-based lines), in line order. */
export function foldKeysOf(model: LinesLike, starts: readonly number[]): string[] {
  if (starts.length === 0) return []
  const folded = new Set(starts)
  const texts = new Set<string>()
  for (const line of folded) texts.add(keyText(model.getLineContent(line)))
  const seen = new Map<string, number>()
  const keys: string[] = []
  // Only the lines up to the last fold can count towards an occurrence.
  const last = Math.min(Math.max(...folded), model.getLineCount())
  for (let line = 1; line <= last; line++) {
    const text = keyText(model.getLineContent(line))
    if (!texts.has(text)) continue
    const occurrence = (seen.get(text) ?? 0) + 1
    seen.set(text, occurrence)
    if (folded.has(line) && text !== '') keys.push(keyOf(text, occurrence))
  }
  return keys
}

/** The start line of each key in `model` now, and the keys whose line is gone. */
export function foldLinesOf(model: LinesLike, keys: readonly string[]): { lines: number[]; missing: string[] } {
  const wanted = new Map<string, Map<number, string>>()
  let valid = 0
  for (const key of keys) {
    const cut = key.lastIndexOf('\u0000')
    const occurrence = cut === -1 ? 1 : Number(key.slice(cut + 1))
    const text = cut === -1 ? key : key.slice(0, cut)
    if (!Number.isInteger(occurrence) || occurrence < 1 || text === '') continue
    const byOccurrence = wanted.get(text) ?? new Map<number, string>()
    if (!byOccurrence.has(occurrence)) valid++
    byOccurrence.set(occurrence, key)
    wanted.set(text, byOccurrence)
  }
  const found = new Set<string>()
  const lines: number[] = []
  const seen = new Map<string, number>()
  const count = model.getLineCount()
  // Stops at the line where the last key is found.
  for (let line = 1; line <= count && found.size < valid; line++) {
    const text = keyText(model.getLineContent(line))
    const byOccurrence = wanted.get(text)
    if (byOccurrence === undefined) continue
    const occurrence = (seen.get(text) ?? 0) + 1
    seen.set(text, occurrence)
    const key = byOccurrence.get(occurrence)
    if (key !== undefined) {
      found.add(key)
      lines.push(line)
    }
  }
  return { lines, missing: keys.filter((key) => !found.has(key)) }
}

/** The part of Monaco's folding model the restore uses (internal API, see the module doc). */
interface FoldingModelLike {
  regions: { length: number; getStartLineNumber(index: number): number; isCollapsed(index: number): boolean; toRegion(index: number): unknown }
  toggleCollapseState(regions: unknown[]): void
}

/** What the folds need of the editor: public Monaco API, plus `getContribution` for the restore. */
export interface FoldEditorLike {
  getModel(): LinesLike | null
  saveViewState(): { contributionsState?: Record<string, unknown> } | null
  onDidChangeHiddenAreas(listener: () => void): { dispose(): void }
  getContribution(id: string): unknown
}

export interface CodeFolds {
  /** The keys now: the page view of "Duplicate tab" (YAZ-2951) reads them. */
  keys(): string[]
  /** Write a pending change now (the tab is closing). */
  flush(): void
  dispose(): void
}

/** The folded start lines, from the folding part of Monaco's view state (`collapsedRegions`). */
function foldedStarts(editor: FoldEditorLike): number[] {
  const state = editor.saveViewState()?.contributionsState?.[FOLDING] as { collapsedRegions?: { startLineNumber: number; isCollapsed?: boolean }[] } | undefined
  return (state?.collapsedRegions ?? []).filter((r) => r.isCollapsed !== false).map((r) => r.startLineNumber)
}

/**
 * Folds `seed` once Monaco has its regions, then keeps the stored keys in step. `write` stores keys;
 * `cleanup: false` (a copy, YAZ-2951 S10) writes nothing until a fold changes. `onRestored` runs once,
 * after the restore (or at once with nothing to restore): the place to apply a scroll spot.
 */
export function attachFolds(editor: FoldEditorLike, options: { seed: readonly string[]; write: (keys: string[]) => void; cleanup: boolean; onRestored?: () => void }): CodeFolds {
  let current = [...options.seed]
  let restoring = options.seed.length > 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const keysNow = (): string[] => {
    const model = editor.getModel()
    return model === null ? current : foldKeysOf(model, foldedStarts(editor))
  }
  const save = (): void => {
    timer = null
    const keys = keysNow()
    if (keys.length === current.length && keys.every((k, i) => k === current[i])) return
    current = keys
    options.write(keys)
  }
  const restored = (): void => {
    restoring = false
    options.onRestored?.()
  }

  if (restoring) {
    const controller = editor.getContribution(FOLDING) as { getFoldingModel?: () => Promise<FoldingModelLike | null> | null } | null
    const ready = controller?.getFoldingModel?.() ?? null
    if (ready === null) restored()
    else
      void ready
        .then((folding) => {
          const model = editor.getModel()
          if (disposed || folding === null || model === null) return
          const { lines, missing } = foldLinesOf(model, options.seed)
          const starts = new Set(lines)
          const regions: unknown[] = []
          for (let i = 0; i < folding.regions.length; i++) {
            if (starts.has(folding.regions.getStartLineNumber(i)) && !folding.regions.isCollapsed(i)) regions.push(folding.regions.toRegion(i))
          }
          if (regions.length > 0) folding.toggleCollapseState(regions)
          // S3: a key whose line is gone leaves the store, once.
          if (missing.length > 0 && options.cleanup) {
            current = current.filter((key) => !missing.includes(key))
            options.write(current)
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!disposed) restored()
        })
  } else restored()

  const hidden = editor.onDidChangeHiddenAreas(() => {
    if (restoring || disposed) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(save, FOLD_WRITE_DELAY_MS)
  })

  const flush = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    save()
  }
  return {
    keys: () => (restoring ? current : keysNow()),
    flush,
    dispose: () => {
      if (disposed) return
      flush()
      disposed = true
      hidden.dispose()
    },
  }
}
