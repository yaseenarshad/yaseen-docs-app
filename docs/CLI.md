# CLI navigation

`yaseendocs navigation open` shows a vault or a saved workspace in a Docs window. In one call it can:

- pick a new window or reuse one that shows exactly those vaults;
- show Files, Favorites, or Focus in the sidebar;
- open a folder or page and reveal it in that list, with its folders expanded;
- open a Favorites or Focus group;
- pick a saved view of a folder page.

The command replies after the window shows the result. It starts Docs when Docs is not running.

The existing offline commands (`comment`, `comments`, `edit`, `delete`, `id`, `links`, `due`, `vaults`, `daily`, `new`) and `yaseendocs --help` do not change. The navigation help is `yaseendocs navigation --help`, `yaseendocs navigation open --help`, and `yaseendocs capabilities --help`.

## Commands

```sh
yaseendocs navigation open <inputs>       # show a context in a window (starts Docs)
yaseendocs app status                     # is Docs running in this profile; its version and protocol
yaseendocs request status --id <id>       # the receipt of an earlier request
yaseendocs capabilities --json            # every command, its input and output schema, and the limits
```

## Inputs of `navigation open`

Paths are absolute. Quote each path. The CLI passes it as data: spaces, quotes, `$`, `;` and Unicode are safe.

Name the vaults with exactly one of `--root`, `--roots`, or `--workspace`, or name a live window with `--window`.

| Input | Value | Example |
|---|---|---|
| `--root` | One vault folder. | `--root "/Vaults/Demo Skills"` |
| `--roots` | Several vault folders, as a JSON list (at most 8). | `--roots '["/Vaults/Demo Skills","/Vaults/Demo Notes"]'` |
| `--workspace` | A saved workspace: its ID, or its name if no other workspace has that name (case is ignored). All its vaults open. | `--workspace "All Folders"` |
| `--path` | A folder or page inside those vaults. It must exist, and it cannot be hidden (a name that starts with a dot, or `node_modules`). A vault folder itself means that vault with no page, as opening a vault in the app does: the list shows, nothing is revealed. | `--path "/Vaults/Demo Skills/Example"` |
| `--sidebar` | `files`, `favorites`, or `focus`. The sidebar shows, even when it was hidden. | `--sidebar favorites` |
| `--reveal` | `true` (the default when a sidebar is named) reveals the path in that list and expands its folders. `false` only opens the page. | `--reveal false` |
| `--group` | A Favorites or Focus group: its ID, or its unique name. Needs `--sidebar favorites` or `--sidebar focus`. With a path, the path must be in that group. | `--group "Study"` |
| `--view` | A saved view of the folder that `--path` names. An exact name first; else the one view of that name in any case. | `--view Cards` |
| `--scope` | `vault` or `workspace`. A check only: the window must show that Favorites or Focus list. It never changes the list. | `--scope workspace` |
| `--mode` | `reuse` (default): the most recently used window on exactly these vaults, else a new one. `new`: always a new window. | `--mode new` |
| `--window` | A live window ID from an earlier reply. Its vaults must match the vault input, if you give one. Not with `--mode new`. | `--window 0334f6d6-…` |
| `--allow-partial` | `true` opens a workspace whose vault folders are partly missing. `missing` in the reply names them. | `--allow-partial true` |

`--input <JSON | @file | ->` gives the same inputs as one JSON object (inline, from a file, or from stdin). A field cannot come from both a flag and `--input`.

Other flags: `--profile <absolute path>` selects an app profile (default: the app's own, or `YASEEN_DOCS_USER_DATA_DIR`). `--wait-ms <1..300000>` changes how long the CLI waits (default 30000). `--request <reference>` sends an earlier request again. `--start` starts Docs for `app status` or `request status`; navigation does not need it. `--json` is accepted and changes nothing: the output is always JSON.

Which Favorites or Focus list a window shows: a window with one vault shows that vault's own list. A window with two or more vaults shows the workspace list while Settings › "Separate list for workspaces" is on for that tab (the default).

## Example: one short command per folder

```sh
# A Favorites folder in its own window, with its page and its Cards view.
yaseendocs navigation open --root "/Vaults/Demo Skills" --path "/Vaults/Demo Skills/Example" \
  --sidebar favorites --view Cards --mode new

# Then only the target changes, in the same window.
yaseendocs navigation open --window <window from the reply> --path "/Vaults/Demo Skills/Second" --sidebar favorites

# A saved workspace with two vaults.
yaseendocs navigation open --workspace "All Folders" --mode new
```

A shell function makes a short alias, for example `ds Mochi`:

```sh
# ~/.zshrc or ~/.bashrc
ds() {
  local vault="$HOME/Vaults/Skills" folder="$1"; shift
  yaseendocs navigation open --root "$vault" --path "$vault/$folder" --sidebar favorites "$@"
}
# ds Mochi                → the Mochi folder, revealed in Favorites, in the window you used last on that vault
# ds Mochi --view Board   → the same, on its Board view
# ds Mochi --mode new     → the same, in a new window
```

On a disk that ignores case (the macOS default), `ds mochi` works too: the CLI takes the names below the vault as they are on disk.

## Output

A command that reached Docs prints one JSON line on stdout: `ok`, then `value` or `error`, and `request`, the reference of this request.

```json
{"ok":true,"value":{"window":"0334f6d6-…","roots":["/Vaults/Demo Skills"],"missing":[],"created":true,
 "applied":{"path":"/Vaults/Demo Skills/Example","tab":"tab-1","sidebar":"favorites","sidebarCollapsed":false,"acknowledged":true},
 "closedStartWindows":["ae6d1ef9-…"]},"request":"<session>/<id>/<issuedAt>"}
```

- `window`: the window that shows the result. Use it with `--window`. It lasts while the window is open.
- `created`: true for a new window.
- `applied`: what the window shows now. `acknowledged` is always true: the window replied after it showed the target.
- `closedStartWindows`: a new window replaces an empty start window (one with no vault, such as the one a cold start opens), as opening a folder from it does in the app. The reply comes after it is closed.

A failure before the request reaches Docs (invalid input, Docs not running) prints the same shape on stderr, with no `value`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | Refused or failed: the error code says why. |
| 2 | Invalid usage: an unknown command, flag or field, or a wrong value type. Nothing was sent. |

## Errors

| Code | When |
|---|---|
| `INVALID_INPUT` | A wrong flag, field or value; a relative path; no vault input, or more than one; `--group` or `--scope` without a Favorites or Focus sidebar; `--view` without a folder; `--window` with `--mode new`; a `--scope` that is not the list the window shows (`details.scope` names the shown one). Exit 2 when the CLI finds it, 1 when Docs does. |
| `UNKNOWN_COMMAND` | An action that does not exist. Exit 2. |
| `NOT_FOUND` | The path, the workspace name, the group, or the view does not exist. For a view, `details.views` lists the saved views. |
| `AMBIGUOUS_TARGET` | A workspace, group or view name matches more than one. `details.candidates` lists them (at most 200). Use an ID. |
| `NOT_IN_COLLECTION` | The path is not in the Favorites or Focus list (or group) you asked for. Nothing opens. |
| `HIDDEN_TARGET` | The path is hidden, or inside a hidden folder: a name that starts with a dot, or `node_modules`. The sidebar never shows it. Nothing opens. |
| `NOT_SHOWN` | The window opened the page, but its row did not show in the sidebar list within 5 seconds. |
| `OUTSIDE_SCOPE` | The path is not inside the named vaults. |
| `MISSING_VAULT` | A vault folder does not exist. Use `--allow-partial true` for a workspace. |
| `WINDOW_NOT_FOUND` | The `--window` is not open. |
| `WINDOW_SCOPE_MISMATCH` | The `--window` shows other vaults than the vault input. It was left as it was. |
| `WINDOW_CLOSED`, `RENDERER_TIMEOUT`, `SURFACE_TIMEOUT` | The window closed, did not answer within 30 seconds, or a part of it did not become ready within 20 seconds. Its final state is unknown. The next navigation does not wait longer than that. |
| `NOT_RUNNING` | Docs is not running in this profile (`app status`, `request status`). |
| `START_FAILED`, `START_UNAVAILABLE`, `START_TIMEOUT` | The CLI could not start Docs, or Docs did not become ready within 30 seconds. Nothing was sent. |
| `WAIT_TIMEOUT` | The wait ended. See below. |
| `BUSY`, `STOPPING` | The request queue is full (4 running, 64 waiting), or Docs is quitting. Nothing was accepted. |
| `UNKNOWN_REQUEST`, `REQUEST_MISMATCH` | A `--request` reference from before a restart or older than five minutes, or reused with other input. |
| `UNSAFE_PROFILE`, `UNAUTHORIZED` | The profile's connection file or socket is not private to you, or its token is wrong. |

## Waits, retries and timeouts

- The CLI waits 30 seconds by default (`--wait-ms`). **A timeout does not cancel the request.** The window can still show the target after it.
- After a timeout, run `yaseendocs request status --id <id>` (the middle part of the reference) to see `queued`, `running`, `completed` (with its result) or `unknown`. `unknown` is not proof of failure: Docs restarted, or the receipt expired.
- `--request <reference>` sends the exact request again. Docs answers it from its receipt and does not run it twice. Other input with the same reference fails with `REQUEST_MISMATCH`.
- Docs keeps up to 256 small receipts for five minutes. A restart forgets them.
- Navigations run one at a time. A quick second call after a cold start waits for the first and sees its window.
- Docs is never started twice for one profile. Of calls that start it at the same time, one launches it (it holds `<profile>/cli/start.lock` while Docs starts) and the others wait for its connection. A lock older than 60 seconds was left by a caller that stopped, and the next caller takes it. A running app that does not answer fails with `WAIT_TIMEOUT`, and an app that is starting is waited for.

## Connection and profiles

Docs listens on a same-user local socket (a named pipe on Windows) while it runs. There is no network port. It writes an owner-only connection file, `<profile>/cli/connection.json`, which holds a random token. Do not share or log it. Quit stops the connection; it waits at most 3 seconds for accepted requests.

The CLI starts the executable it belongs to. A development or test run can set `YASEEN_DOCS_EXECUTABLE` (and `YASEEN_DOCS_APP_ENTRY` for a bare Electron) to the app to start.
