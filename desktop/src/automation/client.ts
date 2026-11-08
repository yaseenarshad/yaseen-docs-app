import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { AUTOMATION_LIMITS, AutomationFailure, type AutomationRequest, type AutomationResult } from '@shared/automation'
import type { Connection } from './connection'
import { encodePacket, readPacket } from './wire'

/** Keep the returned request reference when retrying. A timeout means outcome unknown, never cancellation. */
export function makeRequest(connection: Connection, command: string, args: Record<string, unknown>): AutomationRequest {
  return { version: connection.version, token: connection.token, session: connection.session, id: randomUUID(), issuedAt: Date.now(), command, args }
}

/** The reply frame is the result itself. */
export async function sendRequest(connection: Connection, request: AutomationRequest, waitMs: number = AUTOMATION_LIMITS.waitMs): Promise<AutomationResult> {
  const packet = encodePacket(request)
  const socket = connect(connection.endpoint)
  const deadline = setTimeout(() => socket.destroy(new AutomationFailure('WAIT_TIMEOUT', `The wait ended. Request ${request.id} may still finish. Inspect its receipt before you try again.`)), waitMs)
  let connected = false
  try {
    const reply = readPacket(socket)
    socket.once('connect', () => { connected = true; socket.write(packet) })
    return await reply as AutomationResult
  } catch (error) {
    if (error instanceof AutomationFailure) throw error
    // Nothing listens: the request never reached an app, so this outcome is known.
    if (!connected && ['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new AutomationFailure('NOT_RUNNING', 'Docs is not running in this profile. Start it, or pass --start.')
    throw new AutomationFailure('CONNECTION_LOST', `No result was received for request ${request.id}. Inspect its receipt before you try again.`)
  } finally { clearTimeout(deadline); socket.destroy() }
}
