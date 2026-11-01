/**
 * View › Save Heap Snapshot, dev builds only (YAZ-3737 D9): the window's page heap as a `.heapsnapshot` file for
 * DevTools' Memory tab. It attaches `webContents.debugger`, streams `HeapProfiler.addHeapSnapshotChunk` to a
 * `.partial` file, renames it when the snapshot is whole, and detaches in `finally`. A debugger that is already
 * attached (DevTools open, a debug port) wins (S23): nothing is attached, nothing is written.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** The slice of `webContents.debugger` the snapshot uses. */
export interface SnapshotDebugger {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, params?: object): Promise<unknown>
  on(event: 'message', listener: (event: unknown, method: string, params: { chunk?: string }) => void): unknown
  removeListener(event: 'message', listener: (event: unknown, method: string, params: { chunk?: string }) => void): unknown
}

/**
 * The page heap of the window `windowId` into `<dir>/<windowId>-<iso>.heapsnapshot`. Answers the file's path, or
 * `null` when a debugger is already attached (S23). A failure after the attach removes the partial file and throws.
 */
export async function saveHeapSnapshot(dbg: SnapshotDebugger, dir: string, windowId: string, at: Date): Promise<string | null> {
  if (dbg.isAttached()) return null
  try {
    dbg.attach('1.3')
  } catch {
    return null
  }
  const file = join(dir, `${windowId}-${at.toISOString().replace(/:/g, '-')}.heapsnapshot`)
  const partial = `${file}.partial`
  let out: ReturnType<typeof createWriteStream> | undefined
  try {
    await mkdir(dir, { recursive: true })
    const stream = (out = createWriteStream(partial))
    const failed = new Promise<never>((_, reject) => stream.once('error', reject))
    failed.catch(() => undefined) // raced below; an error after the last race has nobody to hear it
    const onMessage = (_e: unknown, method: string, params: { chunk?: string }) => {
      if (method === 'HeapProfiler.addHeapSnapshotChunk' && typeof params.chunk === 'string') stream.write(params.chunk)
    }
    dbg.on('message', onMessage)
    try {
      await dbg.sendCommand('HeapProfiler.enable')
      // Every chunk arrives before the command answers.
      await Promise.race([dbg.sendCommand('HeapProfiler.takeHeapSnapshot', { reportProgress: false }), failed])
    } finally {
      dbg.removeListener('message', onMessage)
    }
    await Promise.race([new Promise<void>((done) => stream.end(done)), failed])
    await rename(partial, file)
    return file
  } catch (err) {
    out?.destroy()
    await rm(partial, { force: true })
    throw err
  } finally {
    dbg.detach()
  }
}
