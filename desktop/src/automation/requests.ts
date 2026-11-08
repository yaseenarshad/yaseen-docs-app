import { createHash } from 'node:crypto'
import { AUTOMATION_LIMITS, AutomationFailure, automationError, type AutomationReceipt, type AutomationRequest, type AutomationResult } from '@shared/automation'

export interface Operation {
  /** Complete shared actions provide stable resource keys; readers can run together. A bare key covers its family:
   * `documents` overlaps `documents:/vault`, and `documents:/vault` overlaps `documents:/vault/inner`. */
  writes: readonly string[]
  run(): Promise<unknown>
}
interface Entry {
  fingerprint: string
  issuedAt: number
  receipt: AutomationReceipt
  operation: Operation
  promise: Promise<AutomationResult>
  resolve(result: AutomationResult): void
}

/** How long a close waits for accepted work before the app quits anyway (YAZ-4527 P1). Its callers lose the connection. */
export const CLOSE_WAIT_MS = 3_000
const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}:`) || b.startsWith(`${a}:`) || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
const taken = (keys: Iterable<string>, key: string) => { for (const held of keys) if (overlaps(held, key)) return true; return false }
/** The result's JSON, made once by the queue for its size check and kept for the reply (YAZ-4527 P22). */
const encoded = new WeakMap<AutomationResult, Buffer>()
export const resultBytes = (result: AutomationResult): Buffer => encoded.get(result) ?? Buffer.from(JSON.stringify(result))

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}

/** Four active operations, bounded queue and small receipts. No timers or persistent replay journal. The server bounds the content in flight. */
export class RequestQueue {
  private readonly entries = new Map<string, Entry>()
  private readonly queue: Entry[] = []
  private readonly locked = new Set<string>()
  private active = 0
  private closing = false
  private forgottenThrough = 0
  private drained: (() => void)[] = []
  constructor(private readonly now = Date.now) {}

  receipt(id: string): AutomationReceipt {
    this.prune()
    return this.entries.get(id)?.receipt ?? { id, state: 'unknown' }
  }

  submit(request: AutomationRequest, content: Buffer, prepare: () => Operation): Promise<AutomationResult> {
    if (this.closing) throw new AutomationFailure('STOPPING', 'Docs is stopping. No request was accepted.')
    this.prune()
    const age = this.now() - request.issuedAt
    if (age >= AUTOMATION_LIMITS.receiptMs || age < -30_000) throw new AutomationFailure('UNKNOWN_REQUEST', 'This request is outside the receipt window. Inspect state before another mutation.')
    const fingerprint = createHash('sha256').update(canonical({ command: request.command, args: request.args, hasContent: request.hasContent ?? content.length > 0 })).update(content).digest('hex')
    const existing = this.entries.get(request.id)
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.issuedAt !== request.issuedAt) throw new AutomationFailure('REQUEST_MISMATCH', 'This request ID was used with different input.')
      if (existing.receipt.state !== 'completed') return existing.promise
      return Promise.resolve(existing.receipt.result ?? { ok: true, value: existing.receipt })
    }
    if (request.issuedAt <= this.forgottenThrough) throw new AutomationFailure('UNKNOWN_REQUEST', 'The receipt may have expired. Inspect state before another mutation.')
    // Count queued work independently: requests blocked on a resource must not exceed the queue bound.
    const operation = prepare()
    const waiting = this.queue.flatMap(entry => entry.operation.writes)
    const canStart = this.active < AUTOMATION_LIMITS.active && operation.writes.every(key => !taken(this.locked, key) && !taken(waiting, key))
    if (!canStart && this.queue.length >= AUTOMATION_LIMITS.queued) throw new AutomationFailure('BUSY', 'The request queue is full. No request was accepted.')
    let resolve!: Entry['resolve']
    const promise = new Promise<AutomationResult>(done => { resolve = done })
    const entry: Entry = { fingerprint, issuedAt: request.issuedAt, receipt: { id: request.id, state: 'queued' }, operation, promise, resolve }
    this.entries.set(request.id, entry)
    this.queue.push(entry)
    this.pump()
    return promise
  }

  /** Refuses new work at once, then waits for accepted work, at most CLOSE_WAIT_MS. */
  async close(): Promise<void> {
    this.closing = true
    if (!this.active && !this.queue.length) return
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([new Promise<void>(resolve => this.drained.push(resolve)), new Promise<void>(resolve => { timer = setTimeout(resolve, CLOSE_WAIT_MS) })])
    clearTimeout(timer)
  }

  private prune(): void {
    for (const [id, entry] of this.entries) {
      if (entry.receipt.state === 'completed' && this.now() - entry.issuedAt >= AUTOMATION_LIMITS.receiptMs) this.entries.delete(id)
    }
    const done = [...this.entries].filter(([,entry]) => entry.receipt.state === 'completed')
    for (const [id, entry] of done.slice(0, Math.max(0, done.length - AUTOMATION_LIMITS.receipts))) {
      this.forgottenThrough = Math.max(this.forgottenThrough, entry.issuedAt)
      this.entries.delete(id)
    }
  }

  private pump(): void {
    while (this.active < AUTOMATION_LIMITS.active) {
      // A later request cannot pass an earlier request for the same resource.
      const waiting: string[] = []
      const index = this.queue.findIndex(entry => {
        const free = entry.operation.writes.every(key => !taken(this.locked, key) && !taken(waiting, key))
        waiting.push(...entry.operation.writes)
        return free
      })
      if (index < 0) break
      const [entry] = this.queue.splice(index, 1)
      this.active++
      entry.receipt.state = 'running'
      entry.operation.writes.forEach(key => this.locked.add(key))
      void Promise.resolve().then(() => entry.operation.run()).then(
        value => this.complete(entry, { ok: true, value }),
        error => this.complete(entry, automationError(error)),
      )
    }
    if (!this.active && !this.queue.length) this.drained.splice(0).forEach(done => done())
  }

  private complete(entry: Entry, result: AutomationResult): void {
    entry.operation.writes.forEach(key => this.locked.delete(key))
    this.active--
    let bytes: Buffer
    try {
      bytes = Buffer.from(JSON.stringify(result))
      if (bytes.length > AUTOMATION_LIMITS.contentBytes) throw new AutomationFailure('TOO_LARGE', 'The result exceeds the connection limit. Use a paged read or file export.')
    } catch (error) {
      result = automationError(error instanceof AutomationFailure ? error : new AutomationFailure('INVALID_RESULT', 'The command returned a value that cannot be serialized. Inspect its current state before another mutation.'))
      bytes = Buffer.from(JSON.stringify(result))
    }
    encoded.set(result, bytes)
    const retained = bytes.length <= AUTOMATION_LIMITS.receiptBytes
    entry.receipt = { id: entry.receipt.id, state: 'completed', resultRetained: retained, ...(retained ? { result } : {}) }
    entry.resolve(result)
    // Do not retain a resolved promise or closure containing a large body or a protected input.
    entry.promise = Promise.resolve(entry.receipt.result ?? { ok: true, value: entry.receipt })
    entry.resolve = () => {}
    entry.operation = { writes: [], run: async () => undefined }
    this.prune()
    this.pump()
  }
}
