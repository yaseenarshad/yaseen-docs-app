import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { pathTitles } from './pageLabel'
import { APP_NAME, windowTitle } from './windowTitle'

const NONE = pathTitles([], [])

describe('windowTitle', () => {
  it('E: the window title names the open note by its title (YAZ-2420 D14)', () => {
    const path = '/vaults/notes/up-001-abdul-k3m9x2pq7abc.md'
    expect(windowTitle('notes', path, pathTitles([{ path, title: 'UP-001 - Abdul' } as IndexRecord], []))).toBe('UP-001 - Abdul — notes')
  })

  it('composes "<file> — <vault>" Obsidian-style from the vault NAME (YAZ-1974 D4), vault extension stripped', () => {
    expect(windowTitle('notes', '/vaults/notes/Ideas.md', NONE)).toBe('Ideas — notes')
    expect(windowTitle('Business Wiki', '/vaults/business-wiki-MASTER/sub/Plan.markdown', NONE)).toBe('Plan — Business Wiki')
  })

  it('a FOLDER tab keeps its whole name, even one named like a file (YAZ-2290)', () => {
    expect(windowTitle('notes', '/vaults/notes/Notes.md', NONE, true)).toBe('Notes.md — notes')
  })

  it('is the vault name alone when no file is open', () => {
    expect(windowTitle('Docs Vault', null, NONE)).toBe('Docs Vault')
  })

  it('is the app name on the Welcome screen (no vault), whatever the file says', () => {
    expect(APP_NAME).toBe('Yaseen Docs')
    expect(windowTitle(null, null, NONE)).toBe(APP_NAME)
    expect(windowTitle(null, '/stray.md', NONE)).toBe(APP_NAME)
  })
})
