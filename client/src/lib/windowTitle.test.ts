import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { pathTitles } from './pageLabel'
import { APP_NAME, windowTitle } from './windowTitle'

const NONE = pathTitles([], [])

describe('windowTitle', () => {
  it('E: the window title names the open page by its title (YAZ-2420 D14), after the vault', () => {
    const path = '/vaults/pages/up-001-abdul-k3m9x2pq7abc.md'
    expect(windowTitle('pages', path, pathTitles([{ path, title: 'UP-001 - Abdul' } as IndexRecord], []))).toBe('pages — UP-001 - Abdul')
  })

  it('composes "<vault> — <file>", the vault FIRST (YAZ-2555 D6), from the vault NAME (YAZ-1974 D4), file extension stripped', () => {
    expect(windowTitle('pages', '/vaults/pages/Ideas.md', NONE)).toBe('pages — Ideas')
    // A display name is the vault's name in the title too (S42), never the folder's.
    expect(windowTitle('Business Wiki', '/vaults/business-wiki-MASTER/sub/Plan.markdown', NONE)).toBe('Business Wiki — Plan')
  })

  it('a FOLDER tab keeps its whole name, even one named like a file (YAZ-2290)', () => {
    expect(windowTitle('pages', '/vaults/pages/Pages.md', NONE, true)).toBe('pages — Pages.md')
  })

  it('is the vault name alone when no file is open', () => {
    expect(windowTitle('Docs Vault', null, NONE)).toBe('Docs Vault')
  })

  it('a named window leads with its name in the vault\'s place, alone with no file (YAZ-3343 D14)', () => {
    expect(windowTitle('pages', '/vaults/pages/Ideas.md', NONE, false, 'Writing')).toBe('Writing — Ideas')
    expect(windowTitle('pages', null, NONE, false, 'Writing')).toBe('Writing')
    expect(windowTitle(null, null, NONE, false, 'Writing')).toBe(APP_NAME)
  })

  it('a tab that is no page names itself: the Inbox tab while it shows, under the vault or the window\'s name (YAZ-5038)', () => {
    expect(windowTitle('pages', null, NONE, false, undefined, 'Inbox')).toBe('pages — Inbox')
    expect(windowTitle('pages', null, NONE, false, 'Writing', 'Inbox · Work')).toBe('Writing — Inbox · Work')
    expect(windowTitle(null, null, NONE, false, undefined, 'Inbox')).toBe(APP_NAME)
  })

  it('is the app name on the Welcome screen (no vault), whatever the file says', () => {
    expect(APP_NAME).toBe('Yaseen Docs')
    expect(windowTitle(null, null, NONE)).toBe(APP_NAME)
    expect(windowTitle(null, '/stray.md', NONE)).toBe(APP_NAME)
  })
})
