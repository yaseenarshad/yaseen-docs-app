# LAUNCH — how to run this app (for humans and agents)

Yaseen Docs: a local markdown editor as an Electron macOS desktop app — React + Milkdown Crepe renderer, main-process file layer. See `README.md` for the human overview and `docs/CONTRACTS.md` for the bridge and editor contracts.

## Dev loop (do this when asked to "run it")

```bash
npm install
npm run dev
```

- `npm run dev` runs `electron-vite dev` in `desktop/`: it builds main + preload, serves the renderer with HMR and launches the Electron app — one command, and every remembered window reopens. There is no server of any kind and nothing listens for the app itself on any port (the only network socket is electron-vite's private HMR channel in dev); renderer ↔ main is the typed `window.yaseenDocs` bridge.
- Yasin's vault is `$HOME/yaseen-os/yaseen-machine-content` (the username part of `$HOME` differs per machine — resolve it, don't hardcode). If a window opens the wrong folder, click **change** in the sidebar header, or run `window.yaseenDocs.window.setIdentity({ root: '<abs path>', file: null })` from the devtools console and reload.
- Folder picking is the native open-directory dialog (`window.yaseenDocs.pickFolder()`), which pops up on Yasin's screen; in an agent session seed `<user-data-dir>/yaseendocs.json` with a `windows[]` entry (`{ id, root, file, bounds }`) before launch, or call `window.yaseenDocs.window.setIdentity({ root, file: null })` and reload, instead of clicking **change**.

## Build + install

```bash
npm run desktop:build
```

- Builds `desktop/out` (electron-vite) and then packages with electron-builder: `desktop/dist-app/mac-arm64/Yaseen Docs.app` and `desktop/dist-app/Yaseen Docs-0.1.0-arm64.dmg` (ad-hoc signed — `identity: null` — arm64 only; the filenames contain spaces, so quote them).
- The first packaging run on a clean machine needs network: electron-builder downloads its Electron dist zip and dmgbuild once, then caches them.
- Install: drag `Yaseen Docs.app` into `/Applications` in Finder — either straight from `desktop/dist-app/mac-arm64/`, or from the mounted dmg:

```bash
open "desktop/dist-app/Yaseen Docs-0.1.0-arm64.dmg"
```

- On another Mac the first open is blocked by Gatekeeper (the app is not notarized): System Settings › Privacy & Security › **Open Anyway**, once. See `README.md` "Sharing it".

## App state — where it lives, how to reset it

- ONE user-global file, owned by the main process: `~/Library/Application Support/Yaseen Docs/yaseendocs.json` (settings, recents, open windows, per-folder view state — schema in `docs/CONTRACTS.md` "App state"). Nothing is ever stored in the browser profile and nothing is ever written into the vault's markdown.
- To reset or hand-edit: **quit the app first** (⌘Q — quitting flushes the file), then delete or edit the JSON; on the next launch a missing file gets defaults and a corrupt one is moved aside as `yaseendocs.json.corrupt-<epoch>`, never silently overwritten. To find it (the folder first appears after the app has run once against the real state):

```bash
ls "$HOME/Library/Application Support/Yaseen Docs/"
```

- `--user-data-dir=<dir>` relocates the whole state file — this is how agent checks run against a temp state without touching the real one.

## Verify

```bash
npm test          # vitest suite: client (jsdom) + desktop (node)
npm run typecheck
npm run build     # electron-vite build → desktop/out
```

- If `npm` isn't in the shell's PATH (agent shells often lack it), use its install location directly — e.g. `/opt/homebrew/bin/npm` (ARM mac), `/usr/local/bin/npm` (Intel mac), or the Volta/nvm/fnm install under `$HOME`.

### Agent note: live checks

The preview tool is gone — there is no browser mode and no URL to point one at. Verify through Playwright-Electron scripts under `node_modules/.verify/` (gitignored throwaways), always launched with a temp `--user-data-dir` so the real app state is never touched; seed `<user-data-dir>/yaseendocs.json` to skip the native folder dialog (see the existing scripts there for the pattern). A minimal smoke check against the dev build (run `npm run build` first):

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

The packaged app is driven the same way with `executablePath: 'desktop/dist-app/mac-arm64/Yaseen Docs.app/Contents/MacOS/Yaseen Docs'` instead of `args[0]` (see `node_modules/.verify/f1.mjs`).

## Gotchas

- Never type into real vault files during testing — copy the vault to a scratch dir first. Files the app only *opens* are never rewritten; the first real edit normalises formatting (tabs → 2 spaces, bullet markers alternate `*`/`-`).
- The vault is on NFS: saves can take 0.3–4 s and chokidar may double-fire. Echo suppression is by mtime (`Autosave.settled()`). This applies to the packaged app exactly as to dev — same main-process fs, same libuv.
- The main process has no path jail (owner's choice): any absolute path the user can read or write, the app can too.
- Linear project: https://linear.app/growprofit/project/milkdown-382fb0a0cd6a — initial build was GRO-1959.
