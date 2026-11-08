import { extname } from 'node:path'
import { stat } from 'node:fs/promises'
import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'
import { DRAWING_EXTENSIONS, rootOfPath, type AppState } from '@shared/types'
import { readAssetFile, writeAsset } from '../fs/assets'
import { readImage } from '../fs/image'
import { readPdf } from '../fs/pdf'
import { createDurable, fsCall } from '../fs/fsUtils'
import { revisionOf } from '../fs/revision'
import { decodeViewOnlyText } from '../fs/file'
import { absolute, createdMeanwhile, resolveTarget, scopeRoots } from './resources'
import { refuseLiveEdits, type LiveEdits } from './liveEdits'

/** Binary reads use base64 on the JSON wire; larger viewer files use an explicit exclusive export. */
export async function assetCommand(state: AppState, command: string, args: Record<string, unknown>, body: Buffer, liveEdits?: LiveEdits): Promise<unknown> {
  const { roots } = await scopeRoots(state, args)
  const [kind, action] = command.split('.')
  if (action === 'write') {
    const path = absolute(args.path as string), root = rootOfPath(roots, path)
    if (!root || roots.includes(path)) throw new AutomationFailure('OUTSIDE_SCOPE', 'The asset must be inside the selected vault.')
    // The core writer creates nested asset folders. Validate the root rather than requiring those folders to exist.
    await refuseLiveEdits(liveEdits, path)
    const content = (DRAWING_EXTENSIONS as readonly string[]).includes(extname(path).slice(1).toLowerCase()) ? decodeViewOnlyText(body, path) : body
    const saved = await writeAsset({ root, path, content, ...(args.revision === null ? { create: true } : { expectedRevision: args.revision as string }) }).catch(createdMeanwhile)
    return { ...saved, revision: revisionOf(content, saved.mtime), diskSaved: true, rendererMerged: false }
  }
  const path = await resolveTarget(roots, args)
  if (action === 'read' && (await stat(path)).size > Math.floor((AUTOMATION_LIMITS.contentBytes - 4096) * 3 / 4)) {
    throw new AutomationFailure('TOO_LARGE', `Use ${kind} export with an output file for this large binary document.`)
  }
  const snapshot = kind === 'asset' ? await readAssetFile(path, true) : kind === 'image' ? await readImage(path) : await readPdf(path)
  const bytes = typeof snapshot.data === 'string' ? Buffer.from(snapshot.data, 'base64') : Buffer.from(snapshot.data)
  const revision = revisionOf(bytes, snapshot.mtime)
  if (action === 'export') {
    const outputFile = absolute(args.outputFile as string)
    await fsCall(outputFile, () => createDurable(outputFile, bytes))
    return { path, outputFile, size: bytes.length, revision, source: 'disk', diskSaved: true }
  }
  return { ...snapshot, data: bytes.toString('base64'), encoding: 'base64', revision, source: 'disk' }
}
