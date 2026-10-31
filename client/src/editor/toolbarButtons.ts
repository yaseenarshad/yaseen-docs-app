/**
 * The selection toolbar's buttons as people see them (YAZ-3806): each button's name and icon, and each group's name.
 * The toolbar (`createCrepe.ts`) draws the app's own buttons with them, and Settings › Editor › Selection toolbar
 * lists them (`settings/ToolbarArrange.tsx`).
 *
 * Crepe's own buttons (Bold, Italic, Strikethrough, code, link) keep Crepe's icons, which `@milkdown/crepe` does not
 * export: `noteCrepeIcons` copies them here from Crepe's items each time a toolbar builds, so Settings shows the same
 * icons and the bundle holds them once. Before any note has opened, Settings shows those rows by name only. The list
 * icons are Crepe's (`crepe/src/icons`), drawn by the app's own buttons.
 *
 * 🔒 No value import from the editor here: `settings/registry.tsx` imports this file, and the editor modules import
 * each other in a ring (`marks/highlight.ts` → `lineSelection.ts` → … → `noteKeys.ts` → `highlightKeymap`) that
 * Settings must not enter first.
 */
import type { ToolbarButtonId, ToolbarGroupId } from '@shared/types'
import type { HighlightColor } from './marks/highlight'

const svg = (body: string): string => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">${body}</svg>`

/** An `Hn` / `T` / `U` glyph, drawn as text — the label IS the icon. */
const glyphIcon = (label: string, underline = false): string =>
  svg(`<text x="12" y="16.5" text-anchor="middle" font-size="12" font-weight="700" font-family="inherit"${underline ? ' text-decoration="underline"' : ''}>${label}</text>`)

/** A colour dot; the fill IS the wash token, so the button previews the real colour. */
const swatchIcon = (color: HighlightColor): string =>
  svg(`<circle cx="12" cy="12" r="7" fill="var(${color ? `--mark-bg-${color}` : '--mark-bg'})" stroke="currentColor" stroke-opacity="0.35" stroke-width="1"/>`)

/** The app's own buttons' icons, and Crepe's once a toolbar has built (`noteCrepeIcons`). */
export const TOOLBAR_ICONS: Partial<Record<ToolbarButtonId, string>> = {
  h1: glyphIcon('H1'),
  h2: glyphIcon('H2'),
  h3: glyphIcon('H3'),
  text: glyphIcon('T'),
  underline: glyphIcon('U', true),
  highlight: swatchIcon(null),
  'highlight-green': swatchIcon('green'),
  'highlight-blue': swatchIcon('blue'),
  'highlight-pink': swatchIcon('pink'),
  checklist: svg('<path d="M5.66936 16.3389L9.39244 12.6158C9.54115 12.4671 9.71679 12.3937 9.91936 12.3957C10.1219 12.3976 10.2975 12.4761 10.4463 12.6312C10.5847 12.7823 10.654 12.9585 10.654 13.1599C10.654 13.3613 10.5847 13.5363 10.4463 13.6851L6.32704 17.8197C6.14627 18.0004 5.93538 18.0908 5.69436 18.0908C5.45333 18.0908 5.24243 18.0004 5.06166 17.8197L3.01744 15.7754C2.87899 15.637 2.81136 15.4629 2.81456 15.2533C2.81776 15.0437 2.88859 14.8697 3.02706 14.7312C3.16551 14.5928 3.34008 14.5235 3.55076 14.5235C3.76144 14.5235 3.93494 14.5928 4.07126 14.7312L5.66936 16.3389ZM5.66936 8.72359L9.39244 5.00049C9.54115 4.85177 9.71679 4.77838 9.91936 4.78031C10.1219 4.78223 10.2975 4.86075 10.4463 5.01586C10.5847 5.16691 10.654 5.34314 10.654 5.54454C10.654 5.74592 10.5847 5.92097 10.4463 6.06969L6.32704 10.2043C6.14627 10.3851 5.93538 10.4755 5.69436 10.4755C5.45333 10.4755 5.24243 10.3851 5.06166 10.2043L3.01744 8.16009C2.87899 8.02162 2.81136 7.84759 2.81456 7.63799C2.81776 7.42837 2.88859 7.25433 3.02706 7.11586C3.16551 6.97741 3.34008 6.90819 3.55076 6.90819C3.76144 6.90819 3.93494 6.97741 4.07126 7.11586L5.66936 8.72359ZM13.7597 16.5581C13.5472 16.5581 13.3691 16.4862 13.2253 16.3424C13.0816 16.1986 13.0097 16.0204 13.0097 15.8078C13.0097 15.5952 13.0816 15.4171 13.2253 15.2735C13.3691 15.13 13.5472 15.0582 13.7597 15.0582H20.7597C20.9722 15.0582 21.1503 15.1301 21.2941 15.2739C21.4378 15.4177 21.5097 15.5959 21.5097 15.8085C21.5097 16.0211 21.4378 16.1992 21.2941 16.3427C21.1503 16.4863 20.9722 16.5581 20.7597 16.5581H13.7597ZM13.7597 8.94276C13.5472 8.94276 13.3691 8.87085 13.2253 8.72704C13.0816 8.58324 13.0097 8.40504 13.0097 8.19244C13.0097 7.97985 13.0816 7.80177 13.2253 7.65819C13.3691 7.5146 13.5472 7.44281 13.7597 7.44281H20.7597C20.9722 7.44281 21.1503 7.51471 21.2941 7.65851C21.4378 7.80233 21.5097 7.98053 21.5097 8.19311C21.5097 8.40571 21.4378 8.5838 21.2941 8.72739C21.1503 8.87097 20.9722 8.94276 20.7597 8.94276H13.7597Z"/>'),
  bulletList: svg('<path d="M4 10.5C3.17 10.5 2.5 11.17 2.5 12C2.5 12.83 3.17 13.5 4 13.5C4.83 13.5 5.5 12.83 5.5 12C5.5 11.17 4.83 10.5 4 10.5ZM4 4.5C3.17 4.5 2.5 5.17 2.5 6C2.5 6.83 3.17 7.5 4 7.5C4.83 7.5 5.5 6.83 5.5 6C5.5 5.17 4.83 4.5 4 4.5ZM4 16.5C3.17 16.5 2.5 17.18 2.5 18C2.5 18.82 3.18 19.5 4 19.5C4.82 19.5 5.5 18.82 5.5 18C5.5 17.18 4.83 16.5 4 16.5ZM8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19ZM8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13ZM7 6C7 6.55 7.45 7 8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6Z"/>'),
  numberedList: svg('<path d="M8 7H20C20.55 7 21 6.55 21 6C21 5.45 20.55 5 20 5H8C7.45 5 7 5.45 7 6C7 6.55 7.45 7 8 7ZM20 17H8C7.45 17 7 17.45 7 18C7 18.55 7.45 19 8 19H20C20.55 19 21 18.55 21 18C21 17.45 20.55 17 20 17ZM20 11H8C7.45 11 7 11.45 7 12C7 12.55 7.45 13 8 13H20C20.55 13 21 12.55 21 12C21 11.45 20.55 11 20 11ZM4.5 16H2.5C2.22 16 2 16.22 2 16.5C2 16.78 2.22 17 2.5 17H4V17.5H3.5C3.22 17.5 3 17.72 3 18C3 18.28 3.22 18.5 3.5 18.5H4V19H2.5C2.22 19 2 19.22 2 19.5C2 19.78 2.22 20 2.5 20H4.5C4.78 20 5 19.78 5 19.5V16.5C5 16.22 4.78 16 4.5 16ZM2.5 5H3V7.5C3 7.78 3.22 8 3.5 8C3.78 8 4 7.78 4 7.5V4.5C4 4.22 3.78 4 3.5 4H2.5C2.22 4 2 4.22 2 4.5C2 4.78 2.22 5 2.5 5ZM4.5 10H2.5C2.22 10 2 10.22 2 10.5C2 10.78 2.22 11 2.5 11H3.8L2.12 12.96C2.04 13.05 2 13.17 2 13.28V13.5C2 13.78 2.22 14 2.5 14H4.5C4.78 14 5 13.78 5 13.5C5 13.22 4.78 13 4.5 13H3.2L4.88 11.04C4.96 10.95 5 10.83 5 10.72V10.5C5 10.22 4.78 10 4.5 10Z"/>'),
}

/** The app's own icons, for the buttons it adds to the toolbar. */
export const ownIcon = (id: ToolbarButtonId): string => TOOLBAR_ICONS[id]!

/** Keep the icons of Crepe's own buttons, from a toolbar's items, for Settings. */
export function noteCrepeIcons(groups: readonly { items: readonly { key: string; icon?: string }[] }[]): void {
  for (const { items } of groups) for (const { key, icon } of items) if (key in TOOLBAR_LABELS && icon !== undefined) TOOLBAR_ICONS[key as ToolbarButtonId] ??= icon
}

export const TOOLBAR_LABELS: Record<ToolbarButtonId, string> = {
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  text: 'Text',
  checklist: 'Checklist',
  bulletList: 'Bullet list',
  numberedList: 'Numbered list',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strikethrough: 'Strikethrough',
  highlight: 'Highlight',
  'highlight-green': 'Highlight green',
  'highlight-blue': 'Highlight blue',
  'highlight-pink': 'Highlight pink',
  code: 'Inline code',
  link: 'Link',
}

export const TOOLBAR_GROUP_LABELS: Record<ToolbarGroupId, string> = {
  lineType: 'Line type',
  lists: 'Lists',
  textStyle: 'Text style',
  insert: 'Code and link',
}
