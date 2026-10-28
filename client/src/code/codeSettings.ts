import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'

/** The three app settings every code tab shares (YAZ-3449): Settings › Code, and the rows of a code tab's page cog. */
export type CodeSettings = Pick<SettingsState, 'codeReadOnly' | 'codeWrap' | 'codeMinimap'>

/** The code Outline's view (YAZ-3486): its "…" menu's Sort by and Show, one value for every code tab. */
export type CodeOutlineSettings = Pick<SettingsState, 'codeOutlineSort' | 'codeOutlineHidden'>

/** What a code tab writes through its one settings door: the cog's rows and the Outline's menu. */
export type CodeSettingsPatch = Partial<CodeSettings & CodeOutlineSettings>

export const DEFAULT_CODE_SETTINGS: CodeSettings = { codeReadOnly: DEFAULT_SETTINGS.codeReadOnly, codeWrap: DEFAULT_SETTINGS.codeWrap, codeMinimap: DEFAULT_SETTINGS.codeMinimap }
