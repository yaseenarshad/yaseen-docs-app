import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'

/** The three app settings every code tab shares (YAZ-3449): Settings › Code, and the rows of a code tab's page cog. */
export type CodeSettings = Pick<SettingsState, 'codeReadOnly' | 'codeWrap' | 'codeMinimap'>

export const DEFAULT_CODE_SETTINGS: CodeSettings = { codeReadOnly: DEFAULT_SETTINGS.codeReadOnly, codeWrap: DEFAULT_SETTINGS.codeWrap, codeMinimap: DEFAULT_SETTINGS.codeMinimap }
