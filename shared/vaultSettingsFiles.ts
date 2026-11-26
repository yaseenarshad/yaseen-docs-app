import { CARD_LOOK_FILE } from './cardLook'
import { DAILY_PAGES_FILE } from './dailyPagesFile'
import { FOLDER_PAGES_FILE } from './folderPages'
import { LINK_CLICK_FILE } from './linkClick'
import { LINK_PILLS_FILE } from './linkPills'
import { MOBILE_SETTINGS_FILE } from './mobileSettings'
import { NEW_PLACES_FILE } from './newPlaces'
import { REVIEW_SETTINGS_FILE } from './reviews'
import { SHOW_IDS_FILE } from './showIds'
import { TABLE_LOOK_FILE } from './tableLook'
import { TEXT_FORMATTING_FILE } from './textFormatting'
import { UNIT_WORD_FILE } from './unitWord'
import { ICONS_FILE } from './vaultIcons'
import { VAULT_SETTINGS_FILE } from './vaultSettings'

/**
 * THE VAULT'S SETTINGS FILES (YAZ-5559, unified in YAZ-6546):
 * - `settings.json` is the single unified settings file for a vault (all sparse per-vault overrides + consolidated
 *   legacy sections).
 * - `icons.json` stays separate because it holds up to 5,000 per-path icon assignments (vault data + rules/colors).
 * - `LEGACY_VAULT_SETTINGS_HEALTH_FILES` lists the 12 retired filenames so mobile Vault Health can still flag any
 *   unmigrated malformed legacy file until consolidated.
 */
export interface VaultSettingsFile {
  /** The file's name in `.yaseendocs/`. */
  file: string
  /** The setting, in short plain words, lower case ("vault settings"). */
  label: string
}

export const VAULT_SETTINGS_FILES: readonly VaultSettingsFile[] = [
  { file: VAULT_SETTINGS_FILE, label: 'vault settings' },
  { file: ICONS_FILE, label: 'icons' },
]

export const LEGACY_VAULT_SETTINGS_HEALTH_FILES: readonly VaultSettingsFile[] = [
  { file: TEXT_FORMATTING_FILE, label: 'text formatting' },
  { file: LINK_PILLS_FILE, label: 'link pills' },
  { file: LINK_CLICK_FILE, label: 'link clicks' },
  { file: TABLE_LOOK_FILE, label: 'table look' },
  { file: CARD_LOOK_FILE, label: 'card look' },
  { file: REVIEW_SETTINGS_FILE, label: 'review' },
  { file: DAILY_PAGES_FILE, label: 'daily pages' },
  { file: FOLDER_PAGES_FILE, label: 'folder pages' },
  { file: NEW_PLACES_FILE, label: 'new places' },
  { file: SHOW_IDS_FILE, label: 'show IDs' },
  { file: UNIT_WORD_FILE, label: 'unit word' },
  { file: MOBILE_SETTINGS_FILE, label: 'mobile' },
]
