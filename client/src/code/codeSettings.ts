import type { SettingsState } from '@shared/types'

/** The three app settings every code tab shares (YAZ-3449): Settings › Code, and the rows of a code tab's page cog. */
export type CodeSettings = Pick<SettingsState, 'codeReadOnly' | 'codeWrap' | 'codeMinimap'>

/**
 * What a code tab writes through its one settings door (`onChangeCodeSettings`): the cog's rows, and the code
 * Outline's "…" menu, Sort by and Show (YAZ-3486, YAZ-3507), one value for every code tab.
 */
export type CodeSettingsPatch = Partial<CodeSettings & Pick<SettingsState, 'codeOutlineSort' | 'codeOutlineHidden' | 'codeOutlineLocals'>>
