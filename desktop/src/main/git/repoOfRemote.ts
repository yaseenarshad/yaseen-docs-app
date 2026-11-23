/**
 * A vault's GitHub repo from its git remote `origin` (round 16: a vault is the whole repo). The friends sender
 * (YAZ-5086) names each vault by it. Moved from `main/phoneCode.ts` when "Connect your phone" went (YAZ-5650), unchanged.
 */
import { parseRepo } from '@shared/githubInput'

/**
 * `owner/name` of a remote on github.com, or null: an address (`https://github.com/owner/name.git`, with or without a
 * user and password), the SSH forms (`git@github.com:owner/name.git`, `ssh://git@github.com[:22]/owner/name.git`).
 * The host must be github.com itself: not GitHub Enterprise, not an SSH host alias, not `github.com.evil.example`.
 */
export function repoOfRemote(url: string): string | null {
  const m = /^(?:(?:https?|ssh|git\+ssh):\/\/(?:[^@/\s]+@)?(?:www\.)?github\.com(?::\d+)?\/|(?:[^@/:\s]+@)?github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim())
  return m === null ? null : (parseRepo(`${m[1]}/${m[2]}`)?.full ?? null)
}
