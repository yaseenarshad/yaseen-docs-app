import type { CustomScheme } from 'electron'

/**
 * Privileged scheme: `standard` gives a real origin (history API, relative URLs), `secure` treats it
 * like https. VS Code (vscode-file://) and Obsidian (app://obsidian.md) do the same. `codeCache`:
 * Chromium keeps compiled V8 code only for http(s) unless a scheme opts in, so without it every
 * launch recompiled the renderer's entry chunk (YAZ-2187: −35 ms nav → document painted, ~1.7 MB
 * in userData/Code Cache/js).
 */
export const APP_SCHEME: CustomScheme = { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }
