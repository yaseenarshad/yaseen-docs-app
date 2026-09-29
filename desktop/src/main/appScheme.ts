import type { CustomScheme } from 'electron'

/**
 * Privileged scheme: `standard` gives a real origin (history API, relative URLs), `secure` treats it
 * like https. VS Code (vscode-file://) and Obsidian (app://obsidian.md) do the same.
 */
export const APP_SCHEME: CustomScheme = { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
