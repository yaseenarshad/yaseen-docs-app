# Development — how to run, build and test this app (for humans and agents)

Yaseen Docs: a local markdown editor as an Electron desktop app for macOS and Windows — React + Milkdown Crepe renderer, main-process file layer. See `README.md` for the short tour, `docs/FEATURES.md` for every feature, and `docs/CONTRACTS.md` for the bridge and editor contracts.

## Dev loop (do this when asked to "run it")

```bash
npm install
npm run dev
```

- `npm run dev` runs `electron-vite dev` in `desktop/`: it builds main + preload, serves the renderer with HMR and launches the Electron app — one command, and the remembered windows of the vault used last reopen (Settings › Files & Links › When the app starts › Reopen chooses: all vaults, the last vault, or none). There is no server of any kind and nothing listens for the app itself on any port (the only network socket is electron-vite's private HMR channel in dev); renderer ↔ main is the typed `window.yaseenDocs` bridge.
- Yasin's vault is `$HOME/Documents/GitHub/yaseen-docs-vault` — a git repo the app's GitHub sync pushes to (the username part of `$HOME` differs per machine — resolve it, don't hardcode). The app repo itself is `yaseen-docs-app`; the vault is `yaseen-docs-vault`. If a window opens the wrong folder, click the vault name in the sidebar header (or ⌘O) and choose **Open folder…**, or run `window.yaseenDocs.window.setIdentity({ root: '<abs path>', file: null })` from the devtools console and reload.
- Folder picking is the native open-directory dialog (`window.yaseenDocs.pickFolder()`), which pops up on Yasin's screen; in an agent session seed `<user-data-dir>/yaseendocs.json` with a `windows[]` entry (`{ id, root, file, bounds }`; add `roots: [root, …]` for a window on several vaults, YAZ-2602) and that root first in `recents` before launch — a plain launch brings back only the windows of the vault used last, so a seeded window on any other root is forgotten (or seed `settings.startupWindows: "all"`); `seededState` in `desktop/e2e/helpers.ts` writes both —, or call `window.yaseenDocs.window.setIdentity({ root, file: null })` and reload, instead of using the vault switcher's **Open folder…**.

## Build + install

```bash
npm run desktop:build
```

- Builds `desktop/out` (electron-vite) and then packages with electron-builder: `desktop/dist-app/mac-arm64/Yaseen Docs.app` and `desktop/dist-app/Yaseen Docs-<version>-arm64.dmg` (arm64 only; the filenames contain spaces, so quote them). `mac.identity: null` makes electron-builder skip signing, so `desktop/build/adhocSign.cjs` (`afterPack`) trims Chromium's non-English locale paks and then deep signs the bundle itself — without that seal Gatekeeper reports a downloaded copy as "damaged" instead of offering **Open Anyway**. It signs with the free self-signed certificate **Yaseen Local Signing** when the keychain has it (YAZ-2976 D1; `MAC_SIGN_IDENTITY` names another), else ad-hoc with a warning. The certificate gives every build the same identity (`codesign -d -r-` shows `certificate leaf = H"0344c2f9…"`, not `cdhash`): macOS then keeps the user's permissions across an update, and the in-app updater installs only a build that meets that identity. `REQUIRE_SIGN_IDENTITY=1` turns the ad-hoc fallback into an error. To make the certificate on a new Mac, run `scripts/make-signing-cert.sh` of `yaseen-screenshot-app` (the same certificate signs both apps).
- The first packaging run on a clean machine needs network: electron-builder downloads its Electron dist zip and dmgbuild once, then caches them.
- `npm run build` (and `npm run dev`) first runs `tools/packDrawio.mjs` (YAZ-3028 D5): the first run on a machine downloads the pinned `draw.war` (v31.5.2, 54 MB, sha256-checked) into the gitignored `desktop/.cache/drawio/`, unpacks and prunes it there, and lays `desktop/drawio-overlay/` over it; later runs only re-lay the overlay. `npm run drawio:pack` does it alone. The build then copies it to `desktop/out/drawio`, which the app serves as `app://drawio`.
- `npm run build` ends with `tools/buildShareViewer.mjs` (YAZ-3040; `npm run dev` runs it before electron-vite): it bundles the share-link viewer into the gitignored `share/dist/assets/`, which the packaged app carries as the `share-viewer` extraResource. To try sharing without a Cloudflare account, run `node tools/fakeCloudflare.mjs --data <a temp dir>` and start a dev build with the two URLs it prints as `YASEEN_DOCS_CLOUDFLARE_API` and `YASEEN_DOCS_SHARE_ORIGIN` (a packaged app ignores both).
- Install: drag `Yaseen Docs.app` into `/Applications` in Finder — either straight from `desktop/dist-app/mac-arm64/`, or from the mounted dmg:

```bash
open desktop/dist-app/*.dmg
```

- On another Mac the first open is blocked by Gatekeeper (the app is not notarized): System Settings › Privacy & Security › **Open Anyway**, once. See `docs/FEATURES.md` "Sharing it".
- Windows: `npm run desktop:build:win` packages an unsigned x64 NSIS installer, `desktop/dist-app/Yaseen Docs-<version>-win-x64-setup.exe` (electron-builder can produce it from a Mac too). First open shows SmartScreen — **More info › Run anyway**, once. Both scripts stamp the root `package.json` version through `tools/packDesktop.mjs`.
- No toolchain on the target machine? Download the `.dmg` (Mac, Apple Silicon) or the `-win-x64-setup.exe` (Windows) from the repo's [Releases page](https://github.com/yaseenarshad/yaseen-docs-app/releases). Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds both on GitHub runners and attaches them to that tag's release. **Versions have two numbers from 2.1 on:** each release raises the second one (2.1, 2.2, 2.3, …). `package.json` keeps three (`2.1.0`), because npm and electron-builder need them; the tag (`v2.1`), the release title, the installer names, the Mac About box and every version the app shows drop the `.0` (`shortVersion` in `desktop/src/main/updater.ts`, `tools/packDesktop.mjs`). The workflow accepts `v2.1` for a `package.json` of `2.1.0`. The Mac job imports the certificate from the repo secrets `SIGN_CERT_P12_BASE64` (the `.p12` export of **Yaseen Local Signing**, base64) and `SIGN_CERT_PASSWORD` into a temporary keychain, and fails when they are missing: a release never ships an ad-hoc Mac build.

## App state — where it lives, how to reset it

- ONE user-global file, owned by the main process: `~/Library/Application Support/Yaseen Docs/yaseendocs.json` (settings, recents, open windows with their vaults, tabs and sidebar lens, per-folder view state, saved workspaces — schema in `docs/CONTRACTS.md` "App state"). Nothing is ever stored in the browser profile.
- These things live in the vault, by design: they are the user's own data rather than app state, so they travel with the notes and stay after a quit. Each one is created lazily on its first write; reading creates nothing.
  - `<folder>/.folder.md`: a folder's settings — its views and columns under the single `folder_settings` key, with the folder's own properties and comments beside them (frontmatter only; created by the first change, never by opening the folder).
  - `<vault>/.yaseendocs/properties.json`: the vault-wide property declarations, in the `.obsidian`-style dotfolder.
  - `<vault>/.yaseendocs/favorites.json`: the Favorites (YAZ-1766).
  - `<vault>/.yaseendocs/focus.<mac id>.json`: the focus list, one file for each Mac; the newest file is the list, and no window holds one (YAZ-2702).
  - `<vault>/.yaseendocs/shares.json`: which boards are shared as links, and their ids (YAZ-3040). Sync merges it per entry.
  - `<vault>/.yaseendocs/github.json`: the vault's sync switch (YAZ-1081).
  - `<vault>/assets/<sha1>.<ext>`: the pictures inside drawings, one file per picture by its hash (Draw's store, kept where Draw put it; YAZ-3028). Note images stay in `assets/images/`.
  - A change of a list file starts a GitHub sync, as a note edit does (YAZ-2706). Sync never edits the vault's `.gitignore` (YAZ-3044 A3); the board merge rule lives in `.git/info/attributes`, this machine only.
  - Everything else about a vault stays in the state file above — the order of the Favorites and of the focus rows ACROSS the vaults of one window too (`favoritesOrder`, `focusOrder`), which is per Mac.
- Beside the state file, in the same app-data folder (YAZ-3028; most ported from Draw), each made lazily:
  - `secrets.json` (YAZ-3038, YAZ-3040): the Pixabay API key, the Cloudflare API token and the share upload password. Owner-only (0600), plain text, never sent to a renderer.
  - `sharing.json` (YAZ-3040): the Cloudflare account, bucket and Worker that share links use.
  - `library/` (YAZ-3038): `media.json` favorites and recents, `components/` and `components.json` — the saved components every vault shares. Settings › Images › Library folder can move it anywhere, a synced vault included.
  - `media-cache/` (YAZ-3038): Image Studio search pages and tile pictures, kept 24 h; swept at launch and each hour.
  - `thumbs/` (YAZ-3035): preview-sized copies of a drawing's pictures for the hover preview, with a byte cap.
  - `draw-import.json` (YAZ-3041): the Draw import's marker — when the app-data half ran, and each vault's half.
- To reset or hand-edit: **quit the app first** (⌘Q — quitting flushes the file), then delete or edit the JSON; on the next launch a missing file gets defaults and a corrupt one is moved aside as `yaseendocs.json.corrupt-<epoch>`, never silently overwritten. To find it (the folder first appears after the app has run once against the real state):

```bash
ls "$HOME/Library/Application Support/Yaseen Docs/"
```

- `--user-data-dir=<dir>` relocates the whole state file — this is how agent checks run against a temp state without touching the real one.
- To try a branch by hand against a SCRATCH vault (YAZ-1656's demo pattern): seed `<dir>/yaseendocs.json` with a `windows[]` entry for the scratch vault (the `seededState` shape in `desktop/e2e/helpers.ts`), then from `desktop/` run `YASEEN_DOCS_USER_DATA_DIR=<dir> npx electron-vite dev`. The env var is read before the single-instance lock, so the installed app and the dev app run side by side. Do NOT add `--watch` while agents are editing main-process files: every rebuild relaunches the window on the user's screen.

## Verify

```bash
npm test          # vitest suite, FOUR projects: client (jsdom), desktop (node), tools (node — the packaging checks, the budget gate and the perf harness), perf (jsdom — the budget tripwires)
npm run e2e       # Playwright-Electron suite (desktop/e2e/, 74 specs; `docs/REGRESSION.md` maps features to specs): builds, then drives the real app against a fixture-vault copy + temp user-data-dir, serially on ONE worker with no retries; step screenshots land in desktop/e2e/artifacts/
npm run typecheck
npm run build     # electron-vite build → desktop/out, then the share viewer → share/dist/assets
npm run perf:budget:ci   # the size and integrity gate on desktop/out (what CI runs, after build)
npm run perf:budget      # the same + the packaged .app and DMG (after desktop:build)
npm run perf -- all --runs 5 --app <after.app> --vs <before.app>   # local perf harness, A/B (tools/perf/README.md)
```

- The budget gate (`tools/perf/measureBudget.mjs`) fails when a size row crosses its ceiling in `tools/perf/budget.json` or a shipped file goes missing. **The ratchet:** a change that shrinks a row lowers its ceiling in the same PR; raising one needs Yasin's OK in the PR description. `tools/perf/baseline.json` holds the frozen v0.9.27 numbers. CI (`.github/workflows/ci.yml`) runs typecheck, `npm test`, build and `perf:budget:ci` on every PR and push to main; e2e stays local and its result goes in the PR.

- If `npm` isn't in the shell's PATH (agent shells often lack it), use its install location directly — e.g. `/opt/homebrew/bin/npm` (ARM mac), `/usr/local/bin/npm` (Intel mac), or the Volta/nvm/fnm install under `$HOME`.

### Agent note: live checks

The preview tool is gone — there is no browser mode and no URL to point one at. Verify through Playwright-Electron, always launched with a temp `--user-data-dir` so the real app state is never touched; seed `<user-data-dir>/yaseendocs.json` to skip the native folder dialog (see `desktop/e2e/helpers.ts` — `launchApp` + `seedState` — for the pattern; one-off throwaway scripts go under `node_modules/.verify/`, gitignored). A minimal smoke check against the dev build (run `npm run build` first):

```bash
node --input-type=module -e '
const { _electron } = await import("playwright")
const { mkdtemp } = await import("node:fs/promises")
const { tmpdir } = await import("node:os")
const { join } = await import("node:path")
const dir = await mkdtemp(join(tmpdir(), "yaseendocs-smoke-"))
const app = await _electron.launch({ args: ["desktop/out/main/index.js", `--user-data-dir=${dir}`] })
const win = await app.firstWindow()
console.log("window title:", await win.title())
await app.close()'
```

The packaged app is driven the same way with `executablePath: 'desktop/dist-app/mac-arm64/Yaseen Docs.app/Contents/MacOS/Yaseen Docs'` instead of `args[0]` (same launch pattern as `desktop/e2e/helpers.ts`, swapping the entry for the bundle's binary).

## Gotchas

- Never type into real vault files during testing — copy the vault to a scratch dir first. Files the app only *opens* are never rewritten; the first real edit normalises formatting (tabs → 2 spaces, bullet markers alternate `*`/`-`).
- The vault is on NFS: saves can take 0.3–4 s and chokidar may double-fire. Echo suppression is by mtime (`Autosave.settled()`). This applies to the packaged app exactly as to dev — same main-process fs, same libuv.
- The main process has no path jail (owner's choice): any absolute path the user can read or write, the app can too.
