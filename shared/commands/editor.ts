import { DRAWING_ACTIONS, DRAWING_VIEW_ACTIONS, type DrawingAction } from '../automationEditor'
import { array, boolean, number, object, oneOf, string, type CommandDefinition, type CommandSchema } from './schema'

const editorTarget = { window: string(), tab: string(), revision: string('Tab-local revision from document.live. Includes the selection state.') }
export const liveState = {
  path: string(), tab: string(), source: oneOf('live'), kind: oneOf('markdown', 'text', 'drawing', 'diagram'), revision: string(),
  actions: array(string('An action this tab offers now. Read only drawings offer only view actions; Read only Markdown and code tabs offer only select and save.')), baselineMtime: number, dirty: boolean,
  conflict: { ...boolean, description: 'The conflict bar shows: the file changed on disk under unsaved edits. A person chooses Reload or Keep mine; editor.save stays incomplete until then.' },
  selection: object({ anchor: { type: 'integer' }, head: { type: 'integer' }, text: { type: 'string', maxLength: 10 * 1024 * 1024 }, coordinate: oneOf('prosemirror', 'utf16') }),
}
const editorResult = object({ ...liveState, rendererApplied: boolean, diskSaved: boolean },
    ['path', 'tab', 'source', 'kind', 'revision', 'actions', 'baselineMtime', 'dirty', 'rendererApplied', 'diskSaved'])
const editorCommand = (name: string, description: string, requires: string[], fields: Record<string, CommandSchema> = {}, extra: Partial<CommandDefinition> = {}): CommandDefinition =>
  ({ name: `editor.${name}`, description, effect: 'write', input: object({ ...editorTarget, ...fields }, ['window', 'tab', 'revision', ...Object.keys(fields)]), output: editorResult, requires, ...extra })

const drawingActionText: Record<DrawingAction, string> = {
  selectAll: 'Select every element', deleteSelection: 'Delete the selection', duplicate: 'Duplicate the selection', group: 'Group the selection', ungroup: 'Ungroup the selection',
  bringForward: 'Bring the selection forward', sendBackward: 'Send the selection backward', bringToFront: 'Bring the selection to the front', sendToBack: 'Send the selection to the back',
  alignTop: 'Align the selection to the top', alignBottom: 'Align the selection to the bottom', alignLeft: 'Align the selection to the left', alignRight: 'Align the selection to the right',
  alignVerticallyCentered: 'Center the selection vertically', alignHorizontallyCentered: 'Center the selection horizontally',
  distributeHorizontally: 'Distribute the selection horizontally', distributeVertically: 'Distribute the selection vertically',
  flipHorizontal: 'Flip the selection horizontally', flipVertical: 'Flip the selection vertically', toggleLock: 'Lock or unlock the selection',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', resetZoom: 'Zoom to 100%', zoomToFit: 'Zoom to fit everything', zoomToFitSelection: 'Zoom to fit the selection',
}
/** A view action (selection, zoom) adds no Undo step and also runs on a Read only drawing; an edit is one Undo step of the drawing. */
const drawingActionCommands: CommandDefinition[] = (Object.keys(DRAWING_ACTIONS) as DrawingAction[]).map(action => editorCommand(action,
  `${drawingActionText[action]} on a live drawing tab, as the app’s own action does. ${DRAWING_VIEW_ACTIONS.includes(action) ? 'It adds no Undo step and also runs on a Read only drawing.' : 'It is one Undo step of the drawing. Not on a Read only drawing.'} Refused when the action does not apply to the current selection.`,
  ['explicit ready drawing tab', 'current live revision', 'action listed in document.live actions']))

export const editorCommands: CommandDefinition[] = [
  { name: 'document.live', description: 'Read an open tab’s editor buffer, unsaved edits included, with its selection and live revision. Never falls back to the saved file.', effect: 'read',
      input: object({ window: string(), tab: string() }, ['window', 'tab']),
      output: object({ ...liveState, content: { type: 'string', maxLength: 64 * 1024 * 1024 } }, ['path', 'tab', 'source', 'kind', 'revision', 'actions', 'content', 'baselineMtime', 'dirty']),
      requires: ['explicit live window and ready tab'] },
  ...drawingActionCommands,
  editorCommand('selectElements', 'Select exactly these element IDs on a live drawing tab, in place of a click or lasso. An unknown ID is refused and nothing changes.',
      ['explicit ready drawing tab', 'current live revision'], { ids: { type: 'array', items: string(), maxItems: 10_000 } }),
  editorCommand('select', 'Set the selection of an open tab, in the coordinates document.live returns.', ['explicit ready tab', 'current live revision'],
      { anchor: { type: 'integer', minimum: 0 }, head: { type: 'integer', minimum: 0 } }),
  editorCommand('replace', 'Replace the selection of an open text tab with the body, as one Undo step. Autosave saves it as usual. Not on a Read only tab: write the saved file with file.write.',
      ['explicit ready text tab', 'current live revision'], {}, { content: 'text', contentRequired: true }),
  editorCommand('format', 'Turn one Markdown format (bold, italic, code, strike) on or off for the selection of an open note, as the editor’s own command does. Not on a Read only note.',
      ['explicit ready Markdown tab', 'current live revision'], { format: oneOf('bold', 'italic', 'code', 'strike') }),
  editorCommand('undo', 'Undo the last edit of an open tab, as ⌘Z does there. A drawing uses its own history; a diagram has none.',
      ['explicit ready tab', 'current live revision', 'action listed in document.live actions']),
  editorCommand('redo', 'Redo the last undone edit of an open tab, as ⌘⇧Z does there. A drawing uses its own history; a diagram has none.',
      ['explicit ready tab', 'current live revision', 'action listed in document.live actions']),
  editorCommand('save', 'Save an open tab now. It fails when the tab still has unsaved edits after the save, for example under a conflict bar.',
      ['explicit ready tab', 'current live revision', 'action listed in document.live actions']),
]
