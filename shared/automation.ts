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

/**
 * Every error code a command can return, with what it means and what to do (YAZ-4527 P14). `capabilities` prints
 * this table and `docs/CLI.md` lists it. A code is added here first; `registry.test.ts` fails on a code thrown elsewhere.
 * Outcome words: "Nothing changed" — safe to fix and retry. "Unknown" — read the receipt or the state before another write.
 */
export const AUTOMATION_ERRORS = {
  // Usage: the CLI exits 2. Nothing was sent, or the app refused the input before any work.
  INVALID_INPUT: 'The input is wrong: an unknown flag or field, a wrong type, a bad value, or an unreadable --input or --body. Nothing changed. Fix the input.',
  UNKNOWN_COMMAND: 'No such resource action. Nothing changed. Run capabilities.',
  // Connection and startup: no operation ran unless the code says unknown.
  NOT_RUNNING: 'Docs is not running in this profile. Start it, or pass --start.',
  START_FAILED: 'Docs could not start from this CLI, or did not become ready. Nothing was sent. Start the app yourself, or set YASEEN_DOCS_EXECUTABLE.',
  BAD_CONNECTION: 'The profile’s connection file is invalid or belongs to another app run. Nothing was sent. Restart Docs.',
  UNSAFE_PROFILE: 'The profile’s CLI folder, connection file or socket is not private to you. Nothing was sent. Fix its owner and permissions.',
  PROTOCOL_VERSION: 'This CLI and the running app speak different protocol versions. Nothing was sent. Use the CLI of the running app.',
  ALREADY_RUNNING: 'Another app run already serves this profile. The app reports this at startup only.',
  BAD_REQUEST: 'The request frame is malformed. Nothing changed. The CLI never sends one; another client did.',
  STOPPING: 'Docs is quitting. Nothing was accepted. Retry after it starts again.',
  BUSY: 'The request queue or the content in flight is full. Nothing was accepted. Wait and retry.',
  UNKNOWN_REQUEST: 'The request is outside the receipt window, or Docs restarted. The outcome is unknown. Read the state before another write.',
  REQUEST_MISMATCH: 'This request ID was used with different input. Nothing changed. Use a new request.',
  WAIT_TIMEOUT: 'The wait ended first. The outcome is unknown: run request status --id <id> or read the state. Do not repeat a write blindly.',
  CONNECTION_LOST: 'The connection closed before a reply. The outcome is unknown: run request status --id <id> or read the state.',
  // Targets: nothing changed.
  NOT_FOUND: 'The target does not exist. Nothing changed. Read the current state and choose again.',
  MISSING_TARGET: 'Some vaults or pages of the request are missing; details.missing lists them. Nothing changed. Pass allowPartial: true to go on without them.',
  WINDOW_NOT_FOUND: 'The window is not open. Nothing changed. Run window list.',
  TAB_NOT_FOUND: 'The tab is not in that window. Nothing changed. Run window inspect.',
  AMBIGUOUS_TARGET: 'The name matches more than one item. Nothing changed. Use a path from details.candidates.',
  NOT_IN_COLLECTION: 'The target is not in that Favorites or Focus list. Nothing changed.',
  OUTSIDE_SCOPE: 'A path is outside the vaults the command names or the window shows. Nothing changed.',
  WINDOW_SCOPE_MISMATCH: 'The named window shows other vaults than the request. Nothing changed.',
  TARGET_UNAVAILABLE: 'The target window cannot take the tab: it shows no vault of the page, or it refused it. The tab stayed.',
  LIVE_DOCUMENT_UNAVAILABLE: 'The tab has no ready editor: it sleeps, loads, or closed. Nothing changed. Wake or open it, then retry.',
  UNSUPPORTED: 'The target does not support this command or action: a wrong file kind, a folder where a file is needed, or an action that does not apply now. Nothing changed.',
  RESERVED_PROPERTY: 'That property key belongs to the app; the message names the command that changes it. Nothing changed.',
  COMMENT_OWNERSHIP: 'The comment belongs to a person. Only an agent’s comment can be changed. Nothing changed.',
  IDS_OFF: 'The vault does not use IDs. Nothing changed. Turn them on with ids enable.',
  DAILY_DISABLED: 'Daily notes are off in Settings. Nothing changed.',
  INVALID_CONFIG: 'A vault configuration file is unusable. Nothing changed, and the file was not touched.',
  NOT_SET_UP: 'Sharing is not set up on this Mac. Nothing changed. Run share setup.',
  UNAVAILABLE: 'This app run cannot do that, such as window management in a test host. Nothing changed.',
  UPDATE_NOT_READY: 'No downloaded update is ready to install. Nothing changed.',
  NO_HISTORY: 'There is no step to undo, redo or restore: the history is empty, or its newest step is not a delete (file restore). Nothing changed.',
  NO_TABS: 'The window has no tabs to save. Nothing changed.',
  NOTHING_TO_CHANGE: 'The vault is already in the asked state. Nothing changed.',
  LAST_VIEW: 'A folder page keeps at least one view. Nothing changed.',
  LAST_PLACE: 'A group shows in one list at least. Nothing changed. To remove it, use group remove.',
  LIMIT_EXCEEDED: 'A Favorites, Focus or group list would pass its limit. Nothing changed. Waiting does not help: remove items first.',
  CONFIRMATION_REQUIRED: 'The command would clear data that the app asks about first; details names it. Nothing changed. Pass the named answer, such as dropValues: true.',
  ALREADY_EXISTS: 'The new path or name you chose is taken. Nothing was overwritten. Choose another.',
  TOO_LARGE: 'The input or result is over a size limit. Nothing changed. Use the command’s file input or output, or a smaller page.',
  // Writes.
  CONFLICT: 'The file or list changed after you read it, or a file exists where revision null expected none. Nothing was written. Read again, merge, and retry.',
  UNSAVED_LIVE_EDITS: 'An open editor holds unsaved edits of this file; details names the window and tab. Nothing was written. Save it with editor save, read again, and retry.',
  SAVE_INCOMPLETE: 'An open editor could not save, for example under a conflict bar. Nothing else changed. A person resolves it; then retry.',
  CONTEXT_CHANGED: 'The window’s vaults or file list changed during the command. Nothing changed. Read the window again.',
  PARTIAL_FAILURE: 'Some items changed and some did not; details lists which. Read the state before you retry.',
  HISTORY_STEP_FAILED: 'The undo or redo step changed nothing; details holds each item’s reason. Read file history before another step.',
  INCOMPLETE_CONTENT: 'The body misses a part it needs, such as a picture of a standalone drawing. Nothing changed.',
  RENDERER_TIMEOUT: 'A window did not confirm the change in time, or could not answer; details says which. The outcome is unknown: read the windows or the state.',
  WINDOW_CLOSED: 'A window closed before it confirmed the change. The outcome is unknown: read the state.',
  EXPORT_FAILED: 'The editor could not render the export. Nothing was written.',
  PROVIDER_FAILED: 'A provider (Pixabay, Iconify, Cloudflare, the share server) answered with an error. Retry later.',
  OFFLINE: 'A provider could not be reached. Check the network and retry.',
  FORBIDDEN: 'The system refused access to a file. Nothing changed.',
  IO_ERROR: 'A file could not be read or written. Check the message and the disk.',
  INVALID_RESULT: 'The app produced a result it could not send. The outcome is unknown: read the state.',
  OUTPUT_MISMATCH: 'Tests only: a result did not match its declared output schema.',
  FAILED: 'The operation failed for a reason the app does not share (see its diagnostics). The outcome is unknown: read the state.',
} as const satisfies Record<string, string>
export type AutomationErrorCode = keyof typeof AUTOMATION_ERRORS
/** A code from the file layer (`BridgeErrorCode`) or the wire as one of the public codes above. */
export function publicCode(code: string): AutomationErrorCode {
  if (code === 'BAD_REQUEST' || code === 'NOT_ABSOLUTE') return 'INVALID_INPUT'
  if (code === 'UNSUPPORTED_EXTENSION' || code === 'NOT_A_FILE' || code === 'NOT_A_DIRECTORY') return 'UNSUPPORTED'
  if (code === 'UNSUPPORTED_TYPE') return 'PROVIDER_FAILED'
  return Object.hasOwn(AUTOMATION_ERRORS, code) ? code as AutomationErrorCode : 'FAILED'
}
/** Errors of the input or the command name: the CLI exits 2 for these, wherever they were found. */
export const USAGE_ERRORS: readonly string[] = ['INVALID_INPUT', 'UNKNOWN_COMMAND']

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
  constructor(readonly code: AutomationErrorCode, message: string, readonly details?: Record<string, unknown>) { super(message); this.name = 'AutomationFailure' }
}

export function automationError(error: unknown): AutomationResult {
  if (error instanceof AutomationFailure) return { ok: false, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } }
  // Do not leak provider URLs, credentials, or arbitrary exception text through the public boundary.
  return { ok: false, error: { code: 'FAILED', message: 'The operation failed. Check the app diagnostics.' } }
}
