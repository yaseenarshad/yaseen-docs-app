import { isMarkdown } from '@shared/fileKind'
import { folderSettingsPath, isFolderSettingsPath } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { basename, dirname } from './paths'

/**
 * The page an agent is handed for a tab or a row; null when it is no page. A FOLDER's page is its
 * settings file (YAZ-2290 D9) — its comments and properties live there — whatever the folder is
 * named; a file is a page only when it is Markdown (YAZ-1617).
 */
export const agentPage = (path: string, folder: boolean): string | null => (folder ? folderSettingsPath(path) : isMarkdown(path) ? path : null)

/**
 * Copy for Agent (YAZ-1617 🔒 D2): main composes the handshake for `path` (it knows where the
 * `yaseendocs` command lives), the renderer writes the clipboard exactly as Copy path does, and
 * the panel's passive notice reports either way. One helper, so the sidebar row and the tab
 * cannot spell the gesture two ways.
 */
export async function copyForAgent(path: string, notice?: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(await api.shell.agentPrompt({ path }))
    notice?.('Copied for agent')
  } catch (err) {
    // A folder's page is its hidden settings file: what is no longer there is the FOLDER.
    const gone = isFolderSettingsPath(path) ? dirname(path) : path
    notice?.(
      err instanceof BridgeRequestError && err.code === 'NOT_FOUND'
        ? `Can't copy "${basename(gone)}" for an agent — it is no longer there`
        : `Can't copy for agent: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
