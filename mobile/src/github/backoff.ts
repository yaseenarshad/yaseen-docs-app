import { MAX_RATE_WAIT_MS, MIN_RATE_WAIT_MS, rateLimitedUntil, type GithubError } from './client'

/*
 * The ONE backoff (YAZ-5092 A4) of the sync engine, the answer list and the comment list. Its own module, so the first
 * load (which holds `client.ts`) does not carry it.
 */

/** The wait after `inRow` (1, 2, 3 …) of the same failure in a row: the floor, doubled each time, up to the ceiling. */
export const backoffMs = (inRow: number): number => Math.min(MAX_RATE_WAIT_MS, MIN_RATE_WAIT_MS * 2 ** Math.min(inRow - 1, 16))

/**
 * After a "slow down" (`RATE_LIMITED`, YAZ-5169): GitHub's time or the backoff, the later one, held between the floor
 * and the ceiling, so a reset time in the past cannot loop.
 */
export function slowedUntil(error: GithubError, inRow: number, now: number): number {
  const given = (error.resetAt ?? now) - now
  return now + Math.min(MAX_RATE_WAIT_MS, Math.max(MIN_RATE_WAIT_MS, given, backoffMs(inRow)))
}

/** After a branch that kept moving (`STALE_HEAD`, YAZ-5183): 1, 2, 4 … minutes, up to 1 hour. */
export const staleUntil = (inRow: number, now: number): number => rateLimitedUntil(now + backoffMs(inRow), now)
