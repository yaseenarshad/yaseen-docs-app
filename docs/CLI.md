# Programmatic control

The packaged `yaseendocs` command keeps its existing offline commands. `edit` and `delete` still edit and delete comments.

New commands use named resources and actions. Run `yaseendocs capabilities --json` for the implemented allowlist, input and output schemas, effects, requirements, and limits. Run `<resource> <action> --help` for one command. Internal Electron channels are not public commands.

```sh
yaseendocs app status --json
yaseendocs request status --id <request-id>
```

Each input field is a flag. Complex fields accept JSON; `--input -` reads an input object from stdin. `--input @file.json` reads a file. Commands that accept large content use `--body`, transferred separately from the control frame. Secrets must use stdin or a private file, never a command-line value.

## Profiles and startup

The CLI and app use the same `YASEEN_DOCS_USER_DATA_DIR` override. `--profile <absolute-path>` selects a profile for new commands. The app writes an owner-only connection file below that profile. It holds a random token and app-session ID. Never share or log that file.

Navigation starts the app when needed. Other new commands require a running app unless passed `--start`. Startup launches the executable that owns the CLI, with `ELECTRON_RUN_AS_NODE` removed. A development run should already be running with HMR. Test harnesses can explicitly set `YASEEN_DOCS_EXECUTABLE` and `YASEEN_DOCS_APP_ENTRY`.

The listener uses a Unix socket on macOS and a named pipe on Windows. There is no TCP service or separate daemon. Closing the app drains accepted operations and removes the connection.

## Results and retries

New commands return JSON with `ok`, a `value` or structured `error`, and a request reference. Exit codes are 0 for success, 1 for an operation failure, and 2 for invalid usage. Legacy output stays unchanged.

The default wait is 30 seconds. `--wait-ms` changes how long the caller waits. **A timeout does not cancel an accepted operation.** Inspect `request status --id <id>` or current state before making another mutation. `--request <session/id/issuedAt>` sends the same request again. Changed input with an existing ID is refused.

The app keeps up to 256 small receipts for five minutes. Large results go to waiting callers but are not retained. Restarted, expired, or evicted receipts mean **unknown**, not failure. Old request references are refused after restart or eviction. There is no persistent replay journal.

Four operations can run at once, with up to 64 queued. Resource writes serialize. The control frame is limited to 64 KiB; a separate content frame is limited to 64 MiB. Accepted content has a combined 128 MiB bound. Existing file formats retain their stricter limits. Paged commands default to 50 items and allow at most 200.

## Development checks

Use temporary profiles and fixtures. The focused checks are `desktop/src/automation/*.test.ts`, `desktop/src/cli/automation.test.ts`, and the legacy `desktop/src/cli/cli.test.ts`. The process test builds and runs the real CLI against a real local socket. No test needs a visible app window.
