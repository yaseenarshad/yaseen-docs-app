import { randomUUID } from 'node:crypto'
import { connect } from 'node:net'
import { AUTOMATION_LIMITS, AutomationFailure, type AutomationRequest, type AutomationResult } from '@shared/automation'
import type { Connection } from './connection'
import { encodePacket, readPacket } from './wire'

/** Keep the returned request reference when retrying. A timeout means outcome unknown, never cancellation. */
export function makeRequest(connection: Connection, command: string, args: Record<string, unknown>): AutomationRequest {
  return { version: connection.version, token: connection.token, session: connection.session, id: randomUUID(), issuedAt: Date.now(), command, args }
}

export async function sendRequest(connection: Connection, request: AutomationRequest, content = Buffer.alloc(0), waitMs: number = AUTOMATION_LIMITS.waitMs): Promise<AutomationResult> {
  const packet = encodePacket(request, content)
  const socket = connect(connection.endpoint)
  const deadline = setTimeout(() => socket.destroy(new AutomationFailure('WAIT_TIMEOUT', `The wait ended. Request ${request.id} may still finish. Inspect its receipt; do not replay the mutation.`)), waitMs)
  try {
    const reply = readPacket(socket)
    socket.once('connect', () => socket.write(packet))
    const result = await reply
    return JSON.parse(result.content.toString('utf8')) as AutomationResult
  } catch (error) {
    if (error instanceof AutomationFailure) throw error
    throw new AutomationFailure('CONNECTION_LOST', `No result was received for request ${request.id}. Inspect state before another mutation.`)
  } finally { clearTimeout(deadline); socket.destroy() }
}
