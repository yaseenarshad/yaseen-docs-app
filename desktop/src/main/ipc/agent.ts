import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { agentPrompt } from '@shared/agentInstructions'
import { CONTRACT } from '@shared/ipc'
import { isFolderSettingsPath } from '@shared/types'
import { fsCall, requireAbsPath, requireMarkdownFile } from '../fs/fsUtils'
import { requireRequest } from '../fs/validate'
import { handle } from './envelope'

/** What main knows and the renderer does not: where the `yaseendocs` command lives on this machine. */
export interface AgentHost {
  packaged: boolean
  /** `process.resourcesPath` — the bundle's `Contents/Resources`, where `bin/yaseendocs` is (YAZ-1621). */
  resourcesPath: string
  /** The main bundle's directory (`out/main`), where `cli.js` sits in dev. */
  mainDir: string
}

/** The command as an agent must type it: the shim in the bundle, or `node` on the built entry in dev. */
export function agentCommand({ packaged, resourcesPath, mainDir }: AgentHost): string {
  return packaged ? `"${join(resourcesPath, 'bin', 'yaseendocs')}"` : `node "${join(mainDir, 'cli.js')}"`
}

/**
 * Copy for Agent (YAZ-1617): the renderer asks for the handshake text for one page and writes the
 * clipboard itself, the way Copy path does. Read-only and enveloped like `reveal`: a page that is
 * no longer there rejects NOT_FOUND so the row can show a passive notice; a non-Markdown file is
 * not a page and rejects UNSUPPORTED_EXTENSION (the write guard's own code). A folder's settings
 * file may not exist yet (an un-adopted vault, YAZ-2290 D1), so there the FOLDER is what must exist.
 */
export function registerAgentIpc(host: AgentHost): void {
  handle(CONTRACT.shell.agentPrompt, async (req: unknown) => {
    const p = requireAbsPath(requireRequest(req).path, 'path')
    requireMarkdownFile(p)
    return fsCall(p, async () => {
      await stat(isFolderSettingsPath(p) ? dirname(p) : p)
      return agentPrompt(agentCommand(host), p)
    })
  })
}
