/**
 * Switches for whole features, one place for the Mac and the phone.
 *
 * `FRIENDS_ENABLED` (YAZ-5652): Friends is off for now. The GitHub App that signs in (YAZ-5645) has no Gists
 * permission, and Friends keeps its numbers in gists. The code stays; with the switch off:
 * - the phone shows no Friends tab, no Friends part in Settings, and a friend link opens "Friends is off for now";
 *   no friends list, sender or gist call (the sign-in makes no Gists check either);
 * - the Mac shows no Friends row in Settings (the GitHub token row stays: Mac sync uses it), and main never starts
 *   the friends sender, so it makes no gist call. With the switch a `false` constant, the build drops the sender.
 * Tests turn it on with `vi.mock('@shared/features', () => ({ FRIENDS_ENABLED: true }))`.
 */
export const FRIENDS_ENABLED: boolean = false
