/**
 * `shared/cardSkillFolder.ts` (YAZ-5110, suggestion 18): the user's version of the card skill wins over the app's copy.
 */
import { describe, expect, it } from 'vitest'
import { CARD_SKILL_FOLDER_NAME, cardSkillFolder } from '@shared/cardSkillFolder'

const APP_COPY = '/Users/me/Library/Application Support/Yaseen Docs/card-skill'

describe('cardSkillFolder', () => {
  it("is the vault's own `Card skill` folder when it exists", () => {
    const asked: string[] = []
    const isFolder = (path: string): boolean => (asked.push(path), path === '/vault/Card skill')
    expect(cardSkillFolder('/vault', APP_COPY, isFolder)).toBe('/vault/Card skill')
    expect(asked).toEqual(['/vault/Card skill'])
    expect(CARD_SKILL_FOLDER_NAME).toBe('Card skill')
  })

  it("is the app's copy when the vault has no `Card skill` folder", () => {
    expect(cardSkillFolder('/vault', APP_COPY, () => false)).toBe(APP_COPY)
  })

  it("is the app's copy with no vault, and asks nothing", () => {
    expect(cardSkillFolder(null, APP_COPY, () => {
      throw new Error('asked')
    })).toBe(APP_COPY)
  })

  it("joins with the vault's own separator, and a trailing one is not doubled", () => {
    expect(cardSkillFolder('C:\\Users\\me\\vault', APP_COPY, () => true)).toBe('C:\\Users\\me\\vault\\Card skill')
    expect(cardSkillFolder('/vault/', APP_COPY, () => true)).toBe('/vault/Card skill')
  })
})
