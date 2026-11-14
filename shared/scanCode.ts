import { parseEndDate } from './tokenEnd'
import { cleanToken, isBranchName, parseRepo } from './githubInput'

/**
 * "Scan a code" (round 11, item 23): what the Mac's "Connect your phone" code holds (YAZ-5098), read and checked.
 * Pure: the camera and the QR reader are the screen's (4A). The values then go through the same check as typed
 * ones (`signIn`). The token is never logged, never shown, and never in an error.
 *
 * The code's text is JSON, not an address. The iPhone's own Camera offers to open an address in Safari; with
 * JSON it only shows text, so the token does not land in Safari's history:
 *   {"app":"notecards","v":1,"repo":"owner/name","branch":"main","token":"github_pat_…","expires":"2026-12-31T00:00:00Z"}
 * `expires` is optional: the token's end date, which the Mac can read and the phone's browser cannot (`expiry.ts`).
 * The Mac side (YAZ-5098, `desktop/src/main/phoneCode.ts`) writes it with `formatScanCode`, from this one definition.
 */

export const SCAN_CODE_VERSION = 1
/** A QR code holds at most about 3 KB; anything longer is not ours. */
const MAX_LENGTH = 2000

export interface ScanCode {
  repo: string
  branch: string
  token: string
  /** ISO time, or null. */
  expiresAt: string | null
}

export type ScanCodeError = 'not-ours' | 'newer-app' | 'bad-repo' | 'bad-branch' | 'bad-token' | 'bad-end-date'

export type ScanCodeResult = { ok: true; code: ScanCode } | { ok: false; error: ScanCodeError }

export function parseScanCode(text: string): ScanCodeResult {
  const fail = (error: ScanCodeError): ScanCodeResult => ({ ok: false, error })
  if (text.length > MAX_LENGTH) return fail('not-ours')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return fail('not-ours')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('not-ours')
  const v = value as Record<string, unknown>
  if (v.app !== 'notecards' || typeof v.v !== 'number' || !Number.isInteger(v.v) || v.v < 1) return fail('not-ours')
  if (v.v > SCAN_CODE_VERSION) return fail('newer-app')

  const repo = typeof v.repo === 'string' ? parseRepo(v.repo) : null
  if (repo === null) return fail('bad-repo')
  if (typeof v.branch !== 'string' || !isBranchName(v.branch)) return fail('bad-branch')
  const token = typeof v.token === 'string' ? cleanToken(v.token) : null
  if (token === null) return fail('bad-token')
  let expiresAt: string | null = null
  if (v.expires !== undefined && v.expires !== null) {
    expiresAt = typeof v.expires === 'string' ? parseEndDate(v.expires) : null
    if (expiresAt === null) return fail('bad-end-date')
  }
  return { ok: true, code: { repo: repo.full, branch: v.branch, token, expiresAt } }
}

/** The text of a code, as the Mac writes it. */
export function formatScanCode(code: ScanCode): string {
  return JSON.stringify({
    app: 'notecards',
    v: SCAN_CODE_VERSION,
    repo: code.repo,
    branch: code.branch,
    token: code.token,
    ...(code.expiresAt === null ? {} : { expires: code.expiresAt }),
  })
}

/** Plain words for the screen (4A). None holds a value from the code. */
export function scanCodeMessage(error: ScanCodeError): string {
  switch (error) {
    case 'not-ours':
      return 'This is not a Notecard code. On your Mac, open Settings › Review › Connect your phone, and scan the code there.'
    case 'newer-app':
      return 'This code is from a newer Notecard. Reload the app to update it, then scan again.'
    case 'bad-repo':
      return 'The code has no valid repo name. Show a new code on your Mac.'
    case 'bad-branch':
      return 'The code has no valid branch name. Show a new code on your Mac.'
    case 'bad-token':
      return 'The code has no valid token. Check the token in Settings on your Mac, then show a new code.'
    case 'bad-end-date':
      return 'The code has a wrong end date for the token. Show a new code on your Mac.'
  }
}
