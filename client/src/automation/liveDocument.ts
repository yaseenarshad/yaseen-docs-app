import type { EditorAction, EditorOperation } from '@shared/automationEditor'
import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'

export interface LiveDocument {
  path: string
  kind: 'markdown' | 'text' | 'drawing' | 'diagram'
  content: string
  baselineMtime: number
  dirty: boolean
  selection?: { anchor: number; head: number; text: string; coordinate: 'prosemirror' | 'utf16' }
}
interface EditorControl { version(): string | number; run(action: EditorAction): void | Promise<void>; actions: EditorAction['action'][] }
interface Registration { id: number; read(): LiveDocument; control?: EditorControl }
const readers = new WeakMap<Element, Registration>()
let nextId = 0
/** Immutable editor-state identities do not add a subscription or retain old documents. */
const identities = new WeakMap<object, number>()
export function editorStateVersion(state: object): number {
  let id = identities.get(state)
  if (id === undefined) { id = ++nextId; identities.set(state, id) }
  return id
}
const revision = (entry: Registration) => `${entry.id}:${entry.control?.version() ?? 'read-only'}`
/** Read only when requested. Registration adds no typing or selection subscriptions. */
export function registerLiveDocument(host: Element, read: () => LiveDocument, control?: EditorControl): () => void {
  const entry = { id: ++nextId, read, control }
  readers.set(host, entry)
  return () => { if (readers.get(host) === entry) readers.delete(host) }
}
function registration(tab: string): Registration {
  const layer = document.querySelector(`.tabstack__layer[data-tab="${CSS.escape(tab)}"]`)
  const host = layer?.querySelector('.editor-host, .code-editor, .drawing-editor, .drawio-editor')
  const entry = host ? readers.get(host) : undefined
  if (!entry) throw new AutomationFailure('LIVE_DOCUMENT_UNAVAILABLE', 'This tab has no ready live document. A sleeping or loading editor is not read from disk as a substitute.')
  return entry
}
export function readLiveDocument(tab: string): LiveDocument & { source: 'live'; tab: string; revision: string; actions: EditorAction['action'][] } {
  const entry = registration(tab), value = entry.read()
  // Keep the renderer reply below the same bound as the local connection.
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > AUTOMATION_LIMITS.contentBytes - 4096) throw new AutomationFailure('TOO_LARGE', 'This live document exceeds the connection limit. Use a saved board export for large content.')
  return { ...value, source: 'live', tab, revision: revision(entry), actions: entry.control?.actions ?? [] }
}

export async function runEditorAction(target: EditorOperation) {
  const entry = registration(target.tab), control = entry.control
  if (!control || !control.actions.includes(target.edit.action)) throw new AutomationFailure('UNSUPPORTED_ACTION', 'This editor does not support that action. Read its available actions first.')
  if (revision(entry) !== target.revision) throw new AutomationFailure('CONFLICT', 'The editor or selection changed. Read the live document again.')
  // No await between the revision check and the synchronous edit transaction.
  await control.run(target.edit)
  const { content: _content, ...state } = readLiveDocument(target.tab)
  if (target.edit.action === 'save' && state.dirty) throw new AutomationFailure('SAVE_INCOMPLETE', 'The editor remains unsaved. Inspect its conflict or save error before retrying.', state)
  return { ...state, rendererApplied: true, diskSaved: target.edit.action === 'save' && !state.dirty }
}
