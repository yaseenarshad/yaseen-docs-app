/** Public automation protocol. It contains no Electron channels or renderer implementation names. */
export const AUTOMATION_VERSION = 1
export const AUTOMATION_LIMITS = {
  active: 4, queued: 64, receipts: 256, receiptMs: 5 * 60_000,
  controlBytes: 64 * 1024, contentBytes: 64 * 1024 * 1024, receiptBytes: 4096,
  inFlightContentBytes: 128 * 1024 * 1024,
  waitMs: 30_000, page: 50, maxPage: 200,
} as const

/** One page of a list: the caller's offset and limit, or the first `AUTOMATION_LIMITS.page` items (YAZ-4527 P10). */
export function pageOf<T>(items: readonly T[], args: { offset?: unknown; limit?: unknown }): { items: T[]; total: number; nextOffset: number | null } {
  const offset = typeof args.offset === 'number' ? args.offset : 0, limit = typeof args.limit === 'number' ? args.limit : AUTOMATION_LIMITS.page
  return { items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null }
}

export interface AutomationError { code: string; message: string; details?: Record<string, unknown> }
export type AutomationResult = { ok: true; value: unknown } | { ok: false; error: AutomationError }
export interface AutomationRequest {
  version: typeof AUTOMATION_VERSION
  session: string
  token: string
  id: string
  issuedAt: number
  command: string
  args: Record<string, unknown>
  /** Distinguish an omitted body from a deliberately empty body. */
  hasContent?: boolean
}
export interface AutomationReceipt {
  id: string
  state: 'queued' | 'running' | 'completed' | 'unknown'
  result?: AutomationResult
  /** Large results are delivered to waiting callers, never retained by the receipt cache. */
  resultRetained?: boolean
}

export class AutomationFailure extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) { super(message); this.name = 'AutomationFailure' }
}

export function automationError(error: unknown): AutomationResult {
  if (error instanceof AutomationFailure) return { ok: false, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }
  // Do not leak provider URLs, credentials, or arbitrary exception text through the public boundary.
  return { ok: false, error: { code: 'FAILED', message: 'The operation failed. Check the app diagnostics.' } }
}
