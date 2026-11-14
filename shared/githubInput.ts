/** What the person types or pastes on the sign-in screen (decision 13), cleaned and checked before any call. */

export interface RepoName {
  owner: string
  name: string
  /** `owner/name`, as typed. GitHub gives the exact case later (`full_name`). */
  full: string
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const NAME = /^[A-Za-z0-9._-]{1,100}$/

/**
 * `owner/name`, or a GitHub address of the repo (`https://github.com/owner/name`, `.git`, a `/tree/…` tail),
 * because people copy it from the browser. Null when it is not a repo name.
 */
export function parseRepo(text: string): RepoName | null {
  let rest = text.trim()
  const address = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.*)$/i.exec(rest)
  if (address) {
    const parts = address[1].split('/')
    rest = parts.length >= 2 ? `${parts[0]}/${parts[1].replace(/\.git$/i, '')}` : address[1]
  }
  const parts = rest.split('/')
  if (parts.length !== 2) return null
  const [owner, name] = parts
  if (!OWNER.test(owner) || !NAME.test(name) || name === '.' || name === '..') return null
  return { owner, name, full: `${owner}/${name}` }
}

/**
 * The pasted token with the spaces and line breaks around it taken off; null when it cannot be a GitHub token.
 * Every GitHub token is letters, digits and `_` (`github_pat_…` is about 93 characters, `ghp_…` 40).
 */
export function cleanToken(text: string): string | null {
  const token = text.trim()
  return /^[A-Za-z0-9_]{20,255}$/.test(token) ? token : null
}

/** A name git accepts for a branch (the rules of `git check-ref-format`, for one branch name). */
export function isBranchName(name: string): boolean {
  if (name === '' || name === '@' || name.length > 255) return false
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false
  if (/[\u0000- \u007f~^:?*[\\]/.test(name)) return false
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false
  return name.split('/').every((part) => part !== '' && !part.startsWith('.'))
}
