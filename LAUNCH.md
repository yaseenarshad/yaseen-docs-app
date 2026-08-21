# LAUNCH — how to run this app (for humans and agents)

Local markdown editor: Vite + React + Milkdown Crepe client, Hono file server. See `README.md` for the human overview and `docs/CONTRACTS.md` for API shapes.

## Launch (do this when asked to "run it" / "open localhost")

```bash
sh scripts/dev.sh
```

- `scripts/dev.sh` is machine-agnostic: it resolves npm wherever it lives (PATH, Homebrew ARM/Intel, Volta, nvm, fnm — agent shells often lack npm in PATH), runs `npm install` if `node_modules` is missing, then `npm run dev`. If npm is already on your PATH, plain `npm run dev` works too — a `predev` hook auto-installs deps when `node_modules` is missing.
- `npm run dev` starts both: client on `http://127.0.0.1:5173`, server on `127.0.0.1:3737`. Open the client URL.
- In Claude Code, prefer the browser preview tool: `preview_start` with name `milkdown-dev` (config in `.claude/launch.json`). It runs `npm run dev` resolved via PATH — the preview launcher inherits the user's login PATH, and its sandbox blocks raw shells (`sh script.sh` fails with "Operation not permitted"), so the config must call npm directly, not `scripts/dev.sh`.
- The app remembers the last folder/file in `localStorage` (`mdapp.root`, `mdapp.lastFile`, …). Yasin's vault is `$HOME/yaseen-os/yaseen-machine-content` (the username part of `$HOME` differs per machine — resolve it, don't hardcode). If it opens the wrong folder, click **change** in the sidebar header, or set `localStorage.mdapp.root` and reload.
- Folder picking uses the native macOS Finder dialog (`POST /api/pick-folder` → `osascript`); the in-app folder browser only appears as a fallback when the native dialog is unavailable. In an agent session the Finder dialog pops up on Yasin's screen, so set `localStorage.mdapp.root` instead of clicking **change**.

## Verify

```bash
npm test          # vitest suite, client jsdom + server node (138 tests as of GRO-2063)
npm run typecheck
npm run build
```

- If `npm` isn't in the shell's PATH (agent shells often lack it), resolve it the way `scripts/dev.sh` does — e.g. `/opt/homebrew/bin/npm` (ARM mac), `/usr/local/bin/npm` (Intel mac), or the Volta/nvm/fnm install under `$HOME`.

## Gotchas

- Never type into real vault files during testing — copy the vault to a scratch dir first. Files the app only *opens* are never rewritten; the first real edit normalises formatting (tabs → 2 spaces, bullet markers alternate `*`/`-`).
- The vault is on NFS: saves can take 0.3–4 s and chokidar may double-fire. Echo suppression is by mtime (`Autosave.settled()`).
- Server binds `127.0.0.1` only and has no path jail (owner's choice). Keep it local.
- `server` must run with cwd `server/` (tsx needs its tsconfig paths) — `npm run dev` already does this.
- Linear project: https://linear.app/growprofit/project/milkdown-382fb0a0cd6a — initial build was GRO-1959.
