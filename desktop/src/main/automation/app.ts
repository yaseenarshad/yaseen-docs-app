import { AutomationFailure } from '@shared/automation'
import type { Updater } from '../updater'
import { RELEASES_PAGE } from '../updater'

export interface AutomationApp {
  updater: Pick<Updater, 'state' | 'notes' | 'check' | 'checks'>
  diagnostics(): Promise<unknown>
  restart(mode: 'app' | 'update'): void
}
/** Return the accepted receipt before quit starts draining the request queue that holds this call. */
export async function appCommand(host: AutomationApp, command: string): Promise<unknown> {
  if (command === 'app.diagnostics') return host.diagnostics()
  if (command === 'update.state') return host.updater.state()
  if (command === 'update.notes') return host.updater.notes()
  if (command === 'update.check') return host.updater.checks ? host.updater.check() : host.updater.state()
  if (command === 'app.restart' || command === 'update.restart') {
    if (command === 'update.restart') {
      const state = host.updater.state()
      if (state.kind === 'manual') return { accepted: false, manual: true, url: RELEASES_PAGE }
      if (state.kind !== 'ready') throw new AutomationFailure('UPDATE_NOT_READY', 'No staged update is ready to install.')
    }
    setTimeout(() => host.restart(command === 'app.restart' ? 'app' : 'update'), 100).unref()
    return { accepted: true, outcome: 'restart-requested', receiptsExpireOnRestart: true }
  }
  throw new AutomationFailure('UNKNOWN_COMMAND', 'Unknown app command.')
}
