/**
 * `shared/newPlaces.ts` (YAZ-5486): where new pages and boards go, in the vault's new-places.json beside the New… box's
 * shortcuts. Each key and field alone; a key the file lacks is the app's value, except a vault-relative folder.
 */
import { describe, expect, it } from 'vitest'
import { newPlacesOfSettings, parseNewPlaces, sanitizeVaultNewPlaces, vaultNewPlacesFields, vaultNewPlacesFile } from '@shared/newPlaces'
import { DEFAULT_SETTINGS } from '@shared/types'

describe('sanitizeVaultNewPlaces', () => {
  it('each key and field alone; defaults are left out; the shortcuts are not its keys', () => {
    expect(sanitizeVaultNewPlaces({ version: 1, places: ['A', null, null], newPage: { location: 'folder', folder: 'Inbox' }, newBoard: { folder: 'assets', pictures: 'folder', picturesFolder: 'assets/pics' } })).toEqual({
      newPage: { location: 'folder', folder: 'Inbox' },
      newBoard: { folder: 'assets', pictures: 'folder', picturesFolder: 'assets/pics' },
    })
    expect(sanitizeVaultNewPlaces({ newPage: { location: 'nowhere', folder: '../x' }, newBoard: { folder: 'page', pictures: 'inside', picturesFolder: '.git' } })).toEqual({ newPage: {}, newBoard: {} })
    expect(sanitizeVaultNewPlaces({ newPage: 'x' })).toEqual({})
    expect(sanitizeVaultNewPlaces(null)).toEqual({})
  })

  it('an older build\'s reader: a version-1 file with no shortcuts is three empty ones; the writer adds them for a new file', () => {
    expect(parseNewPlaces({ version: 1, newPage: { location: 'root' } })).toEqual([null, null, null])
    expect(parseNewPlaces({ version: 1, places: 'x' })).toBeNull()
    expect(vaultNewPlacesFile({ newPage: { location: 'root' } }, true)).toEqual({ version: 1, places: [null, null, null], newPage: { location: 'root' } })
    expect(vaultNewPlacesFile({ newPage: { location: 'root' } }, false)).toEqual({ version: 1, newPage: { location: 'root' } })
  })
})

describe('vaultNewPlacesFields', () => {
  const APP = { ...DEFAULT_SETTINGS, newPageLocation: 'root' as const, newBoardFolder: 'assets' as const }

  it('the file\'s keys win; a key it lacks is the app\'s value; the same values keep the object', () => {
    expect(vaultNewPlacesFields(APP, {})).toBe(APP)
    const s = vaultNewPlacesFields(APP, { newPage: { location: 'folder', folder: 'Inbox' } })
    expect([s.newPageLocation, s.newPageFolder, s.newBoardFolder]).toEqual(['folder', 'Inbox', 'assets'])
    expect(vaultNewPlacesFields(APP, { newBoard: {} }).newBoardFolder).toBe('page')
  })

  it('YAZ-5486 bug: the app\'s vault-relative folder is NOT another vault\'s: a vault without the key takes the default', () => {
    const app = { ...DEFAULT_SETTINGS, newPageLocation: 'folder' as const, newPageFolder: 'Inbox', newBoardPictures: 'folder' as const, newBoardPicturesFolder: 'assets/pics' }
    const s = vaultNewPlacesFields(app, {})
    expect([s.newPageLocation, s.newPageFolder, s.newBoardPictures, s.newBoardPicturesFolder]).toEqual(['current', '', 'inside', ''])
    // A folder outside the vault is no vault's: it stays.
    expect(vaultNewPlacesFields({ ...app, newBoardPicturesFolder: '/Users/x/Pictures' }, {}).newBoardPicturesFolder).toBe('/Users/x/Pictures')
  })

  it('two vaults keep two values', () => {
    expect(vaultNewPlacesFields(APP, { newPage: { location: 'folder', folder: 'A' } }).newPageFolder).toBe('A')
    expect(vaultNewPlacesFields(APP, { newPage: { location: 'folder', folder: 'B' } }).newPageFolder).toBe('B')
  })

  it('the app values as the file holds them', () => {
    expect(newPlacesOfSettings({ ...DEFAULT_SETTINGS, newPageLocation: 'folder', newPageFolder: 'Inbox' })).toEqual({ newPage: { location: 'folder', folder: 'Inbox' }, newBoard: {} })
  })
})
