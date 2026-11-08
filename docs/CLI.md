# Programmatic control

The packaged `yaseendocs` command keeps its existing offline commands. `edit` and `delete` still edit and delete comments.

New commands use named resources and actions. Run `yaseendocs capabilities --json` for the implemented allowlist, input and output schemas, effects, requirements, and limits. Run `<resource> <action> --help` for one command. Internal Electron channels are not public commands.

```sh
yaseendocs app status --json
yaseendocs request status --id <request-id>
```

Each input field is a flag. A text field takes the text as it is; a field that also allows null takes the word `null` as null. Complex fields accept JSON; `--input -` reads an input object from stdin. `--input @file.json` reads a file. Commands that accept large content use `--body`, transferred separately from the control frame. Secrets must use stdin or a private file, never a command-line value.

## Profiles and startup

The CLI and app use the same `YASEEN_DOCS_USER_DATA_DIR` override. `--profile <absolute-path>` selects a profile for new commands. The app writes an owner-only connection file below that profile. It holds a random token and app-session ID. Never share or log that file.

Navigation starts the app when needed. Other new commands require a running app unless passed `--start`. The CLI starts the app only when it is absent: no connection file, or nothing listens. A slow app that does not answer within the wait fails with `WAIT_TIMEOUT` and gets no second launch. An app that holds the profile's single-instance lock but has no connection yet is starting: the CLI waits for it. Startup launches the executable that owns the CLI, with `ELECTRON_RUN_AS_NODE` removed. A development run should already be running with HMR. Test harnesses can explicitly set `YASEEN_DOCS_EXECUTABLE` and `YASEEN_DOCS_APP_ENTRY`.

The listener uses a Unix socket on macOS and a named pipe on Windows. There is no TCP service or separate daemon. Closing the app refuses new operations and stops a CLI pack download or helper install. It waits at most 3 seconds for the other accepted operations, then removes the connection. A caller whose operation still ran loses the connection: the outcome is unknown.

## Results and retries

New commands return JSON with `ok`, a `value` or structured `error`, and a request reference. Exit codes are 0 for success, 1 for an operation failure, and 2 for invalid usage. Legacy output stays unchanged.

The default wait is 30 seconds. `--wait-ms` changes how long the caller waits. **A timeout does not cancel an accepted operation.** Inspect `request status --id <id>` or current state before making another mutation. `--request <session/id/issuedAt>` sends the same request again. Changed input with an existing ID is refused.

The app keeps up to 256 small receipts for five minutes. Large results go to waiting callers but are not retained. Restarted, expired, or evicted receipts mean **unknown**, not failure. Old request references are refused after restart or eviction. There is no persistent replay journal.

A write whose file is saved never reports failure. When a later step fails, the result keeps `ok: true` and names it in `warnings`: `RECENTS_NOT_SAVED` means the file is saved but its Recents entry is not.

Four operations can run at once, with up to 64 queued. Writes to the same resource serialize: one vault's documents, one live window, the app configuration, or one remote service (sharing, one vault's sync, the icon packs). Reads take no lock, so a status read answers while a long download runs. The control frame is limited to 64 KiB; a separate content frame is limited to 64 MiB. Accepted content has a combined 128 MiB bound. Existing file formats retain their stricter limits. Paged commands default to 50 items and allow at most 200.

## Command guide

`docs/CLI-COVERAGE.md` maps each app capability to its command family. This section shows how the families fit together. Paths are absolute. Quote each path; the CLI passes it as data.

### Discover

```sh
yaseendocs capabilities --json          # every command: input and output schemas, effect, limits
yaseendocs navigation open --help       # one command, with its schema
yaseendocs app status --json            # running?, profile, protocol version (automation), packaged
```

Check `automation` from `app status` or `version` from `capabilities` before you rely on a command. An action that a resource does not have fails with `UNKNOWN_COMMAND` and exit 2. A word that is not a resource at all goes to the legacy commands, which print their own usage error.

### Name a target

Commands that act inside a vault need its scope: `--root`, `--roots`, or `--workspace`. A path alone is not enough.

- A vault: `--root <path>`, several with `--roots '["/a","/b"]'`, or a saved workspace with `--workspace <id or unique name>`.
- A page or folder: `--path <absolute path>`, `--id <existing ID>`, or `--name <unique title, alias, or file name>`.
- A live window or tab: `--window <id>` and `--tab <id>` from `window list` and `window inspect`. These IDs last only while the window is open.

A name that matches more than one item fails with `AMBIGUOUS_TARGET`. The error lists the candidates. Use one of their paths. Reads never assign IDs.

### Navigate

```sh
# A new window on one vault: Favorites shown, the folder revealed and expanded, its page open.
yaseendocs navigation open --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi" --sidebar favorites --reveal true --mode new
# Reuse (the default): the most recent window on exactly these vaults; otherwise a new one.
yaseendocs navigation open --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi" --view "Board"
# A saved multi-vault workspace keeps all its vaults.
yaseendocs navigation open --workspace "All Folders" --mode new
# The right panel, and a reusable link to a view.
yaseendocs navigation open --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi/Cards.md" --panel right
yaseendocs navigation link --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi" --sidebar favorites --reveal true
```

Navigation replies after the window shows the result (`acknowledged: true`). A new window replaces any empty start window (one with no vault, such as the one a cold start opens), as opening a folder from it does in the app; `closedStartWindows` lists them. It starts Docs when needed. A folder that is not in Favorites fails with `NOT_IN_COLLECTION` when you ask for `--sidebar favorites`; nothing else opens. A missing vault fails with `MISSING_VAULT` unless you pass `--allow-partial true`. A link carries navigation only. It holds paths of this Mac, never window IDs, edits, or secrets.

### Search and read

```sh
yaseendocs search query --root "/Vaults/Skills" --collection favorites --scope vault --query mochi
yaseendocs search query --workspace "All Folders" --query "" --limit 50 --offset 50   # page through a scope
yaseendocs file read --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi/Cards.md"     # saved text + revision
yaseendocs document live --window <id> --tab <id>                                        # an open editor's buffer
yaseendocs link incoming --root "/Vaults/Skills" --path "/Vaults/Skills/Mochi/Cards.md"
yaseendocs window inspect --window <id>
```

Search matches titles, aliases, file names, and IDs, with the app's own rules. It does not search full text. Pages hold 50 items by default and 200 at most. `nextOffset` is `null` on the last page.

### Change content safely

Every write names the revision it read. A changed file fails with `CONFLICT`, and nothing is written. Read again, merge, and retry.

```sh
yaseendocs file write   --root "<vault>" --path "<note>" --revision <revision> --body @new.md
yaseendocs file append  --root "<vault>" --path "<note>" --revision <revision> --body "One more line"
yaseendocs property set --root "<vault>" --path "<note>" --revision <revision> --keys '["status"]' --value '"done"'
yaseendocs comment add  --root "<vault>" --path "<note>" --revision <revision> --body "Checked by the agent"
yaseendocs note create  --root "<vault>" --folder "<folder>" --title "New page"
yaseendocs daily create --root "<vault>"
```

A board write fails with `UNSAVED_LIVE_EDITS` while an open editor holds unsaved edits of it. The error names the window and tab. Save it with `editor save`, then read again. Read only is a switch for people; it does not block these commands.

### Organize

`file rename`, `file retitle`, `file move`, `file trash`, `file copy`, `folder create`, `tab move`, and `file undo` / `file redo` run the same complete actions as the app. They save open editors first, repair links, and use the window's Undo history. A command that changes several items reports each failure. It never reports a partial result as success. `file trash` needs `--confirm true`, as the delete sheet asks.

`file rename` gives an item a new name in its folder, as the sidebar's Rename does. To change the folder, use `file move`. `file move` moves items into a folder of the same vault, as a drag does: each keeps its name, and the list is one Undo step. When a move clears other folders' values, it fails with `CONFIRMATION_REQUIRED` and names the folders in `details`. Pass `--dropValues true` to confirm, as the app's Move button does. When an item is in another vault of the window, the whole list runs as the app's Cut and Paste, with no clipboard: folder values follow, but no link is rewritten, and the result says `betweenVaults: true`. Open a window that shows both vaults first. `file copy` asks the same way when a copy will not keep a folder's values. Every organization write returns `history` (the Undo and Redo counts after it) and `diskSaved`.

```sh
yaseendocs file rename --window <id> --path "<vault>/Projects/plan.md" --name "plan-v2.md"
yaseendocs file move   --window <id> --paths '["<vault>/Projects/plan.md"]' --targetDir "<vault>/Archive" --dropValues true
yaseendocs file undo   --window <id>
```

### Settings, collections, and folder pages

`settings get/patch`, `collection add/remove/reorder`, `group …`, `workspace …`, `folder read`, `folderView …`, `shortcut …`, and `ids …` change stored state against the latest copy. A command that clears data, or turns a feature off, needs an explicit confirmation input in place of the app's dialog. The CLI asks every time, also when the app's "Ask before deleting" is off:

- `--confirm true`: `folderView remove`, `folderColumn remove`, `session remove`, `comment remove`, `review reset`, `component remove`, `media removePacks`, `file trash`, `ids disable`. Without it the command exits 2 and changes nothing.
- `group remove --keepItems true|false`: the Delete sheet's two answers. `true` puts each item back at the top level of each list the group showed in; `false` removes the items with it. Both list scopes get the tombstone.
- `--dropValues true`: `shortcut remove`, `file move` and `file copy`, only when they would clear folder values.

`icon set` takes a name the app ships. `icon names --query <words>` lists them, as the icon picker does. Settings output never shows a stored secret. `provider status` reports only whether a key is present. `provider set` reads the key from stdin or a private file.

### Errors and exit codes

| Exit | Meaning |
| --- | --- |
| 0 | `ok: true`. The operation finished. |
| 1 | `ok: false`. The operation failed, or its outcome is unknown. |
| 2 | Invalid usage: an unknown command, flag, or field, or a value of the wrong type. Nothing was sent. |

Common error codes:

| Code | What to do |
| --- | --- |
| `NOT_RUNNING` | Start Docs, or pass `--start`. |
| `START_FAILED`, `START_UNAVAILABLE`, `START_TIMEOUT` | Docs could not start from this CLI. Start the app yourself, or set `YASEEN_DOCS_EXECUTABLE`. |
| `NOT_FOUND`, `MISSING_VAULT`, `WINDOW_NOT_FOUND`, `TAB_NOT_FOUND` | The target is gone. Read current state and choose again. |
| `AMBIGUOUS_TARGET` | Pick a path from `details.candidates`. |
| `NOT_IN_COLLECTION` | The target is not in that Favorites or Focus list. |
| `CONFLICT` | The file changed after you read it. Read again before you write. |
| `UNSAVED_LIVE_EDITS`, `UNSAVED_CHANGES` | An open editor holds unsaved edits. Save it, then retry. |
| `PARTIAL_FAILURE` | Some items changed. `details` lists which. Read state before you retry. |
| `BUSY`, `LIMIT_EXCEEDED` | The queue is full. Wait and retry. |
| `WAIT_TIMEOUT`, `RENDERER_TIMEOUT` | The outcome is unknown. Run `request status --id <id>` or read state. Do not repeat a write blindly. |
| `TOO_LARGE` | Use the command's file input or output (`--source-file`, `--output-file`). |

## Development checks

Use temporary profiles and fixtures. The focused checks are `desktop/src/automation/*.test.ts`, `desktop/src/cli/automation.test.ts`, and the legacy `desktop/src/cli/cli.test.ts`. The process test builds and runs the real CLI against a real local socket. No test needs a visible app window.
