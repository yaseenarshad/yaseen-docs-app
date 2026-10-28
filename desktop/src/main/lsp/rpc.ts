import type { Readable, Writable } from 'node:stream'

/**
 * JSON-RPC 2.0 over the LSP base protocol (YAZ-3453): each message is a `Content-Length: <bytes>`
 * header, a blank line, then that many bytes of UTF-8 JSON. Hand framing, not `vscode-jsonrpc`:
 * the whole protocol the app needs is one header, requests with ids, and notifications, and this
 * file is smaller than that package's setup code.
 *
 * Requests FROM the server (`workspace/configuration`, `client/registerCapability`,
 * `window/workDoneProgress/create`) must get a reply, or a server can wait on them. The default
 * answer is `null` (an item list of `null` for `workspace/configuration`: "no settings").
 */

export interface RpcError {
  code: number
  message: string
  data?: unknown
}

type Message = {
  jsonrpc: '2.0'
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: RpcError
}

export type RequestHandler = (method: string, params: unknown) => unknown
export type NotificationHandler = (method: string, params: unknown) => void

/** The reply to a server request no handler answered. */
export function defaultServerReply(method: string, params: unknown): unknown {
  if (method === 'workspace/configuration') {
    const items = (params as { items?: unknown[] } | null)?.items
    return Array.isArray(items) ? items.map(() => null) : []
  }
  return null
}

const HEADER_END = Buffer.from('\r\n\r\n')

export class RpcConnection {
  private buffer: Buffer = Buffer.alloc(0)
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout }>()
  private closed: Error | null = null
  private requestHandler: RequestHandler = defaultServerReply
  private readonly notificationHandlers = new Set<NotificationHandler>()

  constructor(
    input: Readable,
    private readonly output: Writable,
  ) {
    input.on('data', (chunk: Buffer) => this.receive(chunk))
    input.on('close', () => this.dispose(new Error('the language server closed its output')))
    // A write after the process died raises EPIPE here; the exit handler reports the death.
    output.on('error', () => undefined)
  }

  /** Sends a request and waits for its answer. Rejects on an error reply, on `timeoutMs`, or when the connection closes. */
  request<R = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<R> {
    if (this.closed) return Promise.reject(this.closed)
    const id = this.nextId++
    return new Promise<R>((resolve, reject) => {
      const entry: { resolve: (v: unknown) => void; reject: (e: Error) => void; timer?: NodeJS.Timeout } = { resolve: resolve as (v: unknown) => void, reject }
      if (timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id)
          reject(new Error(`${method}: no answer in ${timeoutMs} ms`))
        }, timeoutMs)
      }
      this.pending.set(id, entry)
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    if (!this.closed) this.send({ jsonrpc: '2.0', method, params })
  }

  /** Replaces the answer to server requests. The handler may return a promise. */
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler
  }

  /** Adds a listener for server notifications (`textDocument/publishDiagnostics`, `window/logMessage`, …). Returns its remover. */
  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler)
    return () => this.notificationHandlers.delete(handler)
  }

  /** Rejects every waiting request. Idempotent. */
  dispose(reason: Error): void {
    if (this.closed) return
    this.closed = reason
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(reason)
    }
    this.pending.clear()
  }

  private send(message: Message): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    this.output.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.output.write(body)
  }

  private receive(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf(HEADER_END)
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        // Not the base protocol: drop the bad header and resynchronise on the next one.
        this.buffer = this.buffer.subarray(headerEnd + HEADER_END.length)
        continue
      }
      const start = headerEnd + HEADER_END.length
      const end = start + Number(match[1])
      if (this.buffer.length < end) return
      const body = this.buffer.subarray(start, end).toString('utf8')
      this.buffer = this.buffer.subarray(end)
      let message: Message
      try {
        message = JSON.parse(body) as Message
      } catch {
        continue
      }
      this.dispatch(message)
    }
  }

  private dispatch(message: Message): void {
    if (message.method !== undefined && message.id !== undefined && message.id !== null) {
      const id = message.id
      Promise.resolve()
        .then(() => this.requestHandler(message.method!, message.params))
        .then(
          (result) => this.send({ jsonrpc: '2.0', id, result: result ?? null }),
          (err: unknown) => this.send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(err) } }),
        )
      return
    }
    if (message.method !== undefined) {
      for (const handler of this.notificationHandlers) handler(message.method, message.params)
      return
    }
    if (typeof message.id !== 'number') return
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(Object.assign(new Error(message.error.message), { code: message.error.code, data: message.error.data }))
    else entry.resolve(message.result)
  }
}
