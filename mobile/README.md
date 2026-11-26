# mobile/ — Notecard, the phone web app

A plain Vite + React + TypeScript web app (YAZ-5055; this workspace is YAZ-5071). It keeps each vault on the device,
in IndexedDB, and talks only to GitHub. There is no server.

## Where it runs (YAZ-5644, the web version)

* **Any browser tab:** a phone, a tablet or a computer (Chrome, Safari, Firefox). A tab runs the whole app: the
  sign-in, the vault on the device, the offline worker, the update line. The person chooses the tab, the Home Screen
  app, or both.
* **Add to Home Screen** is a choice. On a phone's or a tablet's tab, a light hint at the top of the sign-in and of
  Settings says so (`src/screens/InstallHint.tsx`, `hintKind` in `src/pwa/homeScreen.ts`): "How" shows the steps, ✕
  hides it for this browser. No hint on a computer or in the Home Screen app.
* **Two copies are fine.** On iOS, Safari and the Home Screen app keep their data apart: each is its own copy of the
  vault, signed in on its own. Both may write: every write is one compare-and-swap commit, again on the newest file
  when the other copy wrote first. Tabs of one browser share one copy; Web Locks let one tab sync a vault at a time.
* **A computer (or a tablet):** from a window 720 px wide and 560 px tall, the phone layout is a centred column of
  640 px (`styles.css`); sheets, menus and the full-screen table stay inside it. A phone on its side keeps the full
  width. Review takes keys: Space or Enter shows the next part, 1 to 4 answer (`src/review/keys.ts`).
* **The sign-in** is one screen, `src/screens/SignIn.tsx` (first sign-in, Add vault, Sign in again). "Sign in with
  GitHub" (YAZ-5645) replaces its token form there.
* **Safari's 7-day rule:** Safari may delete a site's data after 7 days of Safari use without a visit (not in the
  Home Screen app). The person then sees the sign-in screen, signs in, and the vault downloads again. Only answers that
  were never sent are lost.
* **No storage** (some Private Browsing): the app says so in one message (`NoStorage`, `src/App.tsx`).

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
the code editor. One exception (YAZ-5440): the drawing engine lives in ONE lazy chunk, `src/drawing/engine/`, which
draws a page's Excalidraw drawings with the Mac's own picture code (`client/src/drawings/drawingPicture.ts`), in memory
only (nothing is saved). Only that folder may import it; `src/drawingWall.test.ts` proves it in the build (not in the
first load, the reader's chunk or Review), and `drawingChunkTrim` in `vite.config.ts` keeps the engine's editor extras
(Mermaid, the WebAssembly font cutter, the languages) off the phone. YAZ-5533, draw.io: a plain `.drawio` is drawn by draw.io's
own read-only viewer (`viewer-static.min.js`, the Mac's verified v31.5.2 pack; `publish/drawioPhone.ts` fails the build
when the phone's release is not the Mac's) and the Mac's `yaseen-render.js`, unchanged, in ONE hidden same-origin frame
(`/drawio/<hash>/render`, `mobile/drawio/`) with its own strict CSP. They are files, not chunks; the app's side is one
small lazy chunk (`src/drawing/diagram/`). None of it is in the first load or the install (below). Three checks hold the rule:

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
  wrangler.jsonc        the phone app's Worker, docs.yaseenarshad.com (static files only)
  publish/              the build check, the service worker build, the headers, the icons, the headless check
  scripts/              opt-in runs against the scratch vault repo (`live*.ts`); never in `npm test`
  src/
    main.tsx, App.tsx   the start: the real services, then the app (4A)
    styles.css          the Mac's colour and font tokens; dark mode follows the iPhone
    app/                4A: the app state and actions (`AppState.tsx`, `useApp()`), the tabs and routes (`nav.ts`),
                        the words and ways forward (`help.ts`), the sync port and the lazy 3B engine (`syncPort.ts`,
                        `lazySync.ts`), Friends' port (`friendsPort.ts`), the vault's word for page (`unitWord.ts`)
    screens/            4A: `Shell`, `SignIn`, `SetupGuide`, `Settings`, `FirstDownload`; `Search` is 4C's;
                        `Friends`, `Review` and `SyncStatus` load the tabs of `friends/ui/`, `review/` and `status/`
    sync/               3B: the engine (`engine.ts`: the poll, the passes, one tab at a time), a pass (`pass.ts`), what
                        downloads first (`plan.ts`), the commit and the batch download of text files (YAZ-5929, GraphQL)
                        (`githubRemote.ts`), the cadence (`cadence.ts`)
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

## Sign in with GitHub (YAZ-5645)

* The GitHub App `yaseen-docs` (client ID in `src/auth/githubAppConfig.ts`, public). The web flow with PKCE and state
  (`src/auth/githubApp.ts`, its own chunk): the app goes to GitHub in the same window, GitHub sends it back to
  `/auth/callback`, the app checks the state, and the Worker swaps the code for the token pair.
* The Worker (`worker/index.ts`) runs first only for `POST /api/github/{token,refresh,revoke}` (`run_worker_first`); every
  other path is the static files. It adds the client secret `GITHUB_CLIENT_SECRET`, a Worker secret
  (`npx wrangler secret put GITHUB_CLIENT_SECRET --config mobile/wrangler.jsonc`). It stores and logs nothing.
* The pair stays on the device (`TokenStore`, one pair for each GitHub account; a vault links to its account).
  `tokens.read(vault)` refreshes 5 minutes before the 8 hours end, one tab at a time; the sync renews once after a 401.
* On a computer: `npm run mobile:dev` answers the Worker's routes too, with the secret from `mobile/.dev.vars`
  (`GITHUB_CLIENT_SECRET=…`, git-ignored). The app's localhost callback is `http://localhost:5173/auth/callback`.
* "Use a token instead" keeps the pasted-token sign-in (decision D4).

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

* **Manifest and head:** `public/manifest.webmanifest` ("Notecard", `standalone`, start and scope `/`) and the iOS tags in
  `index.html` (the 180 px icon, the status bar, `viewport-fit=cover`, `theme-color` for light and dark,
  `color-scheme`, a splash picture for each iPhone size in light and dark). `publish/site.test.ts` checks them.
* **Icons and splash pictures:** made from ONE drawing (`iconSvg` in `publish/images.ts`) by
  `npx vite-node mobile/publish/makeIcons.ts` (Chrome with no window draws the icons; the splash pictures are one
  colour). The final icon art is Yaseen's call: change `iconSvg`, run the script again.
* **Service worker** (`src/pwa/`, hand-written): `swCore.ts` is the logic, `sw.ts` the file, `publish/pwaPlugin.ts`
  writes `dist/sw.js` with the build's file list. It keeps the app's own files only: the pages, ALL chunks (the lazy
  sync engine and QR reader too, so they work offline), the manifest, the icons (the build check prints the size). It
  never touches a request to another origin (GitHub, avatars) or a write. A new version installs whole or not at all.
  NOTHING about draw.io is in the install (YAZ-5533, Yaseen: draw.io must not bloat the app): its files
  (`/drawio/<hash>/…`: the viewer, the renderer page, one file per shape library and per font family) and the app's
  diagram chunk are fetched from this site the first time a diagram is opened, only what that diagram uses, and kept
  from then on in `notecards-drawio-<hash>` (an update that does not change them keeps them). Before that, with no
  signal, a diagram says "Diagrams need the internet the first time; then they work offline"; a shape library not
  fetched yet draws as placeholder boxes until the phone is online.
  A version's cache stays while any open page runs that version (each page open notes its version; YAZ-5303), so an
  open page of an old version still loads its lazy chunks; with no page of it left, the next open removes it.
* **Updates** (`src/pwa/updates.ts`, `safeMoment.ts`, `UpdateLine.tsx`, `swCore.ts`): a new version downloads in the
  background. It runs ONLY after the person taps Restart (YAZ-5555, Yaseen's decision): never by itself, not at a cold
  start, not when the app comes back, not after a while. Whenever a new version is there, "A new version is ready."
  shows over the tabs with Restart; the update state is read at the start and at each return, so it shows on a cold
  start and on return. The browser activates a waiting worker by itself once no page of the old one is open, so the
  worker keeps THE CHOSEN VERSION: page opens get its page until the Restart's load (`?notecards-update=1`, removed
  from the address at the start) chooses the newest; the page asks the worker by a message ({ active, chosen }; the CSP lets the page fetch only GitHub). Restart
  works on any tab and over waiting comments; it never runs while answers wait, a comment box holds words, or the
  first download runs: the line then says why ("Restart after your answers are sent."). The rule is written once, at
  the top of `safeMoment.ts`; keep this paragraph in step with it. Settings shows the running build at its top
  ("Build bb8a4aa30 · 15 Nov, 14:02": the commit as `/version.txt` names it, the same in the Version row), then the
  address the app runs from and **Check for updates** (YAZ-5593, `src/settings/UpdateCheck.tsx`): it asks the host
  now (`update()`, and `/version.txt` read by the worker with no cache: `VERSION_ASK`) and says "You have the newest
  build (…)", the same "A new version is ready." line with Restart (the same holds), or "Can't reach the server. Open
  the app from docs.yaseenarshad.com." (offline, or a host that no longer serves the app). It never restarts.
  **Keep this.** It is how an installed home-screen app gets each new build: a person never has to delete and add the
  app again. Every publish must keep `UpdateLine.tsx` ("A new version is ready." → Restart), the `no-cache` rule on
  `sw.js`, and `updateViaCache: "none"`. To test it: publish, close the app, open it again; the line shows, then Restart.
* **Shared links:** `https://<site>/friend#<code>`, `/group#<code>` and `/join#<group>-<pointer>` (`src/pwa/friendLink.ts`:
  `friendLink`, `groupLinkFor`, `joinLinkFor`, `landingCodeFrom`). The code is after `#`, so no server sees it. One landing
  page for Safari (`friend.html`, also built as `group.html` and `join.html`): "Copy this code. Open the app. Tap Paste.",
  with words for each kind. Every link uses the site the app runs on (`location.origin`), never a fixed host.
* **Headers:** `public/_headers` (the CSP, `Referrer-Policy: no-referrer`, `nosniff`, no camera,
  `Strict-Transport-Security: max-age=31536000`, the cache rules; no long cache under `/assets/`, because Cloudflare
  answers a missing chunk with the app page). `publish/headers.test.ts` fails when the code calls an origin that the CSP does not name, or the CSP
  names more.
* **draw.io's frame:** `/drawio/*` has its own policy (`script-src 'self'`, `connect-src 'none'`, pictures from `data:`
  and `blob:` only, no frame, no form) and the one exception the app needs: `frame-ancestors 'self'` (every other path
  keeps `'none'`). Its shim takes away the frame's IndexedDB, storage, caches, cookies and service worker.
* **draw.io proofs:** `npx vite-node mobile/publish/proveDiagrams.ts` (after `npm run mobile:build` and
  `npm run build:fixtures -w mobile`): the made-up diagrams draw in Chromium and WebKit, light and dark; nothing leaves
  the site; hostile labels run nothing; the pixel check against the Mac's renderer; offline with the real worker.
* **Build check:** `npm run mobile:build` ends with `publish/checkBuild.ts`: no screen fixtures, no `localhost`, no
  source maps, no token in `dist/`; every publish part there; the size report.
* **Headless check:** `npm run mobile:prove-offline` (it builds first; `publish/proveOffline.ts`). Chrome with no window opens the
  build on a local copy of the host (`publish/serve.ts`), as a plain browser tab: zero CSP violations, the worker
  installs, the storage opens, the app opens with the host down, a new version takes over at the next open, a broken
  deploy never installs; the same build as the Home Screen app. Run it after a change to
  the service worker, the headers or the update flow.
* **Layout check:** `npm run mobile:prove-layout` (it builds the fixtures first; `publish/proveLayout.ts`). Chrome with
  no window, at the phone sizes, light and dark: the asks, tables, calendar, tasks, reading look, sheets and folder
  pages sit inside the screen and the page never scrolls sideways. At 1280 x 800 (a computer): the centred column and
  everything inside it; the phone's install hint. Run it after a change to a screen's layout.
* **Sheet drag check (YAZ-5472):** `npm run mobile:prove-smooth` (it builds the fixtures first; `publish/proveSmooth.ts`).
  Chrome with no window drags a sheet with touch and reports layouts, frame gaps and late frames, and where the sheet
  ends. Run it after a change to the sheets or their drag.
* **Edge Back check (YAZ-5499):** `npm run mobile:prove-edge-back` (it runs inside `mobile:publish:preview`, before the
  upload). Chrome with no window, at an iPhone's 390 x 844 with touch: a real swipe from x = 5 to x = 200 on a page and
  a card (on the text, under the top bar, on the page arrows). In the Home Screen app the swipe goes back; in a Safari
  tab it does nothing, and the browser's Back (Safari's own edge swipe) shows the screen under. A failure stops the publish.

## How to publish

The phone app is at `https://docs.yaseenarshad.com` (YAZ-5579), a custom domain of ONE Worker (`yaseen-notecards-preview`,
`wrangler.jsonc`; the name stays from the preview days). The old preview addresses (`preview.docs.yaseenarshad.com`,
`preview.notecard.yaseenarshad.com`) no longer serve the app; links made on them still paste. A phone keeps its token,
vault copy and waiting answers per address, so an app installed from an old address must be added again from the new one.

**Always publish when merging to `main`:** Merging a PR to `main` (or cutting a Mac release) does NOT update Cloudflare
automatically, and `mobile/` shares `shared/` and `client/` code with Desktop. Every time you push or merge to `main`,
publish the phone app from a clean checkout of that `origin/main` commit, after `npm ci && npm run engine:build && npm run drawio:pack`,
while signed in to Cloudflare (`npx wrangler whoami`). Do not wait to be asked, and do not skip it by guessing whether a
change touches `mobile/`. Then confirm `curl -s https://docs.yaseenarshad.com/version.txt` matches the merged commit:

```
npm run mobile:publish:preview
```

It builds `mobile/dist/` (with the build check), copies the live build's chunks that the new build does not have into
`mobile/dist/assets/` (`npm run mobile:keep-previous`, read-only GETs of the live site; YAZ-5303: an open page of the old
version can still ask the host for them during a swap), checks that the Worker has the secret `GITHUB_CLIENT_SECRET`
(`npm run mobile:check-secret -- before`; names only, never a value: with no secret it stops and nothing is published),
then runs `npx --yes wrangler@4.162.0 deploy --config mobile/wrangler.jsonc`, then checks the secret again
(`-- after`). YAZ-5645: the secret was once put while the Worker had no script, and the next deploys dropped it, so
"Sign in with GitHub" failed after the round trip. To put it: `npx --yes wrangler@4.162.0 secret put GITHUB_CLIENT_SECRET
--config mobile/wrangler.jsonc` and paste the GitHub App's client secret at the prompt (never in chat or Linear).
Wrangler is not a dependency of the repo; `npx` fetches that exact version. To see what it would send without
sending it: `npx --yes wrangler@4.162.0 deploy --config mobile/wrangler.jsonc --dry-run`.

Cloudflare serves the files of `dist/` and applies `_headers`. Only `/api/github/*` reaches code of ours
(`worker/index.ts`, YAZ-5645), and it logs nothing. The real address `docs.yaseenarshad.com` is a custom domain of the same Worker
(YAZ-5579).

## If a bad version ships

Decide which part is bad, then do ONE of these. Publish as above.

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

**On a broken phone:** close Yaseen Docs in the app switcher (swipe it up), then open it again; do it two times. A new
worker takes over when no page of the old one is open. Do NOT remove the site's data in Settings (Safari › Advanced ›
Website Data): that deletes IndexedDB, with the token and the answers that wait to be sent.
