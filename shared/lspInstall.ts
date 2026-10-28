/**
 * THE HELPERS' DOWNLOAD's data (YAZ-3500; YAZ-3439 "Download the helpers on first switch-on, after a box that
 * explains"). Its own file, apart from `lsp.ts`: Settings › Code (eager) reads it, and `lsp.ts`'s tables
 * stay in the code tab's lazy chunk. The app ships no helper. The first switch-on of Settings › Code ›
 * "Jump across files" asks, then main downloads the pinned packages of this platform. The renderer never
 * names a URL, a version or a path: it asks `lsp.helpers` and `lsp.install`, and main decides the rest.
 */
import type { LspLanguage } from './lsp'

export interface LspHelpersState {
  /** Every helper of this platform is there (downloaded, or a dev build's `node_modules` copy): a switch-on needs no box. */
  ready: boolean
  /** A download runs now (another window may have started it). */
  installing: boolean
}

/** One step of `lsp.install`, pushed to the window that asked (`lsp.onInstallProgress`). */
export interface LspInstallProgress {
  /** Which helper: `typescript` or `python`. */
  helper: LspLanguage
  /** `download`: bytes arrive; `unpack`: the checked file is written to disk. */
  phase: 'download' | 'unpack'
  /** Bytes so far, and the file's size when the server gave one. */
  received: number
  total: number | null
  /** 1-based place of this helper among the helpers that download now, and their count. */
  index: number
  count: number
}

/** What went wrong, for the box's one sentence (`installErrorText`). */
export type LspInstallError = 'offline' | 'http' | 'mismatch' | 'unpack' | 'disk' | 'unsupported' | 'cancelled'

export type LspInstallResult = { ok: true } | { ok: false; error: LspInstallError; detail?: string }

/** The box's one sentence for a failed download (YAZ-3439: a hash mismatch says exactly this). */
export function installErrorText(result: Extract<LspInstallResult, { ok: false }>): string {
  switch (result.error) {
    case 'mismatch':
      return 'The download did not match. Try again later.'
    case 'offline':
      return "Couldn't download the helper tools. Check your internet connection and try again."
    case 'http':
      return `The download failed${result.detail ? ` (${result.detail})` : ''}. Try again later.`
    case 'unpack':
      return "The helper tools couldn't be unpacked. Try again later."
    case 'disk':
      return `The helper tools couldn't be saved${result.detail ? `: ${result.detail}` : ''}.`
    case 'unsupported':
      return "Jump across files doesn't work on this computer."
    case 'cancelled':
      return 'The download stopped.'
  }
}
