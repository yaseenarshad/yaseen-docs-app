/**
 * EVERY USE OF MONACO'S INTERNAL API (YAZ-3458). Monaco has no public door for these, so each one can break
 * on a Monaco upgrade; rule 42 lists them as the check for one. Each part answers null when it is missing:
 * the feature does nothing, and nothing throws. No runtime import: the folds and the jumps are tested with
 * a fake editor.
 *
 *  1. The folding controller's model (`foldingModelOf`): the fold restore (`codeFolds.ts`) and the table
 *     of contents' jump (`outline/codeJump.ts`). Monaco has no public "fold the region on line n".
 *  2. The editor's command service (`documentSymbolsOf`): the table of contents' symbols for JSON, CSS,
 *     HTML (`outline/symbolSource.ts`). Monaco has no public "the document symbols of this model".
 *  3. In the TS worker, `_getModel` and `getLanguageService` (`tsWorker.ts`): that file is the worker's own
 *     bundle, so they stay there.
 *  4. In the build, `dropMonacoTsWorkerUrl` (`desktop/electron.vite.config.ts`): it fails the build when
 *     Monaco moves the code it removes.
 */

/** The id of Monaco's folding contribution: its controller, and its part of `saveViewState()`. */
export const FOLDING = 'editor.contrib.folding'

/** The part of the folding model's regions the app uses. */
export interface FoldRegionsLike {
  length: number
  getStartLineNumber(index: number): number
  getEndLineNumber(index: number): number
  isCollapsed(index: number): boolean
  toRegion(index: number): unknown
}

/** The part of Monaco's folding model the app uses. */
export interface FoldingModelLike {
  regions: FoldRegionsLike
  toggleCollapseState(regions: unknown[]): void
}

/** The folding model of `editor`, once Monaco has its regions; null when there is none (a file too big to fold). */
export function foldingModelOf(editor: { getContribution(id: string): unknown }): Promise<FoldingModelLike | null> | null {
  const controller = editor.getContribution(FOLDING) as { getFoldingModel?: () => Promise<FoldingModelLike | null> | null } | null
  return controller?.getFoldingModel?.() ?? null
}

const DOCUMENT_SYMBOLS = '_executeDocumentSymbolProvider'

/**
 * Every document symbol provider's answer for `uri`, merged as VS Code's Outline merges them, through the
 * editor's own command service (a private field, `_commandService`). A deep import of Monaco's services was
 * the other way, and it would make Vite's dev server bundle Monaco twice. Null when the service is missing or
 * the provider fails.
 */
export async function documentSymbolsOf(editor: object, uri: unknown): Promise<unknown[] | null> {
  const commands = (editor as { _commandService?: { executeCommand?(id: string, ...args: unknown[]): Promise<unknown> } })._commandService
  if (typeof commands?.executeCommand !== 'function') return null
  try {
    const symbols = await commands.executeCommand(DOCUMENT_SYMBOLS, uri)
    return Array.isArray(symbols) ? symbols : null
  } catch {
    // A provider that failed, a model gone under the request: no answer this time.
    return null
  }
}
