import type { IpcMainInvokeEvent } from 'electron'
import { CONTRACT } from '@shared/ipc'
import type { LspOpenRequest, LspPosition, LspPositionRequest } from '@shared/lsp'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { requireRequest } from '../fs/validate'
import { LspPool } from '../lsp/pool'
import { pythonSpec } from '../lsp/python'
import { typescriptSpec, type LspPlaces } from '../lsp/typescript'
import { handleWithEvent } from './envelope'

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

function requireOpen(raw: unknown): LspOpenRequest {
  const req = requireRequest(raw)
  if (typeof req.text !== 'string') throw new BridgeFailure('BAD_REQUEST', "'text' must be a string")
  return { root: requireAbsPath(req.root, 'root'), path: requireAbsPath(req.path, 'path'), text: req.text }
}

function requirePositionRequest(raw: unknown): LspPositionRequest {
  const req = requireRequest(raw)
  return { handle: requireHandle(req.handle), position: requirePosition(req.position) }
}

/**
 * The `lsp.*` half of `window.yaseenDocs` (YAZ-3454 4B, YAZ-3455 4C): the code tabs and the pool of
 * helpers. The owner of a handle is the window that opened it; a window that closes, crashes or
 * reloads closes its handles, so no helper stays up for a tab that is gone.
 */
export function registerLspIpc(places: LspPlaces): LspPool {
  const pool = new LspPool([typescriptSpec(places), pythonSpec(places)])
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
  handleWithEvent(CONTRACT.lsp.open, async (e, req: unknown) => pool.open(ownerOf(e), requireOpen(req)))
  handleWithEvent(CONTRACT.lsp.change, async (e, handle: unknown, text: unknown) => {
    if (typeof text !== 'string') throw new BridgeFailure('BAD_REQUEST', "'text' must be a string")
    pool.change(ownerOf(e), requireHandle(handle), text)
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
  return pool
}
