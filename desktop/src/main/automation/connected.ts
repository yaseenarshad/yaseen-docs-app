import { AUTOMATION_LIMITS, AutomationFailure, pageOf } from '@shared/automation'
import { rootOfPath, type AppState } from '@shared/types'
import { isDrawing, isDiagram } from '@shared/fileKind'
import { isRecord } from '@shared/guards'
import { parseDataUrl, referencedFileIds } from '@shared/drawingAssets'
import { diagramDocumentError } from '@shared/diagramFile'
import { parseScene } from '../fs/pictureStore'
import { boardHistory, boardVersion, restoreBoardVersion } from '../git/history'
import { decodeViewOnlyText } from '../fs/file'
import { createDurable, fsCall } from '../fs/fsUtils'
import { absolute, resolveTarget, scopeRoots } from './resources'
import type { AutomationServices } from './services'
import { refuseLiveEdits, type LiveEdits } from './liveEdits'

export async function connectedCommand(services: AutomationServices, state: AppState, command: string, args: Record<string, unknown>, body: Buffer, liveEdits?: LiveEdits): Promise<unknown> {
  if (command === 'provider.status') return { provider: 'pixabay', configured: await services.credentials.hasPixabay() }
  if (command === 'provider.clear') { await services.credentials.setPixabay(null); return { provider: 'pixabay', configured: false, diskSaved: true } }
  if (command === 'provider.set' || command === 'share.accounts' || command === 'share.setup') {
    if (body.length > AUTOMATION_LIMITS.controlBytes) throw new AutomationFailure('TOO_LARGE', 'Secret input exceeds 64 KiB.')
    const token = decodeViewOnlyText(body, 'secret').trim()
    if (!token || /[\r\n\0]/.test(token)) throw new AutomationFailure('INVALID_INPUT', 'Supply one non-empty credential through protected input.')
    // Errors can come from a remote provider. Never echo its response or the supplied secret.
    try {
      if (command === 'provider.set') { await services.credentials.setPixabay(token); return { provider: 'pixabay', configured: true, diskSaved: true } }
      if (command === 'share.accounts') return pageOf(await services.sharing.accounts(token), args)
      return await services.sharing.setup(token, () => {}, args.accountId as string | undefined)
    } catch { throw new AutomationFailure('PROVIDER_FAILED', 'The credential operation failed. Check provider access and app settings; no credential was returned.') }
  }
  if (command === 'share.status') return services.sharing.status()
  if (command === 'share.setDomain') return services.sharing.setDomain(args.hostname as string | null)
  if (command === 'share.disconnect') {
    if (args.root !== null) await scopeRoots(state, { root: args.root as string })
    return services.sharing.disconnect(args.root as string | null, args.deleteEverything as boolean)
  }
  const { roots } = await scopeRoots(state, args)
  if (roots.length !== 1) throw new AutomationFailure('INVALID_INPUT', 'This command needs one explicit vault.')
  const root = roots[0]
  if (command === 'sync.status') return services.sync.status(root)
  if (command === 'sync.now') return services.sync.syncNow(root)
  if (command === 'sync.setEnabled') return services.sync.setEnabled(root, args.enabled as boolean)
  if (command === 'share.list' || command === 'share.check') return pageOf(await services.sharing.list(root, { check: command === 'share.check' }), args)
  const savedSharePath = ['share.get', 'share.stop', 'share.setPermission'].includes(command) && args.path !== undefined
  if (savedSharePath && (args.id !== undefined || args.name !== undefined)) throw new AutomationFailure('INVALID_INPUT', 'Choose exactly one path, id, or name target.')
  const path = savedSharePath ? absolute(args.path as string) : await resolveTarget(roots, args)
  if (rootOfPath(roots, path) === null || path === root) throw new AutomationFailure('OUTSIDE_SCOPE', 'Choose a board inside the vault.')
  if (command.startsWith('share.') && !isDrawing(path) && !isDiagram(path)) throw new AutomationFailure('UNSUPPORTED_EXTENSION', 'Sharing requires an Excalidraw drawing or draw.io diagram.')
  if (command === 'history.list') return { path, ...pageOf(await boardHistory(root, path), args) }
  if (command === 'history.restore') {
    await refuseLiveEdits(liveEdits, path)
    await restoreBoardVersion(root, path, args.ref, args.revision as string)
    return { path, diskSaved: true, rendererMerged: false }
  }
  if (command === 'history.read' || command === 'history.export') {
    const value = await boardVersion(root, path, args.ref)
    if (command === 'history.export') {
      const content = JSON.stringify(value)
      const outputFile = absolute(args.outputFile as string)
      await fsCall(outputFile, () => createDurable(outputFile, content))
      return { path, outputFile, size: Buffer.byteLength(content), diskSaved: true }
    }
    return { path, ref: args.ref, ...value }
  }
  if (command === 'share.get') return { path, share: await services.sharing.get(root, path) }
  if (command === 'share.publish') {
    const content = decodeViewOnlyText(body, path)
    if (isDiagram(path)) {
      const error = diagramDocumentError(content)
      if (error !== null) throw new AutomationFailure('INVALID_INPUT', error)
    } else {
      const { scene, elements } = parseScene(content, path, 'BAD_REQUEST')
      for (const id of referencedFileIds(elements)) {
        const file = isRecord(scene.files) ? scene.files[id] : undefined
        if (!isRecord(file) || typeof file.dataURL !== 'string' || parseDataUrl(file.dataURL) === null) throw new AutomationFailure('INCOMPLETE_CONTENT', 'A standalone drawing must include every live image’s embedded bytes.', { fileId: id })
      }
    }
    return services.sharing.publish(root, path, content, args.shareId as string | undefined)
  }
  if (command === 'share.setPermission') return services.sharing.setPermission(root, path, args.allowDownload as boolean)
  if (command === 'share.stop') {
    if (!await services.sharing.stop(root, path)) throw new AutomationFailure('NOT_FOUND', 'This board is not shared.', { path })
    return { path, stopped: true }
  }
  throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown connected command.')
}
