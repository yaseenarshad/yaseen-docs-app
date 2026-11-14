import { signInMessage, type SignInError } from '../auth/check'
import type { PhoneVault } from '../store'
import type { UnitText } from './unitWord'
import type { ShellSyncState } from './syncPort'

/**
 * Every problem on a screen has plain words AND a way forward (YAZ-5077). No raw error text or status code
 * reaches the screen (YAZ-5076). The words of the sign-in results are 3E's (`signInMessage`); this adds the step.
 */
export type Forward =
  /** Opens "Set up your phone" at the token steps. */
  | 'token-guide'
  /** Opens "Set up your phone" at the repo steps. */
  | 'repo-guide'
  /** Puts the caret in the repo field. */
  | 'edit-repo'
  /** Runs the same step again. */
  | 'retry'
  /** Opens the vault that is already on the phone. */
  | 'open-vault'
  /** Asks for a new token for this vault (row N6). */
  | 'sign-in-again'
  /** Opens Settings (remove or change the vault). */
  | 'settings'

export interface Help {
  message: string
  forward: Forward
}

/** A failure that is not a sign-in result: the phone could not store the vault. */
export const SAVE_FAILED: Help = { message: 'Notecards could not save on this phone. Free some space, then try again.', forward: 'retry' }

export const FORWARD_LABEL: Record<Forward, string> = {
  'token-guide': 'How to make a token',
  'repo-guide': 'How to set up the repo',
  'edit-repo': 'Change the repo',
  retry: 'Try again',
  'open-vault': 'Open it',
  'sign-in-again': 'Sign in again',
  settings: 'Open Settings',
}

/** The words and the way forward for each typed result of the sign-in check (3E). */
export function signInHelp(error: SignInError): Help {
  const message = signInMessage(error)
  switch (error.kind) {
    case 'bad-repo':
    case 'bad-branch':
      return { message, forward: 'edit-repo' }
    case 'bad-token':
    case 'unauthorized':
    case 'repo-not-found':
    case 'no-access':
    case 'no-contents':
    case 'read-only':
      return { message, forward: 'token-guide' }
    case 'branch-not-found':
    case 'no-vault':
      return { message, forward: 'repo-guide' }
    case 'already-added':
      return { message, forward: 'open-vault' }
    case 'offline':
    case 'github-down':
    case 'rate-limited':
      return { message, forward: 'retry' }
    case 'unexpected':
      // No status code on a screen (YAZ-5076, YAZ-5177): 3E's words keep it for logs; the screen gets plain words.
      return { message: 'GitHub gave an answer we did not expect. Try again in a few minutes.', forward: 'retry' }
  }
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * What the sync's problem means for the person, or null for none. `downloading`: the first download is not done, so
 * nothing of the vault shows yet (row F2); then the passing problems (no signal, slow down) are said too. When the
 * vault is ready, those passing problems are the status dot's alone (4D), and only a problem the person must act on
 * shows here.
 */
export function syncHelp(state: ShellSyncState, vault: PhoneVault, unit: UnitText, downloading: boolean): Help | null {
  const keep = downloading ? '' : unit(' The pages on this phone stay readable.')
  switch (state.problem) {
    case null:
      return null
    case 'UNAUTHORIZED':
    case 'NO_TOKEN':
      // Row N6.
      return { message: `GitHub does not accept the token for ${vault.repo}. It ended or was cancelled.${keep}`, forward: 'sign-in-again' }
    case 'READ_ONLY':
      return { message: `Your token can read ${vault.repo} but not change it. Make a token with Contents: Read and write.${keep}`, forward: 'sign-in-again' }
    case 'NOT_FOUND':
    case 'NO_ACCESS':
      // Row R12.
      return {
        message: `Can't find ${vault.repo} (branch ${vault.branch}) on GitHub. It was renamed or deleted, or your token can't read it now.${keep}`,
        forward: 'settings',
      }
    case 'TREE_TRUNCATED':
      // Row F6: no partial vault.
      return { message: unit(`${vault.repo} is too large for the phone. GitHub cut its list of files short, so the phone shows none of its pages.`), forward: 'settings' }
    case 'STORAGE_FULL':
      return { message: 'This phone is full. Free some space, then try again.', forward: 'retry' }
  }
  if (!downloading) return null
  switch (state.problem) {
    case 'RATE_LIMITED':
      // Row N4.
      return {
        message: state.retryAt === null ? 'GitHub asks us to slow down. The download goes on in a few minutes.' : `GitHub asks us to slow down. The download goes on after ${time(state.retryAt)}.`,
        forward: 'retry',
      }
    case 'OFFLINE':
      return { message: 'No internet connection. The download goes on when you are back online.', forward: 'retry' }
    case 'GITHUB_DOWN':
      return { message: 'GitHub is not answering right now. The download goes on when it is back.', forward: 'retry' }
    default:
      return { message: 'The download stopped. Try again.', forward: 'retry' }
  }
}
