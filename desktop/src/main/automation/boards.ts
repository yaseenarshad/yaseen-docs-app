import { setBoardReadOnly } from '../fs/boardReadOnly'
import { setBoardHoverLinks } from '../fs/boardHoverLinks'
import { setBoardHoverOutline } from '../fs/boardHoverOutline'
import { setBoardFoldArrows } from '../fs/boardFoldArrows'
import { setBoardPictures } from '../fs/boardPictures'
import { createBoard } from '../fs/createBoard'
import { dirname } from 'node:path'
import { stat } from 'node:fs/promises'
import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'
import { serializeBoard, withPicturesOut } from '@shared/drawingAssets'
import { rootOfPath, type AppState, type BoardKind } from '@shared/types'
import { loadDrawing } from '../fs/drawing'
import { saveDrawingIndexed, type SavedCallback } from '../documentSaves'
import { loadDiagram, saveDiagram } from '../fs/diagram'
import { readBoundedRegularFile } from '../fs/boundedRead'
import { BOARDS } from '../fs/boardDocument'
import { createDurable, fsCall } from '../fs/fsUtils'
import { decodeViewOnlyText } from '../fs/file'
import { absolute, resolveTarget, scopeRoots } from './resources'
import type { NavigationHost } from './navigation'

/** The live windows whose editors hold unsaved edits of a path, with that path's tabs there (YAZ-4515). */
export type LiveEdits = (path: string) => Promise<{ window: string; tabs: string[] }[]>

export const liveEditsOf = (host: NavigationHost): LiveEdits => async path => {
  const open = await Promise.all(host.windows().map(async ({ id }) => ({ window: id, ...await host.inspect(id, { kind: 'dirty', path }) as { dirty: boolean; tabs: string[] } })))
  return open.filter(entry => entry.dirty).map(({ window, tabs }) => ({ window, tabs }))
}

/** A dirty editor would later meet this write as an outside change; refuse it now and name where the edits are. */
async function refuseLiveEdits(liveEdits: LiveEdits | undefined, path: string): Promise<void> {
  const open = await liveEdits?.(path) ?? []
  if (open.length) throw new AutomationFailure('UNSAVED_LIVE_EDITS', 'An open editor holds unsaved edits of this board. Save it (editor.save) or let it autosave, then read the board again.', { path, open })
}

export async function boardCommand(state: AppState, command: string, args: Record<string, unknown>, body: Buffer, record?: SavedCallback, liveEdits?: LiveEdits) {
  const [resource, action] = command.split('.')
  const kind = resource as BoardKind
  const { roots } = await scopeRoots(state, args)
  if (action === 'create') {
    const path = absolute(args.path as string)
    await resolveTarget(roots, { path: dirname(path) })
    const root = rootOfPath(roots, path)
    if (!root || !BOARDS[kind].is(path)) throw new AutomationFailure('INVALID_INPUT', 'Choose a new board path of the requested kind inside the vault.')
    return { ...await createBoard({ root, path }, state.settings.newBoardPictures, state.settings.newBoardPicturesFolder), diskSaved: true }
  }
  const path = await resolveTarget(roots, args), root = rootOfPath(roots, path)!
  if (['setReadOnly', 'setHoverLinks', 'setHoverOutline', 'setFoldArrows', 'setPictures'].includes(action)) {
    const expectedRevision = args.revision as string
    const request = { root, path, expectedRevision, expectedMtime: Number(expectedRevision.split(':')[0]), on: args.on, value: args.value, out: args.out, folder: args.folder }
    if (!BOARDS[kind].is(path)) throw new AutomationFailure('INVALID_INPUT', 'The target is not the requested board kind.')
    await refuseLiveEdits(liveEdits, path)
    const result = action === 'setReadOnly' ? await setBoardReadOnly(request)
      : action === 'setHoverLinks' ? await setBoardHoverLinks(request)
      : action === 'setHoverOutline' ? await setBoardHoverOutline(request)
      : action === 'setFoldArrows' ? await setBoardFoldArrows(request)
      : await setBoardPictures(request, state.approvedPictureFolders)
    return { ...result, diskSaved: true, rendererMerged: false }
  }
  if (action === 'save') {
    if (args.sourceFile !== undefined && body.length) throw new AutomationFailure('INVALID_INPUT', 'Choose a source file or a body, not both.')
    const content = args.sourceFile === undefined ? body : (await readBoundedRegularFile(absolute(args.sourceFile as string), BOARDS[kind].max, BOARDS[kind].tooLarge)).data
    if (!content.length) throw new AutomationFailure('INVALID_INPUT', 'Supply board content through --body or --source-file.')
    const text = decodeViewOnlyText(content, path)
    await refuseLiveEdits(liveEdits, path)
    const expectedRevision = args.revision as string
    const result = kind === 'drawing'
      ? await saveDrawingIndexed({ root, path, json: text, newFiles: [], expectedRevision }, state.approvedPictureFolders)
      : await saveDiagram({ root, path, xml: text, expectedRevision })
    await record?.(roots, result.path)
    return { ...result, diskSaved: true, rendererMerged: false }
  }
  // A read answers on the bounded connection: refuse a larger file before it is loaded (the format allows 200 MiB).
  if (action === 'read' && (await fsCall(path, () => stat(path))).size > AUTOMATION_LIMITS.contentBytes - 4096) throw new AutomationFailure('TOO_LARGE', `Use ${kind} export --output-file for this large document.`)
  const loaded = kind === 'drawing' ? await loadDrawing({ root, path, includeRevision: true }) : await loadDiagram({ root, path, includeRevision: true })
  if (action === 'export') {
    const outputFile = absolute(args.outputFile as string)
    const text = 'xml' in loaded ? loaded.xml : serializeBoard(withPicturesOut({ ...JSON.parse(loaded.json), files: loaded.files }, false, loaded.mtime, loaded.mtime))
    if (Buffer.byteLength(text) > BOARDS[kind].max) throw new AutomationFailure('TOO_LARGE', BOARDS[kind].tooLarge)
    await fsCall(outputFile, () => createDurable(outputFile, text))
    return { path, outputFile, revision: loaded.revision, size: Buffer.byteLength(text), source: 'disk', diskSaved: true }
  }
  // Payloads over the bounded socket response use the explicit export command.
  if (Buffer.byteLength(JSON.stringify(loaded)) > AUTOMATION_LIMITS.contentBytes - 4096) throw new AutomationFailure('TOO_LARGE', `Use ${kind} export --output-file for this large document.`)
  return { ...loaded, source: 'disk' }
}
