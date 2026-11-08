import type { Store } from './store'
import { saveDrawing } from './fs/drawing'
import { indexBoard } from './vaultIndex'

/** A successful UI or CLI save enters the same Recents log. Failed writes never reach this step. */
export function recordSaved(store: Pick<Store, 'addEdit'>, roots: readonly string[], path: string): void {
  store.addEdit(roots, path)
}

/** A newly assigned board ID must be available to the next link lookup, from either save entry point. */
export async function saveDrawingIndexed(req: unknown, approved: readonly string[]) {
  const saved = await saveDrawing(req, approved)
  if (saved.id !== undefined) indexBoard(saved.path, saved.id)
  return saved
}

export type SavedCallback = (roots: readonly string[], path: string) => Promise<void>
