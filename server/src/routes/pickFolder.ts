import { execFile } from 'node:child_process'
import { Hono } from 'hono'
import type { PickFolderResponse } from '@shared/types'
import { ApiFailure } from '../fs-utils'

/** How long the Finder dialog may stay open before the request fails. */
const PICKER_TIMEOUT_MS = 5 * 60 * 1000

const OSASCRIPT_ARGS = [
  '-e',
  'tell application "System Events" to activate',
  '-e',
  'POSIX path of (choose folder with prompt "Open folder")',
]

/** osascript exits 1 with "User canceled. (-128)" on stderr when the dialog is dismissed. */
function isUserCancel(code: number | string | undefined, stderr: string): boolean {
  return code === 1 && (stderr.includes('User canceled') || stderr.includes('-128'))
}

/** Finder returns `/path/to/dir/` followed by a newline; normalise to a plain absolute path. */
function normaliseChosenPath(stdout: string): string {
  const trimmed = stdout.trim()
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, '') : trimmed
}

function chooseFolder(): Promise<PickFolderResponse> {
  return new Promise((resolve, reject) => {
    execFile('osascript', OSASCRIPT_ARGS, { timeout: PICKER_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err === null) {
        resolve({ path: normaliseChosenPath(stdout) })
      } else if (isUserCancel(err.code, stderr)) {
        resolve({ cancelled: true })
      } else {
        const detail = stderr.trim() !== '' ? stderr.trim() : err.message
        reject(new ApiFailure(500, 'PICKER_FAILED', `native folder dialog failed: ${detail}`))
      }
    })
  })
}

export const pickFolderRoute = new Hono().post('/api/pick-folder', async (c) => {
  if (process.platform !== 'darwin') {
    throw new ApiFailure(501, 'NOT_SUPPORTED', 'native folder dialog is only available on macOS')
  }
  return c.json(await chooseFolder())
})
