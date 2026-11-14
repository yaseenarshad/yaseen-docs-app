/**
 * The friends cadence (decision 14 on YAZ-5057). The values live in `shared/friendSend.ts`, so the Mac's sender (4E5)
 * uses the same ones.
 * - `PUBLISH_EVERY_MS` (5 minutes): send my numbers at most this often while I review; also when the app goes to the
 *   background.
 * - `FRIENDS_POLL_MS` (1 minute): while the Friends tab is open, read each friend's numbers this often. An unchanged
 *   answer is free.
 */
export { FRIENDS_POLL_MS, PUBLISH_EVERY_MS } from '@shared/friendSend'
