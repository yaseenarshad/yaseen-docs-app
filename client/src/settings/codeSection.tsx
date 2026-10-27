/**
 * SETTINGS › CODE (YAZ-3449; YAZ-3438 D5, D6, D8): the three switches every code tab shares. Each one is
 * also a row of a code tab's page cog, which writes the same `SettingsState` field: a change here or there
 * reaches every open code tab at once. In the nav after Editor.
 *
 * - Read only (D5): every code tab opens read only, with the Read only chip. "Allow edits" on a tab's chip
 *   unlocks that tab until it closes; the setting stays.
 * - Wrap long lines (D8): on by default. Alt+Z flips one tab and saves nothing; a change here overrides it.
 * - Minimap (D6): off by default.
 */
import { Segmented } from './controls'
import { ON_OFF_OPTIONS } from './options'
import type { SettingsSection } from './registry'

const CODE_WORDS = ['code', 'monaco', 'source', 'programming', 'vs code']

export const CODE_SECTION: SettingsSection = {
  id: 'code',
  title: 'Code',
  groups: [
    {
      hint: 'For every code file (.ts, .py, .json, …). Each code tab’s page cog has the same switches.',
      items: [
        {
          id: 'codeReadOnly',
          label: 'Read only',
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
      ],
    },
  ],
}
