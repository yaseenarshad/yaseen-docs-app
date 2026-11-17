import { execFileSync } from 'node:child_process'

/**
 * YAZ-5645 GHF: "Sign in with GitHub" needs the Worker secret `GITHUB_CLIENT_SECRET`. On 2026-11-16 it was put while
 * the Worker was still static files only; the next static-only deploys replaced the Worker without it, so the live
 * token route answered `not_set_up` and every sign-in failed after the round trip. The publish now checks the NAME
 * before the deploy (stop: nothing ships) and after it (a deploy that dropped it is said at once). Only names are read
 * (`wrangler secret list`); no value is ever read or printed.
 */
export const WORKER_SECRET = 'GITHUB_CLIENT_SECRET'
export const PUT_SECRET = `npx --yes wrangler@4.162.0 secret put ${WORKER_SECRET} --config mobile/wrangler.jsonc`

/** The secret names in `wrangler secret list`'s answer (a JSON list of `{ name, type }`), or null when it is not one. */
export function secretNames(listed: string): string[] | null {
  const start = listed.indexOf('[')
  const end = listed.lastIndexOf(']')
  if (start === -1 || end < start) return null
  try {
    const list: unknown = JSON.parse(listed.slice(start, end + 1))
    if (!Array.isArray(list)) return null
    return list.flatMap((s) => (s !== null && typeof s === 'object' && typeof (s as { name?: unknown }).name === 'string' ? [(s as { name: string }).name] : []))
  } catch {
    return null
  }
}

/** What the publish says; `ok: false` stops it. */
export function secretVerdict(listed: string, when: 'before' | 'after'): { ok: boolean; say: string } {
  const names = secretNames(listed)
  if (names === null) return { ok: false, say: `worker-secret: could not read the Worker's secret names (is wrangler signed in?). Nothing ${when === 'before' ? 'was published' : 'is known'}.` }
  if (names.includes(WORKER_SECRET)) return { ok: true, say: `worker-secret: ${WORKER_SECRET} is set on the Worker (${when} the deploy).` }
  const fix = `Put it (paste the GitHub App's client secret at the prompt, never in chat): ${PUT_SECRET}`
  return when === 'before'
    ? { ok: false, say: `worker-secret: the Worker has no ${WORKER_SECRET}, so "Sign in with GitHub" cannot work. Nothing was published. ${fix}` }
    : { ok: false, say: `worker-secret: the deploy is live, but the Worker has no ${WORKER_SECRET} now, so "Sign in with GitHub" fails. ${fix}` }
}

/** `npm run mobile:check-secret -- before|after`. */
export function main(argv: readonly string[]): number {
  const when = argv.includes('after') ? 'after' : 'before'
  let listed = ''
  try {
    listed = execFileSync('npx', ['--yes', 'wrangler@4.162.0', 'secret', 'list', '--config', 'mobile/wrangler.jsonc'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    listed = ''
  }
  const verdict = secretVerdict(listed, when)
  ;(verdict.ok ? console.log : console.error)(verdict.say)
  return verdict.ok ? 0 : 1
}
