import { readdir } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { CONTRACT } from '@shared/ipc'
import { CARD_SKILL_FORMATS, cardFormatNames, cardSkillFolder, type CardSkillFormats } from '@shared/cardSkillFolder'
import { CARD_SKILL_DIR } from '../cardSkill'
import { handle } from './envelope'

const isFolder = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true

/**
 * The `formats` folder of the card skill `vault` uses, and its names (YAZ-5114): the vault's own `Card skill` folder
 * wins over the app's copy `<userData>/card-skill` (suggestion 18). Null when that skill has no `formats` folder.
 */
export async function cardSkillFormats(vault: string | null, userData: string): Promise<CardSkillFormats | null> {
  const skill = cardSkillFolder(vault, join(userData, CARD_SKILL_DIR), isFolder)
  const folder = join(skill, CARD_SKILL_FORMATS)
  const files = await readdir(folder).catch(() => null)
  return files === null ? null : { folder, formats: cardFormatNames(files) }
}

/** `app:card-formats` (YAZ-5114): read only. A `vault` that is not a string is the app's copy. */
export function registerCardFormatsIpc(userData: string): void {
  handle(CONTRACT.app.cardFormats, async (vault: unknown) => cardSkillFormats(typeof vault === 'string' && vault !== '' ? vault : null, userData))
}
