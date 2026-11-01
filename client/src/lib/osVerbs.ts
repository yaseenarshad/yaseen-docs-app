/**
 * The OS verbs of a file or folder: "Open in ▸" New window, VS Code, Default app, and Reveal in Finder (GRO-2274,
 * YAZ-963, YAZ-1577), with their notices, in ONE place for the sidebar's row menu, the tab menu and the link menu
 * (YAZ-3740, YAZ-3910 A5).
 *
 * Read-only, so there is no confirm and nothing to repair. But a STALE path (deleted or moved outside the app) rejects
 * `NOT_FOUND`, and that has to be said: `showItemInFolder` is silent on a missing path, and a dead `vscode://` URL opens
 * an empty editor, so without the notice the row would just look broken. Any other refusal (the OS' own `IO_ERROR`,
 * e.g. no app for the type) is said as it comes.
 */
import { api, BridgeRequestError } from '../api'

export interface OsVerbs {
  /** A fresh window on {root, file}: the vault that holds the file, alone (YAZ-2602 S33); this one untouched. */
  openNewWindow: (path: string) => void
  openVsCode: (path: string) => void
  openDefault: (path: string) => void
  reveal: (path: string) => void
}

/**
 * The verbs, each failure said through `notify`. `nameOf` names the file in a notice; `rootOf` is the vault that holds
 * a path, and null opens no window (absent: a caller with no "New window", the tab menu).
 */
export function osVerbs(notify: (message: string) => void, nameOf: (path: string) => string, rootOf: (path: string) => string | null = () => null): OsVerbs {
  const said = (call: Promise<unknown>, path: string, gone: (name: string) => string, failed: (name: string) => string): void =>
    void call.catch((err: unknown) =>
      notify(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? gone(nameOf(path)) : `${failed(nameOf(path))}: ${err instanceof Error ? err.message : String(err)}`),
    )
  return {
    openNewWindow: (path) => {
      const root = rootOf(path)
      if (root !== null) api.window.open({ root, file: path }).catch((err: unknown) => console.error('[open in] window.open failed:', err))
    },
    openVsCode: (path) => said(api.shell.openVsCode({ path }), path, (name) => `Can't open "${name}" in VS Code — it is no longer there`, () => "Can't open in VS Code"),
    openDefault: (path) => said(api.shell.openDefault({ path }), path, (name) => `Can't open "${name}" — it is no longer there`, (name) => `Can't open "${name}"`),
    reveal: (path) => said(api.shell.reveal({ path }), path, (name) => `Can't reveal "${name}" — it is no longer there`, () => "Can't reveal"),
  }
}
