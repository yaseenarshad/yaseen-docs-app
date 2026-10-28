/**
 * MONACO'S TYPESCRIPT WORKER, PLUS THE OUTLINE (YAZ-3501). This is Monaco's own worker (every method,
 * the same TypeScript), started from this entry so it can answer one more question: `getOutlineTree`,
 * the code Outline's tree of a file, made here and packed in one buffer (`outline/navigationOutline.ts`,
 * `outline/outlinePack.ts`). The page then does almost no work for it, however many symbols the file has.
 *
 * Monaco's `ts.worker` module sets `self.onmessage` when it loads; this entry sets it again, the same
 * way, with this class in place of Monaco's. `monaco.ts` starts this worker for TS and JS; the build drops
 * Monaco's own (unused) TS worker file (`electron.vite.config.ts`, `dropMonacoTsWorkerUrl`).
 */
import { initialize, TypeScriptWorker } from 'monaco-editor/languages/features/typescript/ts.worker'
import { outlineOfNavigation, type NavigationItem } from './outline/navigationOutline'
import { packTree } from './outline/outlinePack'

/** The parts of Monaco's worker this class uses (they are not in Monaco's types). */
interface MonacoWorkerParts {
  _getModel(fileName: string): { positionAt(offset: number): { lineNumber: number; column: number } } | null
  getLanguageService(): { getNavigationTree(fileName: string): NavigationItem }
}

class AppTypeScriptWorker extends TypeScriptWorker {
  /**
   * The Outline's tree of `fileName`, packed; null when the worker has no such model. Names inside
   * functions are left out unless `showLocals` ("…" › Show › "Variables inside functions", YAZ-3507).
   */
  async getOutlineTree(fileName: string, showLocals = false): Promise<ArrayBuffer | null> {
    const worker = this as unknown as MonacoWorkerParts
    const model = worker._getModel(fileName)
    if (model === null) return null
    const root = worker.getLanguageService().getNavigationTree(fileName)
    return packTree(outlineOfNavigation(root, (offset) => model.positionAt(offset), showLocals === true))
  }
}

self.onmessage = () => {
  initialize((ctx, createData) => new AppTypeScriptWorker(ctx, createData))
}
