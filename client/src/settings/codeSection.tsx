/**
 * SETTINGS › CODE (YAZ-3449; YAZ-3438 D5, D6, D8): the three switches every code tab shares. Each one is
 * also a row of a code tab's page cog, which writes the same `SettingsState` field: a change here or there
 * reaches every open code tab at once. In the nav after Editor.
 *
 * - Open code files read only (D5; the cog row is "Read only (all code files)"): every code tab opens read only, with the Read only chip. "Allow edits" on a tab's chip
 *   unlocks that tab until it closes; the setting stays.
 * - Wrap long lines (D8): on by default. Alt+Z flips one tab and saves nothing; a change here overrides it.
 * - Minimap (D6): off by default.
 * - Jump across files (YAZ-3500): off by default. The language helpers start only with it on; the first
 *   switch-on asks, then downloads them (`LanguageHelpersControl`). Not on the cog: it is not about one tab.
 */
import { Segmented } from './controls'
import { storage } from '../lib/storage'
import { LanguageHelpersControl } from './LanguageHelpersControl'
import { ON_OFF_OPTIONS } from './options'
import type { SettingsSection } from './registry'

const CODE_WORDS = ['code', 'monaco', 'source', 'programming', 'vs code']

export const CODE_SECTION: SettingsSection = {
  id: 'code',
  title: 'Code',
  groups: [
    {
      hint: 'For every code file (.ts, .py, .json, …). Each code tab’s page cog has the same switches, marked “(all code files)”.',
      items: [
        {
          id: 'codeReadOnly',
          label: 'Open code files read only',
          hint: 'Every code tab opens read only. “Allow edits” on a tab’s Read only chip unlocks that tab until you close it.',
          keywords: [...CODE_WORDS, 'lock', 'locked', 'edit', 'view only'],
          render: ({ settings, onChange }) => (
            <Segmented options={ON_OFF_OPTIONS} value={settings.codeReadOnly} onChange={(codeReadOnly) => onChange({ ...settings, codeReadOnly })} ariaLabel="Code files read only" />
          ),
        },
        {
          id: 'codeWrap',
          label: 'Wrap long lines',
          hint: '⌥Z flips one tab until you close it.',
          keywords: [...CODE_WORDS, 'word wrap', 'soft wrap', 'line wrap', 'horizontal scroll'],
          render: ({ settings, onChange }) => (
            <Segmented options={ON_OFF_OPTIONS} value={settings.codeWrap} onChange={(codeWrap) => onChange({ ...settings, codeWrap })} ariaLabel="Wrap long lines in code files" />
          ),
        },
        {
          id: 'codeMinimap',
          label: 'Minimap',
          hint: 'A small picture of the whole file at the right edge.',
          keywords: [...CODE_WORDS, 'overview', 'scrollbar', 'map'],
          render: ({ settings, onChange }) => (
            <Segmented options={ON_OFF_OPTIONS} value={settings.codeMinimap} onChange={(codeMinimap) => onChange({ ...settings, codeMinimap })} ariaLabel="Minimap in code files" />
          ),
        },
        {
          id: 'codeLanguageHelpers',
          label: 'Jump across files (Cmd+click, Shift+F12)',
          hint: 'For TypeScript, JavaScript, React and Python. The first time, it downloads two helper tools.',
          keywords: [...CODE_WORDS, 'go to definition', 'definition', 'references', 'find references', 'language server', 'lsp', 'typescript', 'python', 'pyright', 'f12', 'cmd click'],
          // The settings of the moment, not of this render: a download can end after Settings closed and other settings changed.
          render: ({ settings, onChange }) => <LanguageHelpersControl on={settings.codeLanguageHelpers === true} onSet={(codeLanguageHelpers) => onChange({ ...(storage.getSettings() ?? settings), codeLanguageHelpers })} />,
        },
      ],
    },
  ],
}
