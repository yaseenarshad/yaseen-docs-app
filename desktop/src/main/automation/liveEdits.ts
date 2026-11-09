import { AutomationFailure } from '@shared/automation'
import type { NavigationHost } from './navigation'

/** One live window's unsaved editor of a path (YAZ-4515), with that path's tabs there. */
export interface LiveEdit { window: string; path: string; tabs: string[] }
/** The unsaved editors of a file, or of every file under a folder. */
export type LiveEdits = (path: string) => Promise<LiveEdit[]>

export const liveEditsOf = (host: NavigationHost): LiveEdits => async path => {
  const answers = await Promise.all(host.windows().map(async ({ id }) => ({ window: id, ...await host.inspect(id, { kind: 'dirty', path }) as { open: { path: string; tabs: string[] }[] } })))
  return answers.flatMap(({ window, open }) => open.map(entry => ({ window, ...entry })))
}

/** A dirty editor would later meet this write as an outside change; refuse it now and name where the edits are. */
export async function refuseLiveEdits(liveEdits: LiveEdits | undefined, path: string): Promise<void> {
  const open = await liveEdits?.(path) ?? []
  if (open.length) throw new AutomationFailure('UNSAVED_LIVE_EDITS', 'An open editor holds unsaved edits of this file. Save it (editor.save) or let it autosave, then read the file again.', { path, open })
}
