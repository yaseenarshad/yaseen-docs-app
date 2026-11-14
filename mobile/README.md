# mobile/ — Notecards, the phone web app

A plain Vite + React + TypeScript web app (YAZ-5055; this workspace is YAZ-5071). It runs in Safari and as a Home
Screen web app. It keeps each vault on the phone, in IndexedDB, and talks only to GitHub. There is no server.

## Run, build, test

From the repo root:

| Command | What it does |
| -- | -- |
| `npm run mobile:dev` | Serves the app at http://localhost:5173 with hot reload. |
| `npm run mobile:build` | Writes the static files to `mobile/dist/` (gitignored), then runs the build check (`publish/checkBuild.ts`). |
| `npx vitest run --project mobile` | Runs this workspace's tests only. `npm test` runs them with all the others. |
| `npm run typecheck` | Checks `mobile/tsconfig.json` (the app) and `mobile/tsconfig.test.json` (tests, config) with the rest. |

The tests run in vitest, in Node. The `mobile` test project uses the build's aliases and one React, but NOT the
build's import guard: tests are never bundled (`testConfig.test.ts` checks this). Storage tests use `fake-indexeddb`. A test that draws React says
`// @vitest-environment jsdom` on its first line. There are no browser tests: no Playwright, no browser window.

## The rule: no Electron, no Node

`mobile/` never imports Electron or Node, and the phone bundle never carries the desktop app, the drawing engine or
the code editor. Three checks hold the rule:

* `mobile/tsconfig.json` has browser types only. `process`, `Buffer` or `require` in `src/` fail the typecheck.
* `importRules.ts` lists what is forbidden. The build fails on it (`phoneImportGuard` in `vite.config.ts`), for
  every bundled module, also one that `client/src` pulls in:
  * by name or path (`forbiddenImport`): Electron, Node built-ins, `desktop/src`, the drawing engine, Monaco, the
    desktop bridge `client/src/api.ts` and the app's storage wrapper `client/src/lib/storage.ts`;
  * by use (`forbiddenUse`), in every repo source file the bundle takes in: the bridge global `window.yaseenDocs` (also
    cast, in brackets or destructured), and
    `localStorage`, `sessionStorage` or `indexedDB` outside `mobile/src/store/`.
* `src/rules.test.ts` reads the source, and every repo file the app reaches through its imports, with the same rules.

Config files and tests run in Node, so they may use it.

## What it can import

* `@shared/…`: the pure code in `shared/`, as the desktop renderer imports it.
* `@client/…`: pure parts of `client/src` (the card drawing, the review logic). Bring in only files that do not
  reach the editor, the desktop bridge (`window.yaseenDocs`, through `client/src/api.ts`), the app's storage wrapper
  or the drawing engine. The build and `src/rules.test.ts` tell you if one does, with the file that does it.
* React: one copy in the bundle (`dedupe` in `vite.config.ts`), the same version as `client/`.

## Layout

```
mobile/
  index.html            the page
  vite.config.ts        the build: aliases, one React, the import guard
  vitest.config.ts      the `mobile` test project (uses vite.config.ts)
  importRules.ts        what the phone never imports
  wrangler.jsonc        the preview site's Worker (static files only)
  publish/              the build check, the service worker build, the headers, the icons, the headless check
  scripts/              opt-in runs against the scratch vault repo (`live*.ts`); never in `npm test`
  src/
    main.tsx, App.tsx   the start: the real services, then the app (4A)
    styles.css          the Mac's colour and font tokens; dark mode follows the iPhone
    app/                4A: the app state and actions (`AppState.tsx`, `useApp()`), the tabs and routes (`nav.ts`),
                        the words and ways forward (`help.ts`), the sync port and the lazy 3B engine (`syncPort.ts`,
                        `lazySync.ts`), Friends' port (`friendsPort.ts`), the vault's word for page (`unitWord.ts`)
    screens/            4A: `Shell`, `SignIn`, `SetupGuide`, `ScanCode`, `Settings`, `FirstDownload`; `Search` is 4C's;
                        `Friends`, `Review` and `SyncStatus` load the tabs of `friends/ui/`, `review/` and `status/`
    sync/               3B: the engine (`engine.ts`: the poll, the passes, one tab at a time), a pass (`pass.ts`), what
                        downloads first (`plan.ts`), the commit (`githubRemote.ts`), the cadence (`cadence.ts`)
    answers/            3C: the answer list (`answers.ts`, `outbox.ts`), the actions (`ops.ts`: `CardOp`), ONE commit
                        for each send (`send.ts`), the phone's review host (`reviewHost.ts`)
    media/              3D: pictures and sounds of the cards due soon, after each pass (`ahead.ts`, `plan.ts`,
                        `refs.ts`); `ui/`: one file's bytes for the screens, and the card drawing (`cardDraw.ts`)
    review/             4B: the Review tab (`ReviewTab.tsx`, `ReviewView.tsx`, `PhoneCard.tsx`, the tap guard)
    status/             4D: the sync dot (`dot.ts`), its button and sheet (`SyncStatus.tsx`, `StatusSheet.tsx`)
    friends/            4E: the friends list (`list.ts`), the numbers sender (`sender.ts`), the gists (`gistsApi.ts`);
                        `ui/`: the Friends tab, "You vs", groups, Cheer and Nudge
    search/             4C: the Mac's search over the phone's index, in slices (`searchRun.ts`), the open vault's
                        data from storage (`vaultData.ts`), what the tab keeps while a page is open (`searchState.ts`)
    page/               4C: a page and a card, read only, with no editor (a lazy chunk): `pageRender.ts` (`marked`
                        and DOMPurify), the vault's look-ups (`pageLook.ts`), pictures, embeds and taps (`pageDom.ts`),
                        `PageView`, `CardView`; one file's bytes come from `media/ui/`
    scan/               "Scan a code": the camera (`camera.ts`) and the reader (`qrDecode.ts`, the `qr` library, a lazy chunk)
    pwa/                YAZ-5087: the service worker, the update and its safe moment, the friend landing page
    dev/                fakes for tests, and the screen fixtures of the `--mode fixtures` build (not in the real build)
    store/              ALL browser storage. Nothing else touches IndexedDB, localStorage or navigator.storage.
                        (The one other case: the service worker's Cache Storage, `pwa/swCore.ts`, holds the app's own files.)
      vaultStore.ts     `VaultStore`: files, checkpoints, phone-only state, the format number, the clears
      backend.ts        the small table interface under it
      idbBackend.ts     IndexedDB: crash-safe writes, opens again after a lost connection
      memoryBackend.ts  memory, for tests (3B–3E use it too)
      vaults.ts         `PhoneVault`, `VaultList`: several vaults; only the open one polls
      persist.ts        `askToKeepStorage()`: `navigator.storage.persist()` at sign-in
      index.ts          the public entry: `openPhoneStorage()` and the types
      testing.ts        test help: a backend with a byte limit (a full phone; every stored byte counts)
      tokenStore.ts     `TokenStore`: one GitHub token for each vault (3E)
    github/
      client.ts         `githubClient`: the ONE way to call GitHub; api.github.com only; typed `GithubError`s
      testing.ts        test help: `fakeGithub`, a fake API behind `fetch` (no test calls the real one)
    auth/               the sign-in logic, no screens (3E)
      check.ts          the check on save: `GET /user`, the repo, the branch, `.yaseendocs` at the top, a write probe (one fixed blob), a Gists probe
      signIn.ts         `startState`, `signIn`, `signInAgain`, `forgetVaultAndToken`, `signOutAndErase`
      account.ts        what the check learned (login, name, avatar, Gists, end date), kept with the vault
      friends.ts        which account acts for friends, and its two alerts
      expiry.ts         the token's end date and the warning before it
      scanCode.ts       "Scan a code": what the Mac's QR code holds (the camera is 4A's)
      input.ts          the typed repo, token and branch, cleaned
```

Screenshots of the screens: `npm run build:fixtures -w mobile`, serve `mobile/dist-fixtures/`, open `#fixture=<name>`.
The names are in `src/dev/fixtures.tsx` and `src/dev/readerFixtures.tsx` (for example `sign-in`, `guide`, `settings`,
`search`, `page`, `card`), and the Review, dot and Friends fixtures come from `review/`, `status/` and `friends/ui/`.

## GitHub and the token, in short

* Call GitHub only through `githubClient(token)` (`src/github/client.ts`). It takes a path, never an address, so the
  token goes to `api.github.com` only, in the Authorization header. It never logs. Its errors never hold the token.
* `openPhoneStorage()` gives the store and the `TokenStore` on one connection. Read a vault's token with
  `tokens.read(vaultId)`; `VaultStore`'s state calls refuse the token's row.
* GitHub hides the header `github-authentication-token-expiration` from web pages (CORS). The phone learns a token's
  end date from the Mac's code only (`scanCode.ts`).

## Storage, in short

* A vault is a whole repo and branch. Its id is `owner/repo@branch` (`vaultId`). Its files, checkpoint and state are
  under that id.
* A page, a card file and a settings file are never dropped. When the phone is full, EVERY write (files,
  checkpoints, phone-only state such as the answer list) drops the media viewed longest ago and tries again (row P2).
  It says which in `dropped`. When that cannot help, it throws `StorageFullError`.
* A write takes room from its own vault's media first, then from the other vaults' media, oldest view first (a
  coordinator pick for Yaseen to confirm). It drops one file at a time and tries again, so it drops only what the
  write needs. A file write drops nothing when all the media that may go is smaller than the bytes it adds. The store
  does not use `navigator.storage.estimate()`: it gives the browser's quota, not the free disk.
* Every write resolves only after IndexedDB committed it. Await it before the screen moves on.
* `STORE_FORMAT` is one number. A start with another stored number discards the files and checkpoints and keeps the
  phone-only state (so unsent answers can still go). Raise it when the stored shape changes.
* `resetCopy(vault)` is "Reset local copy". `eraseAll()` is "Sign out and erase this phone"; the token is
  `TokenStore`'s (3E).

## The home-screen app (YAZ-5087)

* **Manifest and head:** `public/manifest.webmanifest` ("Notecards", `standalone`, start and scope `/`) and the iOS tags in
  `index.html` (the 180 px icon, the status bar, `viewport-fit=cover`, `theme-color` for light and dark,
  `color-scheme`, a splash picture for each iPhone size in light and dark). `publish/site.test.ts` checks them.
* **Icons and splash pictures:** made from ONE drawing (`iconSvg` in `publish/images.ts`) by
  `npx vite-node mobile/publish/makeIcons.ts` (Chrome with no window draws the icons; the splash pictures are one
  colour). The final icon art is Yaseen's call: change `iconSvg`, run the script again.
* **Service worker** (`src/pwa/`, hand-written): `swCore.ts` is the logic, `sw.ts` the file, `publish/pwaPlugin.ts`
  writes `dist/sw.js` with the build's file list. It keeps the app's own files only: the pages, ALL chunks (the lazy
  sync engine and QR reader too, so they work offline), the manifest, the icons (the build check prints the size). It
  never touches a request to another origin (GitHub, avatars) or a write. A new version installs whole or not at all.
  A version's cache stays while any open page runs that version (each page open notes its version; YAZ-5303), so an
  open page of an old version still loads its lazy chunks; with no page of it left, the next open removes it.
* **Updates** (`src/pwa/updates.ts`, `safeMoment.ts`, `UpdateLine.tsx`): a new version downloads in the background.
  It takes over at the next open, before the app runs (`main.tsx`), or after "A new version is ready." → Restart, or
  when the app comes back after 5 minutes away; never while answers wait to be sent, never on the Review tab or over
  a form unless the person taps Restart.
* **Shared links:** `https://<site>/friend#<code>`, `/group#<code>` and `/join#<group>-<pointer>` (`src/pwa/friendLink.ts`:
  `friendLink`, `groupLinkFor`, `joinLinkFor`, `landingCodeFrom`). The code is after `#`, so no server sees it. One landing
  page for Safari (`friend.html`, also built as `group.html` and `join.html`): "Copy this code. Open the app. Tap Paste.",
  with words for each kind. Every link uses the site the app runs on (`location.origin`), never a fixed host.
* **Headers:** `public/_headers` (the CSP, `Referrer-Policy: no-referrer`, `nosniff`, the camera for this site only,
  `Strict-Transport-Security: max-age=31536000`, the cache rules; no long cache under `/assets/`, because Cloudflare
  answers a missing chunk with the app page). `publish/headers.test.ts` fails when the code calls an origin that the CSP does not name, or the CSP
  names more.
* **Build check:** `npm run mobile:build` ends with `publish/checkBuild.ts`: no screen fixtures, no `localhost`, no
  source maps, no token in `dist/`; every publish part there; the size report.
* **Headless check:** `npx vite-node mobile/publish/proveOffline.ts` (after the build). Chrome with no window opens the
  build on a local copy of the host (`publish/serve.ts`): zero CSP violations, the worker installs, the app opens with
  the host down, a new version takes over at the next open, a broken deploy never installs.

## How to publish

The preview site is `https://preview.notecards.yaseenarshad.com` (Worker `yaseen-notecards-preview`, `wrangler.jsonc`).
Publish only when Yaseen says so (round 15). From the repo root, signed in to Cloudflare (`npx wrangler whoami`):

```
npm run mobile:publish:preview
```

It builds `mobile/dist/` (with the build check), copies the live build's chunks that the new build does not have into
`mobile/dist/assets/` (`npm run mobile:keep-previous`, read-only GETs of the live site; YAZ-5303: an open page of the old
version can still ask the host for them during a swap), then runs `npx --yes wrangler@4.162.0 deploy --config mobile/wrangler.jsonc`.
Wrangler is not a dependency of the repo; `npx` fetches that exact version. To see what it would send without
sending it: `npx --yes wrangler@4.162.0 deploy --config mobile/wrangler.jsonc --dry-run`.

The Worker has no script: Cloudflare serves the files of `dist/` and applies `_headers`. No request reaches code of
ours, so nothing logs an address. The stable site `notecards.yaseenarshad.com` is NOT in this config: it publishes on
a version tag, when Yaseen says (decision 8, round 10 item 16).

## If a bad version ships

Decide which part is bad, then do ONE of these. Publish to the preview only, as above.

**1. The page or a screen is bad; the update works.** Roll the Worker back to the last good version. The phones see a
new `sw.js` (its version differs) and take the old build as a new version at their next open.

```
npx --yes wrangler@4.162.0 versions list --config mobile/wrangler.jsonc
npx --yes wrangler@4.162.0 rollback <version-id> --config mobile/wrangler.jsonc --message "bad build <commit>"
```

`/version.txt` names the commit of each build. The other way: check out the last good commit and run
`npm run mobile:publish:preview`.

**2. The service worker or the update code is bad** (a fixed version installs but never takes over). Publish the kill switch:

```
npm run mobile:publish:preview:kill-switch
```

It builds the site with `src/pwa/swKill.ts` (the logic is `killSwitch.ts`) as `sw.js` (`NOTECARDS_KILL_SWITCH=1`, read by `publish/pwaPlugin.ts`). That worker takes over at once with no page message. It
deletes only this app's shell caches (`notecards-shell-*`, `notecards-meta`), unregisters itself, and loads each open
page again one time. It never touches IndexedDB: the token, the vault copy and the waiting answers stay. Then fix the
bug and run `npm run mobile:publish:preview`. The app registers its normal worker again at the next open.

**On a broken phone:** close Notecards in the app switcher (swipe it up), then open it again; do it two times. A new
worker takes over when no page of the old one is open. Do NOT remove the site's data in Settings (Safari › Advanced ›
Website Data): that deletes IndexedDB, with the token and the answers that wait to be sent.
