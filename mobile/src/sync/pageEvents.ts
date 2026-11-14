import type { SyncEngine } from './engine'

/**
 * Wires the engine to the page (4A calls it once at start): hidden → no polling (R9); visible again → one pass at once
 * (R10); the connection back → one pass at once (N2). Returns the undo.
 */
export function followPage(engine: SyncEngine, doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document, win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onVisibility = () => engine.setVisible(doc.visibilityState === 'visible')
  const onOnline = () => engine.online()
  engine.setVisible(doc.visibilityState === 'visible')
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('online', onOnline)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('online', onOnline)
  }
}
