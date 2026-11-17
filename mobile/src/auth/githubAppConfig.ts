/**
 * "Sign in with GitHub" (YAZ-5645): the one GitHub App, its public names and the Worker's three routes. The app and the
 * Worker (`mobile/worker/index.ts`) both read this file. Nothing here is a secret: the client secret lives only in the
 * Worker (`GITHUB_CLIENT_SECRET`, a Worker secret; `.dev.vars` on a computer), never in this repo or the app's files.
 */

/** github.com/apps/yaseen-docs. Contents read/write, Metadata read (decision D1; Gists off for now). */
export const GITHUB_APP_CLIENT_ID = 'Iv23liJoJKth4kXFlH6a'
export const GITHUB_APP_SLUG = 'yaseen-docs'

/** GitHub sends the person back here after the sign-in (the app's two callback addresses, decision D8). */
export const CALLBACK_PATH = '/auth/callback'
/** The Setup URL: GitHub sends the person back here after "choose repos" (decision D2). */
export const INSTALLED_PATH = '/auth/installed'

/** The sites GitHub may send the person back to: the real one, and the dev server on a computer (D8). */
export const CALLBACK_ORIGINS = ['https://docs.yaseenarshad.com', 'http://localhost:5173'] as const

/** The Worker's routes (decision D3: the same Worker and address as the app). POST only, same site only. */
export const WORKER_TOKEN = '/api/github/token'
export const WORKER_REFRESH = '/api/github/refresh'
export const WORKER_REVOKE = '/api/github/revoke'

/** GitHub's pages the person opens (navigations, never calls). */
export const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize'
export const GITHUB_CHOOSE_REPOS = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`
