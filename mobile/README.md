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

The tests run in vitest, in Node. Storage tests use `fake-indexeddb`. A test that draws React says
`// @vitest-environment jsdom` on its first line. There are no browser tests: no Playwright, no browser window.

## The rule: no Electron, no Node

`mobile/` never imports Electron or Node, and the phone bundle never carries the desktop app, the drawing engine or
the code editor. Three checks hold the rule:

* `mobile/tsconfig.json` has browser types only. `process`, `Buffer` or `require` in `src/` fail the typecheck.
* `importRules.ts` lists what is forbidden. The build fails on it (`phoneImportGuard` in `vite.config.ts`), for
  every bundled module, also one that `client/src` pulls in.
* `src/rules.test.ts` reads the source: no forbidden import, and no browser storage outside `src/store/`.

Config files and tests run in Node, so they may use it.

## What it can import

* `@shared/…`: the pure code in `shared/`, as the desktop renderer imports it.
* `@client/…`: pure parts of `client/src` (the card drawing, the review logic). Bring in only files that do not
  reach the editor, Electron (`window.api`) or the drawing engine. The build tells you if one does.
* React: one copy in the bundle (`dedupe` in `vite.config.ts`), the same version as `client/`.

## Layout

```
mobile/
  index.html            the page
  vite.config.ts        the build: aliases, one React, the import guard
  vitest.config.ts      the `mobile` test project (uses vite.config.ts)
  importRules.ts        what the phone never imports
  src/
    main.tsx, App.tsx   the start; App is a bare placeholder until the screens (4A–4D)
    store/              ALL browser storage. Nothing else touches IndexedDB, localStorage or navigator.storage.
      vaultStore.ts     `VaultStore`: files, checkpoints, phone-only state, the format number, the clears
      backend.ts        the small table interface under it
      idbBackend.ts     IndexedDB: crash-safe writes, opens again after a lost connection
      memoryBackend.ts  memory, for tests (3B–3E use it too)
      vaults.ts         `PhoneVault`, `VaultList`: several vaults; only the open one polls
      persist.ts        `askToKeepStorage()`: `navigator.storage.persist()` at sign-in
      index.ts          the public entry: `openPhoneStore()` and the types
      testing.ts        test help: a backend with a byte limit (a full phone)
```

Where the next units go (from the issues): `src/sync/` (3B, 3C, 3D), `src/store/tokenStore.ts` (3E),
`src/screens/` (4A–4E).

## Storage, in short

* A vault's id is `owner/repo@branch` (`vaultId`). Its files, checkpoint and state are under that id.
* A page, a card file and a settings file are never dropped. When the phone is full, `write` drops the media
  viewed longest ago, in any vault, and says which in `dropped`. With no media left it throws `StorageFullError`.
* Every write resolves only after IndexedDB committed it. Await it before the screen moves on.
* `STORE_FORMAT` is one number. A start with another stored number discards the files and checkpoints and keeps the
  phone-only state (so unsent answers can still go). Raise it when the stored shape changes.
* `resetCopy(vault)` is "Reset local copy". `eraseAll()` is "Sign out and erase this phone"; the token is
  `TokenStore`'s (3E).
