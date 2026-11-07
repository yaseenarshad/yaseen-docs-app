import { AutomationFailure } from '@shared/automation'

export interface LiveDocument {
  path: string
  kind: 'markdown' | 'text' | 'drawing' | 'diagram'
  content: string
  baselineMtime: number
  dirty: boolean
  selection?: { anchor: number; head: number; text: string; coordinate: 'prosemirror' | 'utf16' }
}
const readers = new WeakMap<Element, () => LiveDocument>()
/** Read only when requested. Registration adds no typing or selection subscriptions. */
export function registerLiveDocument(host: Element, read: () => LiveDocument): () => void {
  readers.set(host, read)
  return () => { if (readers.get(host) === read) readers.delete(host) }
}
export function readLiveDocument(tab: string): LiveDocument & { source: 'live'; tab: string } {
  const layer = document.querySelector(`[data-tab="${CSS.escape(tab)}"]`)
  const host = layer?.querySelector('.editor-host, .code-editor, .drawing-editor, .drawio-editor')
  const read = host ? readers.get(host) : undefined
  if (!read) throw new AutomationFailure('LIVE_DOCUMENT_UNAVAILABLE', 'This tab has no ready live document. A sleeping or loading editor is not read from disk as a substitute.')
  return { ...read(), source: 'live', tab }
}
