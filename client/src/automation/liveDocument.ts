import type { BoardExportOperation, BoardImage, EditorAction, EditorOperation } from '@shared/automationEditor'
import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'
import { dirtyPaths } from '../lib/renameContinuity'

export interface LiveDocument {
  path: string
  kind: 'markdown' | 'text' | 'drawing' | 'diagram'
  content: string
  baselineMtime: number
  dirty: boolean
  /** The conflict bar shows (YAZ-4515): the file changed on disk under unsaved edits, and a person chooses Reload or Keep mine. */
  conflict?: boolean
  selection?: { anchor: number; head: number; text: string; coordinate: 'prosemirror' | 'utf16' }
}
interface EditorControl { version(): string | number; run(action: EditorAction): void | Promise<void>; readonly actions: EditorAction['action'][] }
/** A board's export (YAZ-4515): the bytes its GUI export makes, with no sheet, and the board's path and unsaved state. */
interface BoardExporter { kind: 'drawing' | 'diagram'; run(target: BoardExportOperation): Promise<BoardImage> }
interface Registration { id: number; read(): LiveDocument; control?: EditorControl; exportImage?: BoardExporter }
const readers = new WeakMap<Element, Registration>()
let nextId = 0
/** Immutable editor-state identities do not add a subscription or retain old documents. */
const identities = new WeakMap<object, number>()
export function editorStateVersion(state: object): number {
  let id = identities.get(state)
  if (id === undefined) { id = ++nextId; identities.set(state, id) }
  return id
}
/** A text's identity, hashed only when a revision is read (FNV-1a). */
export function textVersion(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return `${text.length}.${(hash >>> 0).toString(36)}`
}
const revision = (entry: Registration) => `${entry.id}:${entry.control?.version() ?? 'read-only'}`
/** Read only when requested. Registration adds no typing or selection subscriptions. */
export function registerLiveDocument(host: Element, read: () => LiveDocument, control?: EditorControl, exportImage?: BoardExporter): () => void {
  const entry = { id: ++nextId, read, control, exportImage }
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
export function readLiveDocument(tab: string): LiveDocument & { conflict: boolean; source: 'live'; tab: string; revision: string; actions: EditorAction['action'][] } {
  const entry = registration(tab), value = entry.read()
  // Keep the renderer reply below the same bound as the local connection.
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > AUTOMATION_LIMITS.contentBytes - 4096) throw new AutomationFailure('TOO_LARGE', 'This live document exceeds the connection limit. Use a saved board export for large content.')
  return { ...value, conflict: value.conflict === true, source: 'live', tab, revision: revision(entry), actions: entry.control?.actions ?? [] }
}

export async function runEditorAction(target: EditorOperation) {
  const entry = registration(target.tab), control = entry.control
  if (!control || !control.actions.includes(target.edit.action)) throw new AutomationFailure('UNSUPPORTED_ACTION', 'This editor does not support that action. Read its available actions first.')
  if (revision(entry) !== target.revision) throw new AutomationFailure('CONFLICT', 'The editor or selection changed. Read the live document again.')
  // No await between the revision check and the synchronous edit transaction.
  await control.run(target.edit)
  const { content: _content, ...state } = readLiveDocument(target.tab)
  if (target.edit.action === 'save' && state.dirty) throw new AutomationFailure('SAVE_INCOMPLETE', state.conflict ? 'The file changed on disk under unsaved edits (conflict: true). A person chooses Reload or Keep mine in the conflict bar.' : 'The editor remains unsaved. Inspect its save error before retrying.', state)
  return { ...state, rendererApplied: true, diskSaved: target.edit.action === 'save' && !state.dirty }
}

/** A live board's GUI export as bytes (YAZ-4515). Main writes the file; this never opens a sheet or touches the board file. */
export async function exportLiveImage(target: BoardExportOperation): Promise<BoardImage> {
  const exporter = registration(target.tab).exportImage
  if (exporter?.kind !== target.kind) throw new AutomationFailure('UNSUPPORTED_ACTION', `This tab is not a live ${target.kind}.`)
  const image = await exporter.run(target)
  if ((image.format === 'pdf' ? image.svg.length * 2 : image.data.byteLength) > AUTOMATION_LIMITS.contentBytes) throw new AutomationFailure('TOO_LARGE', 'This export exceeds the connection limit. Choose a smaller scale or a selection.')
  return image
}

/** YAZ-4515: the paths at or under `path` whose editors here hold unsaved edits, with their tabs. A CLI board write refuses them; a shrink skips them. */
export function unsavedUnder(path: string, tabs: readonly { id: string; path: string }[]): { path: string; tabs: string[] }[] {
  return dirtyPaths().filter(dirty => dirty === path || dirty.startsWith(`${path}/`)).map(dirty => ({ path: dirty, tabs: tabs.filter(tab => tab.path === dirty).map(tab => tab.id) }))
}
