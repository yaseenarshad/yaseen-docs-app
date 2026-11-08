/** Public automation protocol. It contains no Electron channels or renderer implementation names. */
export const AUTOMATION_VERSION = 1
/** Four running requests and 64 waiting; 256 small receipts for five minutes; one bounded JSON frame each way. */
export const AUTOMATION_LIMITS = { active: 4, queued: 64, receipts: 256, receiptMs: 5 * 60_000, receiptBytes: 4096, controlBytes: 64 * 1024, waitMs: 30_000 } as const

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
}
export interface AutomationReceipt {
  id: string
  state: 'queued' | 'running' | 'completed' | 'unknown'
  result?: AutomationResult
  /** A result over `receiptBytes` goes to the waiting caller only; the receipt does not keep it. */
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
