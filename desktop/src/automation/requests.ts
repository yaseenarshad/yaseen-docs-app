import { createHash } from 'node:crypto'
import { AUTOMATION_LIMITS, AutomationFailure, automationError, type AutomationReceipt, type AutomationRequest, type AutomationResult } from '@shared/automation'

export interface Operation {
  /** Complete shared actions provide stable resource keys; readers can run together. */
  writes: readonly string[]
  run(): Promise<unknown>
}
interface Entry {
  fingerprint: string
  issuedAt: number
  contentBytes: number
  receipt: AutomationReceipt
  operation: Operation
  promise: Promise<AutomationResult>
  resolve(result: AutomationResult): void
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}

/** Four active operations, bounded queue and small receipts. No timers or persistent replay journal. */
export class RequestQueue {
  private readonly entries = new Map<string, Entry>()
  private readonly queue: Entry[] = []
  private readonly locked = new Set<string>()
  private active = 0
  private contentBytes = 0
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
    const fingerprint = createHash('sha256').update(canonical({ command: request.command, args: request.args })).update(content).digest('hex')
    const existing = this.entries.get(request.id)
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.issuedAt !== request.issuedAt) throw new AutomationFailure('REQUEST_MISMATCH', 'This request ID was used with different input.')
      if (existing.receipt.state !== 'completed') return existing.promise
      return Promise.resolve(existing.receipt.result ?? { ok: true, value: existing.receipt })
    }
    if (request.issuedAt <= this.forgottenThrough) throw new AutomationFailure('UNKNOWN_REQUEST', 'The receipt may have expired. Inspect state before another mutation.')
    if (this.contentBytes + content.length > AUTOMATION_LIMITS.inFlightContentBytes) throw new AutomationFailure('BUSY', 'Too much content is in flight. No request was accepted.')
    // Count queued work independently: requests blocked on a resource must not exceed the queue bound.
    const operation = prepare()
    const canStart = this.active < AUTOMATION_LIMITS.active && operation.writes.every(key => !this.locked.has(key))
    if (!canStart && this.queue.length >= AUTOMATION_LIMITS.queued) throw new AutomationFailure('BUSY', 'The request queue is full. No request was accepted.')
    let resolve!: Entry['resolve']
    const promise = new Promise<AutomationResult>(done => { resolve = done })
    const entry: Entry = { fingerprint, issuedAt: request.issuedAt, contentBytes: content.length, receipt: { id: request.id, state: 'queued' }, operation, promise, resolve }
    this.contentBytes += content.length
    this.entries.set(request.id, entry)
    this.queue.push(entry)
    this.pump()
    return promise
  }

  async close(): Promise<void> {
    this.closing = true
    if (this.active || this.queue.length) await new Promise<void>(resolve => this.drained.push(resolve))
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
      const waiting = new Set<string>()
      const index = this.queue.findIndex(entry => {
        const free = entry.operation.writes.every(key => !this.locked.has(key) && !waiting.has(key))
        entry.operation.writes.forEach(key => waiting.add(key))
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
    this.contentBytes -= entry.contentBytes
    entry.operation.writes.forEach(key => this.locked.delete(key))
    this.active--
    const retained = Buffer.byteLength(JSON.stringify(result)) <= AUTOMATION_LIMITS.receiptBytes
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
