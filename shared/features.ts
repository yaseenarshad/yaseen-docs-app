/**
 * Switches for whole features, one place for the Mac and the phone.
 *
 * `FRIENDS_ENABLED` (YAZ-6200): Friends is enabled on both Mac and Phone via the Cloudflare Worker + D1 API.
 * Tests that verify off-flag behavior mock `@shared/features` with `{ FRIENDS_ENABLED: false }`.
 */
export const FRIENDS_ENABLED: boolean = true
