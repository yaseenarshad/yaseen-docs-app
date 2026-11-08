import { AUTOMATION_LIMITS, AutomationFailure } from '@shared/automation'
import { rootOfPath, type AppState } from '@shared/types'
import { boardHistory, boardVersion, restoreBoardVersion } from '../git/history'
import { decodeViewOnlyText } from '../fs/file'
import { createDurable, fsCall } from '../fs/fsUtils'
import { absolute, resolveTarget, scopeRoots } from './resources'
import type { AutomationServices } from './services'

const page = <T>(items: T[], args: Record<string, unknown>) => {
  const offset = args.offset as number ?? 0, limit = args.limit as number ?? 50
  return { items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null }
}
export async function connectedCommand(services: AutomationServices, state: AppState, command: string, args: Record<string, unknown>, body: Buffer): Promise<unknown> {
  if (command === 'provider.status') return { provider: 'pixabay', configured: await services.credentials.hasPixabay() }
  if (command === 'provider.clear') { await services.credentials.setPixabay(null); return { provider: 'pixabay', configured: false, diskSaved: true } }
  if (command === 'provider.set' || command === 'share.accounts' || command === 'share.setup') {
    if (body.length > AUTOMATION_LIMITS.controlBytes) throw new AutomationFailure('TOO_LARGE', 'Secret input exceeds 64 KiB.')
    const token = decodeViewOnlyText(body, 'secret').trim()
    if (!token || /[\r\n\0]/.test(token)) throw new AutomationFailure('INVALID_INPUT', 'Supply one non-empty credential through protected input.')
    // Errors can come from a remote provider. Never echo its response or the supplied secret.
    try {
      if (command === 'provider.set') { await services.credentials.setPixabay(token); return { provider: 'pixabay', configured: true, diskSaved: true } }
      if (command === 'share.accounts') return page(await services.sharing.accounts(token), args)
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
  if (command === 'share.list' || command === 'share.check') return page(await services.sharing.list(root, { check: command === 'share.check' }), args)
  const path = await resolveTarget(roots, args)
  if (rootOfPath(roots, path) === null) throw new AutomationFailure('INVALID_INPUT', 'Choose a board inside the vault.')
  if (command === 'history.list') return { path, ...page(await boardHistory(root, path), args) }
  if (command === 'history.restore') {
    await restoreBoardVersion(root, path, args.ref, args.revision as string)
    return { path, diskSaved: true, rendererMerged: false }
  }
  if (command === 'history.read' || command === 'history.export') {
    const value = await boardVersion(root, path, args.ref)
    const content = JSON.stringify(value)
    if (command === 'history.export') {
      const outputFile = absolute(args.outputFile as string)
      await fsCall(outputFile, () => createDurable(outputFile, content))
      return { path, outputFile, size: Buffer.byteLength(content), diskSaved: true }
    }
    if (Buffer.byteLength(content) > AUTOMATION_LIMITS.contentBytes - 4096) throw new AutomationFailure('TOO_LARGE', 'Use history export for this large version.')
    return { path, ref: args.ref, ...value }
  }
  if (command === 'share.get') return { path, share: await services.sharing.get(root, path) }
  if (command === 'share.publish') return services.sharing.publish(root, path, decodeViewOnlyText(body, path), args.shareId as string | undefined)
  if (command === 'share.setPermission') return services.sharing.setPermission(root, path, args.allowDownload as boolean)
  if (command === 'share.stop') { await services.sharing.stop(root, path); return { path, stopped: true } }
  throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown connected command.')
}
