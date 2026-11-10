/**
 * The (i) words of a drawing's and a diagram's cog rows (YAZ-4748 demo): what each row does, and where the choice is kept.
 * A diagram's cog imports them too, so they live apart from the drawing editor (and its engine).
 */
import type { Hint } from '../editor/PageSettings'

type Kind = 'drawing' | 'diagram'

export const readOnlyHint = (kind: Kind): Hint => `Stops edits to this ${kind}. The switch is saved in the file, so it goes where the file goes.`

export const linkPreviewHint = (kind: Kind): Hint =>
  `Rest the mouse on a link pill in this ${kind} to see the linked page. Settings › Files & Links › Preview on hover › Links in drawings and diagrams must be on too. Saved in this file.`

export const foldArrowsHint = (appMode: string | undefined): Hint => ({
  lead: 'The arrows left of a bullet in a text box. A folded bullet always shows its arrow.',
  rows: [
    ['App', `Follows Settings › Drawings and diagrams${appMode === undefined ? '' : ` (now ${appMode})`}`],
    ['Hover', 'Arrows show on hover'],
    ['Always', 'Arrows always show'],
    ['Off', 'No folding: every line shows, the folds stay saved'],
  ],
  foot: 'Saved in this file.',
})

export const hoverOutlineHint = (appMode: string | undefined): Hint => ({
  lead: 'A faint outline shows what a click will pick, while you hover.',
  rows: [
    ['App', `Follows Settings › Drawings and diagrams${appMode === undefined ? '' : ` (now ${appMode})`}`],
    ['On', 'The outline shows'],
    ['Off', 'No outline on hover'],
  ],
  foot: 'Saved in this file.',
})

export const PICTURE_HINTS = {
  inside: "Moves this drawing's pictures into its own file.",
  assets: "Moves this drawing's pictures out of its file, into the vault's assets folder.",
  folder: "Moves this drawing's pictures to a folder you pick.",
  allow: 'Lets this drawing keep its new pictures in that folder on this Mac.',
} as const

export const EXPORT_IMAGE_HINT: Hint = 'Saves a picture or a PDF of this drawing, to a place you pick.'
export const EXPORT_DRAWING_HINT: Hint = 'Saves a copy of this drawing as an .excalidraw file, which Excalidraw can open.'
