# mobile/ — Notecards, the phone web app

A plain Vite + React + TypeScript web app (YAZ-5055; this workspace is YAZ-5071). It runs in Safari and as a Home
Screen web app. It keeps each vault on the phone, in IndexedDB, and talks only to GitHub. There is no server.

## Run, build, test

From the repo root:

| Command | What it does |
| -- | -- |
| `npm run mobile:dev` | Serves the app at http://localhost:5173 with hot reload. |
| `npm run mobile:build` | Writes the static files to `mobile/dist/` (gitignored). |
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
  src/
    main.tsx, App.tsx   the start: the real services, then the app (4A)
    styles.css          the Mac's colour and font tokens; dark mode follows the iPhone
    app/                4A: the app state and actions (`AppState.tsx`, `useApp()`), the tabs and routes (`nav.ts`),
                        the words and ways forward (`help.ts`), the sync port and the lazy 3B engine (`syncPort.ts`,
                        `lazySync.ts`), Friends' port (`friendsPort.ts`), the vault's word for page (`unitWord.ts`)
    screens/            4A: `Shell`, `SignIn`, `SetupGuide`, `ScanCode`, `Settings`, `FirstDownload`; the slots
                        `Friends`, `Review` (4E, 4B) and `SyncStatus` (4D) are placeholders; `Search` is 4C's
    search/             4C: the Mac's search over the phone's index, in slices (`searchRun.ts`), the open vault's
                        data from storage (`vaultData.ts`), what the tab keeps while a page is open (`searchState.ts`)
    page/               4C: a page and a card, read only, with no editor (a lazy chunk): `pageRender.ts` (`marked`
                        and DOMPurify), the vault's look-ups (`pageLook.ts`), pictures, embeds and taps (`pageDom.ts`),
                        one file's bytes (`media.ts`: the store until 3D's `MediaAhead` is wired), `PageView`, `CardView`
    scan/               "Scan a code": the camera (`camera.ts`) and the reader (`qrDecode.ts`, the `qr` library, a lazy chunk)
    dev/                fakes for tests, and the screen fixtures of the `--mode fixtures` build (not in the real build)
    store/              ALL browser storage. Nothing else touches IndexedDB, localStorage or navigator.storage.
      vaultStore.ts     `VaultStore`: files, checkpoints, phone-only state, the format number, the clears
      backend.ts        the small table interface under it
      idbBackend.ts     IndexedDB: crash-safe writes, opens again after a lost connection
      memoryBackend.ts  memory, for tests (3B–3E use it too)
      vaults.ts         `PhoneVault`, `VaultList`: several vaults; only the open one polls
      persist.ts        `askToKeepStorage()`: `navigator.storage.persist()` at sign-in
      index.ts          the public entry: `openPhoneStore()` and the types
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

Where the next units go (from the issues): `src/sync/` (3C, 3D), `src/screens/` (4B–4E: replace the slot files).

Screenshots of the screens: `npm run build:fixtures -w mobile`, serve `mobile/dist-fixtures/`, open `#fixture=<name>`
(`sign-in`, `sign-in-error`, `guide`, `scan`, `download`, `review`, `settings`, `erase`, `token-ended`; 4C: `search`,
`search-typed`, `search-type`, `search-none`, `page`, `page-lower`, `card`, `card-file`, `card-invalid`).

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
