import { createServer } from 'node:net'

/**
 * A port nothing listens on now (the system picks it: port 0), for a proof's Chrome debug port and its file server.
 * A fixed default failed the publish when another Chrome held it. `fromEnv`: the port the person named, as a number.
 */
export async function freePort(fromEnv?: string): Promise<number> {
  if (fromEnv !== undefined && fromEnv !== '') return Number(fromEnv)
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error('No free port'))))
    })
  })
}
