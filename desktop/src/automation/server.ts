import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, rename, unlink, writeFile } from 'node:fs/promises'
import { connect, createServer, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { AUTOMATION_LIMITS, AUTOMATION_VERSION, AutomationFailure, automationError, type AutomationRequest } from '@shared/automation'
import { commandDefinition, validateInput } from '@shared/automationCommands'
import { descriptorPath, endpointFor, privateDirectory, type Connection } from './connection'
import { RequestQueue, resultBytes, type Operation } from './requests'
import { encodePacket, readPacket } from './wire'

export interface AutomationServer { close(): Promise<void>; connection: Connection }

async function removeStaleSocket(endpoint: string): Promise<void> {
  if (process.platform === 'win32') return
  const info = await lstat(endpoint).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
  if (!info) return
  if (!info.isSocket() || (process.getuid && info.uid !== process.getuid())) throw new AutomationFailure('UNSAFE_PROFILE', 'The CLI socket path is occupied.')
  const live = await new Promise<boolean>((resolve, reject) => {
    const socket = connect(endpoint)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve(false)
      else reject(error)
    })
    socket.setTimeout(1000, () => { socket.destroy(); resolve(true) })
  })
  if (live) throw new AutomationFailure('ALREADY_RUNNING', 'A CLI connection already serves this profile.')
  await unlink(endpoint).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
}

function validate(value: unknown, connection: Connection): AutomationRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new AutomationFailure('BAD_REQUEST', 'Expected a request object.')
  const request = value as AutomationRequest
  const expected = Buffer.from(connection.token)
  const actual = Buffer.from(typeof request.token === 'string' ? request.token : '')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AutomationFailure('UNAUTHORIZED', 'The profile token is invalid.')
  if (request.version !== AUTOMATION_VERSION) throw new AutomationFailure('PROTOCOL_VERSION', 'This CLI protocol version is unsupported.')
  if (request.session !== connection.session) throw new AutomationFailure('UNKNOWN_REQUEST', 'Docs restarted. Inspect state before another mutation.')
  if (Object.keys(request).some(key => !['version', 'session', 'token', 'id', 'issuedAt', 'command', 'args', 'hasContent'].includes(key)) ||
      (request.hasContent !== undefined && typeof request.hasContent !== 'boolean') ||
      typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.id) ||
      typeof request.command !== 'string' || request.command.length > 100 || !Number.isFinite(request.issuedAt) ||
      !request.args || typeof request.args !== 'object' || Array.isArray(request.args)) throw new AutomationFailure('BAD_REQUEST', 'Invalid request fields.')
  return request
}

/**
 * Same-user connection owned by the app, with no TCP listener and no service after app exit. `stopWork` ends the long
 * services a command can wait on (a pack download, a helper install) when the app closes, so a quit never waits for them.
 */
export async function startAutomationServer(profile: string, prepare: (request: AutomationRequest, content: Buffer) => Operation, stopWork?: () => Promise<unknown>): Promise<AutomationServer> {
  const descriptor = descriptorPath(profile)
  await privateDirectory(dirname(descriptor))
  const endpoint = await endpointFor(profile)
  await removeStaleSocket(endpoint)
  const connection: Connection = { version: AUTOMATION_VERSION, endpoint, session: randomBytes(16).toString('hex'), token: randomBytes(32).toString('hex'), startedAt: Date.now() }
  const queue = new RequestQueue()
  const sockets = new Set<Socket>()
  let contentInFlight = 0
  const server = createServer(socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(AUTOMATION_LIMITS.waitMs, () => socket.destroy())
    void (async () => {
      let reserved = 0
      try {
        const packet = await readPacket(socket, (control, bytes) => {
          validate(control, connection)
          if (contentInFlight + bytes > AUTOMATION_LIMITS.inFlightContentBytes) throw new AutomationFailure('BUSY', 'Too much content is in flight. No request was accepted.')
          reserved = bytes
          contentInFlight += reserved
        })
        const request = validate(packet.control, connection)
        if (request.command === 'request.status') {
          validateInput(commandDefinition('request.status').input, request.args)
          if (packet.content.length) throw new AutomationFailure('INVALID_INPUT', 'Receipt inspection accepts no content.')
        }
        socket.setTimeout(0) // Accepted work can outlive the caller's wait. It is never cancelled by disconnect.
        const result = request.command === 'request.status'
          ? Buffer.from(JSON.stringify({ ok: true, value: queue.receipt(String(request.args.id ?? '')) }))
          : resultBytes(await queue.submit(request, packet.content, () => prepare(request, packet.content)))
        if (!socket.destroyed) socket.end(encodePacket({ version: AUTOMATION_VERSION, id: request.id }, result))
      } catch (error) {
        if (!socket.destroyed) socket.end(encodePacket({ version: AUTOMATION_VERSION }, Buffer.from(JSON.stringify(automationError(error)))))
      } finally { contentInFlight -= reserved }
    })()
  })
  server.maxConnections = AUTOMATION_LIMITS.active + AUTOMATION_LIMITS.queued + 8
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, () => { server.off('error', reject); resolve() })
  })
  if (process.platform !== 'win32') await chmod(endpoint, 0o600)
  const temp = `${descriptor}.${connection.session}.tmp`
  try {
    await writeFile(temp, JSON.stringify(connection), { mode: 0o600, flag: 'wx' })
    await rename(temp, descriptor)
  } catch (error) {
    server.close(); await unlink(temp).catch(() => {}); throw error
  }
  return {
    connection,
    async close() {
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      // Refuse new work, stop the long services, then wait for the rest at most CLOSE_WAIT_MS (YAZ-4527 P1).
      const drained = queue.close()
      void Promise.resolve().then(stopWork).catch(() => {})
      await drained
      for (const socket of sockets) socket.destroy()
      await closed
      await unlink(descriptor).catch(() => {})
      if (process.platform !== 'win32') await unlink(endpoint).catch(() => {})
    },
  }
}
