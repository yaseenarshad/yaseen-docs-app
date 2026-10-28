import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { net, type IpcMainInvokeEvent } from 'electron'
import { CONTRACT } from '@shared/ipc'
import type { LspOpenRequest, LspPosition, LspPositionRequest } from '@shared/lsp'
import { MAX_FILE_BYTES } from '@shared/types'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { requireRequest } from '../fs/validate'
import { HelperInstaller, helpersFor, type Fetch } from '../lsp/download'
import { LspPool } from '../lsp/pool'
import { pythonSpec, resolvePyright } from '../lsp/python'
import { resolveTypescriptServer, typescriptSpec, type LspPlaces } from '../lsp/typescript'
import { handle, handleWithEvent } from './envelope'

function requirePosition(raw: unknown): LspPosition {
  const p = raw as Partial<LspPosition> | null
  if (p === null || typeof p !== 'object' || !Number.isInteger(p.line) || !Number.isInteger(p.character) || p.line! < 0 || p.character! < 0) {
    throw new BridgeFailure('BAD_REQUEST', "'position' must be { line, character }, 0-based integers")
  }
  return { line: p.line!, character: p.character! }
}

function requireHandle(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') throw new BridgeFailure('BAD_REQUEST', "'handle' must be a string")
  return raw
}

/** A file's text for a helper: no bigger than a file the code tab can read (`MAX_FILE_BYTES`, as `fs:read`). */
function requireText(raw: unknown): string {
  if (typeof raw !== 'string') throw new BridgeFailure('BAD_REQUEST', "'text' must be a string")
  if (Buffer.byteLength(raw, 'utf8') > MAX_FILE_BYTES) throw new BridgeFailure('BAD_REQUEST', `'text' exceeds ${MAX_FILE_BYTES} bytes`)
  return raw
}

function requireOpen(raw: unknown): LspOpenRequest {
  const req = requireRequest(raw)
  return { root: requireAbsPath(req.root, 'root'), path: requireAbsPath(req.path, 'path'), text: requireText(req.text) }
}

function requirePositionRequest(raw: unknown): LspPositionRequest {
  const req = requireRequest(raw)
  return { handle: requireHandle(req.handle), position: requirePosition(req.position) }
}

/**
 * Settings › Code › "Jump across files" (`codeLanguageHelpers`, YAZ-3500): off, `lsp.open` answers null and no
 * helper starts; turned off, every helper stops. Absent (tests): always on.
 */
export interface HelpersSwitch {
  on(): boolean
  /** Calls `listener` with the switch after each change of the app state; returns the unsubscribe. */
  subscribe(listener: (on: boolean) => void): () => void
}

/** The download of this app (`registerLspIpc`): the quit sequence stops it (`cancelHelperInstall`). */
let installer: HelperInstaller | null = null

/** The quit: stops a download under way and deletes its `.partial-` folder, so no half folder stays (YAZ-3500). At most 3 s. */
export async function cancelHelperInstall(): Promise<void> {
  const current = installer
  if (current === null) return
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([current.cancel(), new Promise((resolve) => (timer = setTimeout(resolve, 3_000)))])
  clearTimeout(timer)
  // Past the 3 s, the folder goes here: nothing half written stays.
  current.sweepAfterQuit()
}

/**
 * The `lsp.*` half of `window.yaseenDocs` (YAZ-3454 4B, YAZ-3455 4C, YAZ-3500): the code tabs and the pool
 * of helpers, and their download. The owner of a handle is the window that opened it; a window that
 * closes, crashes or reloads closes its handles, so no helper stays up for a tab that is gone.
 */
export function registerLspIpc(places: LspPlaces, helpersSwitch?: HelpersSwitch, fetch: Fetch = (url, init) => net.fetch(url, init)): LspPool {
  const pool = new LspPool([typescriptSpec(places), pythonSpec(places)])
  const switchOn = (): boolean => helpersSwitch?.on() ?? true
  let wasOn = switchOn()
  helpersSwitch?.subscribe((on) => {
    // Off with code tabs open (S4): every helper stops now; the tabs keep Monaco's one-file help.
    if (wasOn && !on) void pool.stopAll()
    wasOn = on
  })
  const install = new HelperInstaller({ lspRoot: places.lspRoot, helpers: helpersFor(process.platform, process.arch), fetch })
  installer = install
  // A `.partial-` folder a killed app left (YAZ-3500): gone at the next start.
  install.sweep()
  const ready = (): boolean =>
    resolveTypescriptServer({ ...places, platform: process.platform, arch: process.arch, exists: existsSync }) !== null && resolvePyright({ ...places, exists: existsSync }) !== null

  const watched = new Set<number>()
  const ownerOf = (e: IpcMainInvokeEvent): number => {
    const sender = e.sender
    const id = sender.id
    if (!watched.has(id)) {
      watched.add(id)
      const forget = () => pool.closeOwner(id)
      sender.once('destroyed', () => {
        watched.delete(id)
        forget()
      })
      // A reload (⌘R, a crash, HMR's full reload): the page that opened the handles is gone.
      sender.on('did-start-navigation', (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
        if (details?.isMainFrame && !details.isSameDocument) forget()
      })
      sender.on('render-process-gone', forget)
    }
    return id
  }
  handleWithEvent(CONTRACT.lsp.open, async (e, req: unknown) => {
    const open = requireOpen(req)
    return switchOn() ? pool.open(ownerOf(e), open) : null
  })
  handleWithEvent(CONTRACT.lsp.change, async (e, handle: unknown, text: unknown) => {
    pool.change(ownerOf(e), requireHandle(handle), requireText(text))
  })
  handleWithEvent(CONTRACT.lsp.close, async (e, handle: unknown) => pool.close(ownerOf(e), requireHandle(handle)))
  handleWithEvent(CONTRACT.lsp.definition, async (e, req: unknown) => {
    const { handle, position } = requirePositionRequest(req)
    return pool.definition(ownerOf(e), handle, position)
  })
  handleWithEvent(CONTRACT.lsp.references, async (e, req: unknown) => {
    const { handle, position } = requirePositionRequest(req)
    return pool.references(ownerOf(e), handle, position)
  })
  handleWithEvent(CONTRACT.lsp.hover, async (e, req: unknown) => {
    const { handle, position } = requirePositionRequest(req)
    return pool.hover(ownerOf(e), handle, position)
  })
  handle(CONTRACT.lsp.helpers, async () => ({ ready: ready(), installing: install.installing }))
  handleWithEvent(CONTRACT.lsp.install, async (e) => {
    const sender = e.sender
    return install.install((p) => {
      if (!sender.isDestroyed()) sender.send(CONTRACT.lsp.onInstallProgress.channel, p)
    })
  })
  handle(CONTRACT.lsp.cancelInstall, () => install.cancel())
  return pool
}
