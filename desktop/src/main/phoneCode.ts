/**
 * "CONNECT YOUR PHONE" (YAZ-5098; round 10, item 23), the Mac side: the code the phone's "Scan a code" reads
 * (YAZ-5077, the parser `shared/scanCode.ts` of YAZ-5075). Main does all of it, so the token never goes to a renderer
 * as text: it reads the GitHub token from the secrets store, finds the vault's repo from its git remote `origin`
 * (round 16: a vault is the whole repo), writes the code's text with `formatScanCode`, and encodes it as a QR grid.
 *
 * The code has no `expires`: the end date comes only from GitHub, and this feature sends nothing to the network.
 * Nothing here logs, and no answer holds the token, the code's text or the remote's address (it can hold a password).
 */
import type { PhoneCodeAnswer, PhoneCodeProblem } from '@shared/types'
import { GITHUB_TOKEN_SECRET } from '@shared/types'
import { cleanToken, isBranchName, parseRepo } from '@shared/githubInput'
import { formatScanCode } from '@shared/scanCode'
import { detectRepo } from './git/detect'
import { resolveGit } from './git/exec'
import type { Secrets } from './secrets'

/** What the code needs to know of the vault's folder (`detectRepo`'s facts). */
export interface RepoFactsForPhone {
  isRepo: boolean
  remoteUrl: string | null
  branch: string | null
}

export interface PhoneCodeDeps {
  /** The stored GitHub token, or null. */
  readToken(): Promise<string | null>
  /** The folder's git facts; null when this Mac has no git. */
  repoFacts(root: string): Promise<RepoFactsForPhone | null>
  /** The text as a QR grid. */
  encode(text: string): Promise<boolean[][]>
}

/**
 * `owner/name` of a remote on github.com, or null: an address (`https://github.com/owner/name.git`, with or without a
 * user and password), the SSH forms (`git@github.com:owner/name.git`, `ssh://git@github.com[:22]/owner/name.git`).
 * The host must be github.com itself: not GitHub Enterprise, not an SSH host alias, not `github.com.evil.example`.
 */
export function repoOfRemote(url: string): string | null {
  const m = /^(?:(?:https?|ssh|git\+ssh):\/\/(?:[^@/\s]+@)?(?:www\.)?github\.com(?::\d+)?\/|(?:[^@/:\s]+@)?github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m === null ? null : (parseRepo(`${m[1]}/${m[2]}`)?.full ?? null)
}

/** The QR library (`qr` 0.7.2, the one the phone reads with) loads here, on the first code, never at start. */
export async function encodeQr(text: string): Promise<boolean[][]> {
  const { default: encodeQR } = await import('qr')
  return encodeQR(text, 'raw', { ecc: 'medium' })
}

export async function buildPhoneCode(deps: PhoneCodeDeps, root: string): Promise<PhoneCodeAnswer> {
  const fail = (problem: PhoneCodeProblem): PhoneCodeAnswer => ({ ok: false, problem })
  const stored = await deps.readToken()
  const token = stored === null ? null : cleanToken(stored)
  if (token === null) return fail('no-token')
  const facts = await deps.repoFacts(root)
  if (facts === null) return fail('no-git')
  if (!facts.isRepo) return fail('not-a-repo')
  if (facts.remoteUrl === null) return fail('no-remote')
  const repo = repoOfRemote(facts.remoteUrl)
  if (repo === null) return fail('not-github')
  if (facts.branch === null || !isBranchName(facts.branch)) return fail('no-branch')
  const grid = await deps.encode(formatScanCode({ repo, branch: facts.branch, token, expiresAt: null }))
  return { ok: true, repo, branch: facts.branch, grid }
}

/** The production edges: the app's one secrets store, the git on this Mac, the real encoder. */
export function phoneCodeDeps(secrets: Pick<Secrets, 'read'>): PhoneCodeDeps {
  return {
    readToken: () => secrets.read(GITHUB_TOKEN_SECRET),
    repoFacts: async (root) => {
      const bin = await resolveGit()
      return bin === null ? null : detectRepo(bin, root)
    },
    encode: encodeQr,
  }
}
