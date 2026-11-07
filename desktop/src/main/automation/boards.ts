import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'
import { serializeBoard, withPicturesOut } from '@shared/drawingAssets'
import { rootOfPath, type AppState, type BoardKind } from '@shared/types'
import { loadDrawing, saveDrawing } from '../fs/drawing'
import { loadDiagram, saveDiagram } from '../fs/diagram'
import { readBoundedRegularFile } from '../fs/boundedRead'
import { BOARDS } from '../fs/boardDocument'
import { createDurable, fsCall } from '../fs/fsUtils'
import { decodeViewOnlyText } from '../fs/file'
import { absolute, resolveTarget, scopeRoots } from './resources'

export async function boardCommand(state: AppState, command: string, args: Record<string, unknown>, body: Buffer) {
  const [resource, action] = command.split('.')
  const kind = resource as BoardKind
  const { roots } = await scopeRoots(state, args)
  const path = await resolveTarget(roots, args), root = rootOfPath(roots, path)!
  if (action === 'save') {
    if (args.sourceFile !== undefined && body.length) throw new AutomationFailure('INVALID_INPUT', 'Choose a source file or a body, not both.')
    const content = args.sourceFile === undefined ? body : (await readBoundedRegularFile(absolute(args.sourceFile as string), BOARDS[kind].max, BOARDS[kind].tooLarge)).data
    if (!content.length) throw new AutomationFailure('INVALID_INPUT', 'Supply board content through --body or --source-file.')
    const text = decodeViewOnlyText(content, path)
    const expectedRevision = args.revision as string
    const result = kind === 'drawing'
      ? await saveDrawing({ root, path, json: text, newFiles: [], expectedRevision }, state.approvedPictureFolders)
      : await saveDiagram({ root, path, xml: text, expectedRevision })
    return { ...result, diskSaved: true, rendererMerged: false }
  }
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
