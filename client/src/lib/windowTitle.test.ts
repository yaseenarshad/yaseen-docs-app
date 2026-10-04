import { describe, expect, it } from 'vitest'
import { APP_NAME, windowTitle } from './windowTitle'

describe('windowTitle', () => {
  it('composes "<file> — <vault>" Obsidian-style from the vault NAME (YAZ-1974 D4), vault extension stripped', () => {
    expect(windowTitle('notes', '/vaults/notes/Ideas.md')).toBe('Ideas — notes')
    expect(windowTitle('Business Wiki', '/vaults/business-wiki-MASTER/sub/Plan.markdown')).toBe('Plan — Business Wiki')
  })

  it('a FOLDER tab keeps its whole name, even one named like a file (YAZ-2290)', () => {
    expect(windowTitle('notes', '/vaults/notes/Notes.md', true)).toBe('Notes.md — notes')
  })

  it('is the vault name alone when no file is open', () => {
    expect(windowTitle('Docs Vault', null)).toBe('Docs Vault')
  })

  it('is the app name on the Welcome screen (no vault), whatever the file says', () => {
    expect(APP_NAME).toBe('Yaseen Docs')
    expect(windowTitle(null, null)).toBe(APP_NAME)
    expect(windowTitle(null, '/stray.md')).toBe(APP_NAME)
  })
})
