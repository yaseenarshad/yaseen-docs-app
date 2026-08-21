# LAUNCH — how to run this app (for humans and agents)

Yaseen Docs: a local markdown editor as an Electron desktop app — React + Milkdown Crepe renderer, main-process file layer. See `README.md` for the human overview and `docs/CONTRACTS.md` for the bridge and editor contracts.

## Launch (do this when asked to "run it")

```bash
npm install
npm run dev
```

- `npm run dev` runs `electron-vite dev` in `desktop/`: it builds main + preload, serves the renderer with HMR and launches the Electron app — one command, one window. There is no browser mode and no server to start.
- The app remembers its windows (folder + file each), per-folder view state and the global settings in `~/Library/Application Support/Yaseen Docs/yaseendocs.json` (`--user-data-dir=<dir>` relocates it; schema in `docs/CONTRACTS.md` "App state"). Yasin's vault is `$HOME/yaseen-os/yaseen-machine-content` (the username part of `$HOME` differs per machine — resolve it, don't hardcode). If it opens the wrong folder, click **change** in the sidebar header, or run `window.yaseenDocs.window.setIdentity({ root: '<abs path>', file: null })` from the devtools console and reload.
- Folder picking is the native open-directory dialog (`window.yaseenDocs.pickFolder()`), which pops up on Yasin's screen; in an agent session seed `<user-data-dir>/yaseendocs.json` with a `windows[]` entry (`{ id, root, file, bounds }`) before launch, or call `window.yaseenDocs.window.setIdentity({ root, file: null })` and reload, instead of clicking **change**.
- A built app can be driven headlessly with Playwright's `_electron.launch({ args: ['desktop/out/main/index.js', '--user-data-dir=<tmp>'] })` after `npm run build`.

## Verify

```bash
npm test          # vitest suite: client (jsdom) + desktop (node)
npm run typecheck
npm run build     # electron-vite build → desktop/out
```

- If `npm` isn't in the shell's PATH (agent shells often lack it), use its install location directly — e.g. `/opt/homebrew/bin/npm` (ARM mac), `/usr/local/bin/npm` (Intel mac), or the Volta/nvm/fnm install under `$HOME`.

## Gotchas

- Never type into real vault files during testing — copy the vault to a scratch dir first. Files the app only *opens* are never rewritten; the first real edit normalises formatting (tabs → 2 spaces, bullet markers alternate `*`/`-`).
- The vault is on NFS: saves can take 0.3–4 s and chokidar may double-fire. Echo suppression is by mtime (`Autosave.settled()`).
- The main process has no path jail (owner's choice): any absolute path the user can read or write, the app can too.
- Linear project: https://linear.app/growprofit/project/milkdown-382fb0a0cd6a — initial build was GRO-1959.
