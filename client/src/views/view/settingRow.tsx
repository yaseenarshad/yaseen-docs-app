import type { ReactNode } from 'react'

/**
 * The View tab's row parts (YAZ-3746 demo polish): a row's icon and label, and the segmented choice for a short set
 * of values. A row with a `ChoiceSeg` is a `div`, never a `label`: a label's click would press its first button.
 */

const ICONS = {
  rowHeight: <path d="M2 3h12M2 13h12M8 5.5v5M6.5 7 8 5.5 9.5 7M6.5 9 8 10.5 9.5 9" />,
  textInCells: <path d="M2 4h12M2 8h9.5a2 2 0 0 1 0 4H8.5M10 10.5 8.5 12l1.5 1.5M2 12h3.5" />,
  rowNumbers: <path d="M6.2 2.5 5 13.5M11.2 2.5 10 13.5M3 6h10.5M2.5 10H13" />,
  columnTypeIcons: <><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" /><path d="M5 6.5h1.5M8.5 6.5H11M5 9.5h1.5M8.5 9.5H11" /></>,
  headerRow: <><rect x="2.5" y="3" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M3.5 4.75h9" /></>,
  subfolders: <path d="M2.5 2.5v8.5h3M2.5 5.5h3M7 8.6a.8.8 0 0 1 .8-.8h2l1 1h2.9a.8.8 0 0 1 .8.8v3.1a.8.8 0 0 1-.8.8H7.8a.8.8 0 0 1-.8-.8zM7 3.6a.8.8 0 0 1 .8-.8h2l1 1h2.9a.8.8 0 0 1 .8.8" />,
  groupIndent: <path d="M2 3h12M7 7.5h7M7 12h7M2 6.5l2.5 2.5L2 11.5" />,
  emptyGroups: <rect x="2.5" y="3" width="11" height="10" rx="1.5" strokeDasharray="2 2" />,
  // YAZ-4798: a header held over rows; a line down from a header; a line lit to the row.
  stickyGroups: <><rect x="2.5" y="2.5" width="11" height="3.5" rx="1" /><path d="M4.5 9h9M4.5 12.5h9" /></>,
  groupLines: <path d="M2.5 3h6M4 4.5v9M6.5 8h7M6.5 12h7" />,
  // YAZ-4878: a thin and a thick line, the calendar grid's line widths.
  lineWidth: <><path d="M2.5 4.5h11" /><path d="M2.5 10.5h11" strokeWidth="3" /></>,
  groupLineStyle: <path d="M2.5 3h6M4 4.5v4.5a3 3 0 0 0 3 3h6.5M8 8h5.5" />,
  columnWidth: <path d="M3 8h10M5 6 3 8l2 2M11 6l2 2-2 2M1.5 3v10M14.5 3v10" />,
  opensIn: <path d="M2.5 3.5h11v10h-11zM2.5 7h11M6.2 7v6.5M9.8 7v6.5" />,
  cardTitles: <><rect x="2" y="4" width="12" height="8" rx="1.5" /><path d="M4.5 7h7M4.5 9.5h4" /></>,
  hideWeekends: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M5 11l6-5" /></>,
  markerStyle: <><path d="M6 4h8M6 8h8M6 12h8" /><circle cx="3" cy="4" r=".9" /><circle cx="3" cy="8" r=".9" /><circle cx="3" cy="12" r=".9" /></>,
  indentProperties: <path d="M2 3.5h12M6 8h8M6 12.5h8M2 7v6" />,
  separator: <><circle cx="7.5" cy="8.5" r="1" /><path d="M8.5 9v1.5c0 1-.7 2-1.7 2.5" /></>,
  showBy: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M5 9.5h2.5" /></>,
  // YAZ-4858: the calendar with a bar across two days; YAZ-4864: a name struck through.
  endDate: <><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M4.5 10h7" /></>,
  crossOut: <path d="M3 5h10M3 11h6M2 8h12" />,
  defaultView: <path d="m8 2.5 1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.6 3.8-.5z" />,
  key: <><circle cx="5.5" cy="10.5" r="2.8" /><path d="m7.5 8.5 6-6M11.5 4.5l1.5 1.5M10 6l1.2 1.2" /></>,
  type: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><circle cx="11.25" cy="4.75" r="2.25" /><path d="M2.5 13.5 4.75 9.5 7 13.5zM9 9h4.5v4.5H9z" /></>,
  relation: <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5L8.2 4.3M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.8-.8" />,
  description: <path d="M2.5 4h11M2.5 8h11M2.5 12h7" />,
  format: <path d="M3 3.5h10M3 3.5v9M3 8h6M11 9.5l2 3M13 9.5l-2 3" />,
  align: <path d="M2 3.5h12M4.5 6.5h7M2 9.5h12M4.5 12.5h7" />,
  currency: <><circle cx="8" cy="8" r="5.8" /><path d="M9.8 6.2c-.3-.6-1-.9-1.8-.9-1 0-1.8.5-1.8 1.3 0 1.8 3.7.9 3.7 2.8 0 .8-.8 1.3-1.9 1.3-.9 0-1.6-.4-1.9-1M8 4v1.3M8 10.7V12" /></>,
  decimals: <><circle cx="4" cy="11.5" r=".9" /><path d="M7.5 5.5h1.8v6M7.5 11.5h3.6M12.8 5.5v6" /></>,
  lock: <><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></>,
  eyeOff: <path d="M2 2l12 12M6.6 4.2A6.8 6.8 0 0 1 8 4c4.1 0 6.5 4 6.5 4a11 11 0 0 1-1.9 2.4M10.4 10.6A3 3 0 0 1 8 11.8C3.9 11.8 1.5 8 1.5 8a11.4 11.4 0 0 1 2.9-3.1M6.6 6.6a2 2 0 0 0 2.8 2.8" />,
  folder: <path d="M2 4.6a1 1 0 0 1 1-1h3l1.3 1.3H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />,
  trash: <path d="M2.5 4.5h11M6.5 4.5V3a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1.5M4 4.5l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6M6.8 7v4.5M9.2 7v4.5" />,
} as const

export type SettingIcon = keyof typeof ICONS

/** A row's label with its 14px glyph before the text; the glyph holds no text, so the label's `textContent` stays the bare words. */
export function RowLabel({ icon, children }: { icon: SettingIcon; children: ReactNode }) {
  return (
    <span className="view-settings-row__label">
      <svg className="view-settings-row__icon" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[icon]}
      </svg>
      {children}
    </span>
  )
}

/** A short set of choices as one segmented control: the pressed one is the value; a press on it writes nothing. */
export function ChoiceSeg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (next: T) => void }) {
  return (
    <div className="view-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" className="view-seg__opt" aria-pressed={v === value} onClick={() => v !== value && onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}
