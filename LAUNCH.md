# LAUNCH — how to run this app (for humans and agents)

Local markdown editor: Vite + React + Milkdown Crepe client, Hono file server. See `README.md` for the human overview and `docs/CONTRACTS.md` for API shapes.

## Launch (do this when asked to "run it" / "open localhost")

```bash
/opt/homebrew/bin/npm install && /opt/homebrew/bin/npm run dev
```

- Use full Homebrew paths (`/opt/homebrew/bin/npm`) — the agent shell has no Homebrew in PATH.
- `npm run dev` starts both: client on `http://127.0.0.1:5173`, server on `127.0.0.1:3737`. Open the client URL.
- In Claude Code, prefer the browser preview tool: `preview_start` with name `milkdown-dev` (config in `.claude/launch.json`). It starts the dev server and opens the tab.
- The app remembers the last folder/file in `localStorage` (`mdapp.root`, `mdapp.lastFile`, …). Yasin's vault is `/Users/yasin/yaseen-os/yaseen-machine-content`. If it opens the wrong folder, click **change** in the sidebar header, or set `localStorage.mdapp.root` and reload.
- Folder picking uses the native macOS Finder dialog (`POST /api/pick-folder` → `osascript`); the in-app folder browser only appears as a fallback when the native dialog is unavailable. In an agent session the Finder dialog pops up on Yasin's screen, so set `localStorage.mdapp.root` instead of clicking **change**.

## Verify

```bash
/opt/homebrew/bin/npm test          # 65 vitest tests (client jsdom + server node)
/opt/homebrew/bin/npm run typecheck
/opt/homebrew/bin/npm run build
```

## Gotchas

- Never type into real vault files during testing — copy the vault to a scratch dir first. Files the app only *opens* are never rewritten; the first real edit normalises formatting (tabs → 2 spaces, bullet markers alternate `*`/`-`).
- The vault is on NFS: saves can take 0.3–4 s and chokidar may double-fire. Echo suppression is by mtime (`Autosave.settled()`).
- Server binds `127.0.0.1` only and has no path jail (owner's choice). Keep it local.
- `server` must run with cwd `server/` (tsx needs its tsconfig paths) — `npm run dev` already does this.
- Linear project: https://linear.app/growprofit/project/milkdown-382fb0a0cd6a — initial build was GRO-1959.
