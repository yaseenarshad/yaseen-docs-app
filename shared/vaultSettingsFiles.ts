import { CARD_LOOK_FILE } from './cardLook'
import { DAILY_PAGES_FILE } from './dailyPagesFile'
import { FOLDER_PAGES_FILE } from './folderPages'
import { LINK_CLICK_FILE } from './linkClick'
import { LINK_PILLS_FILE } from './linkPills'
import { NEW_PLACES_FILE } from './newPlaces'
import { REVIEW_SETTINGS_FILE } from './reviews'
import { SHOW_IDS_FILE } from './showIds'
import { TABLE_LOOK_FILE } from './tableLook'
import { TEXT_FORMATTING_FILE } from './textFormatting'
import { ICONS_FILE } from './vaultIcons'

/**
 * THE VAULT'S SETTINGS FILES (YAZ-5559): the files of `<vault>/.yaseendocs/` that hold a SETTING of the vault. With
 * the file missing (or not valid JSON) the vault uses the Mac's defaults for that setting. Each name comes from its own
 * module (its one home), so this list never spells a file name a second time. The phone's Settings › Vault health reads
 * it. A new vault settings file goes here too, with its plain words.
 *
 * Not here: the vault's data and lists (`favorites.json`, `people.json`, `friends.json`, `properties.json`, `ids.json`,
 * `media.json`, focus folders), which are not settings with a default; and `unit-word.json`, whose home is the client
 * (`client/src/vault/unitWordText.ts`), which shared code does not import.
 */
export interface VaultSettingsFile {
  /** The file's name in `.yaseendocs/`. */
  file: string
  /** The setting, in short plain words, lower case ("table look"). */
  label: string
}

export const VAULT_SETTINGS_FILES: readonly VaultSettingsFile[] = [
  { file: TEXT_FORMATTING_FILE, label: 'text formatting' },
  { file: LINK_PILLS_FILE, label: 'link pills' },
  { file: LINK_CLICK_FILE, label: 'link clicks' },
  { file: TABLE_LOOK_FILE, label: 'table look' },
  { file: CARD_LOOK_FILE, label: 'card look' },
  { file: REVIEW_SETTINGS_FILE, label: 'review' },
  { file: DAILY_PAGES_FILE, label: 'daily pages' },
  { file: FOLDER_PAGES_FILE, label: 'folder pages' },
  { file: NEW_PLACES_FILE, label: 'new places' },
  { file: ICONS_FILE, label: 'icons' },
  { file: SHOW_IDS_FILE, label: 'show IDs' },
]
