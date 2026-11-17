/**
 * THE CARD EDITOR'S ON/OFF LIST (YAZ-5026, the description's list, agreed): the same engine as the page, its own set of
 * features. No page feature goes into cards by itself. The rule for "on": the Inbox (`renderCard`) can draw it too.
 * A page feature goes into cards later with ONE switch here.
 *
 * On: bold, italic, strikethrough, underline, inline code; headings, bullet and number lists, quotes, the line (`***`);
 * links and pills (`[[page]]`, `[[DEMO-127]]`); images, sound and the boards that exist; code blocks; plain tables; the
 * selection toolbar with "Hide word ⌘L"; the `/` menu with "New side"; spell check.
 *
 * Off: calendar tables, the table zoom pill and cell notes; check lists (the Inbox drops their boxes); a card inside a
 * card; folding, zoom into a bullet, the table of contents, ⌘F find and the block handle; "New drawing" in the `/` menu
 * (a board that exists still shows); highlight colours (a shown hidden word is already a highlight; decided on YAZ-5026).
 */
import type { CreateCrepeOptions } from '../createCrepe'
import { CrepeFeature } from '../crepe'
import { features } from '../featureConfig'
import { MORE_KEY } from '../highlightPanel'
import { hideWordButton, newSideSlashRow } from './cardEditor'

/** Each switch of the card editor. `true`: as in the page. */
export const CARD_EDITOR_FEATURES = {
  toolbar: true,
  slashMenu: true,
  pills: true,
  images: true,
  boards: true,
  codeBlocks: true,
  tables: true,
  spellCheck: true,
  highlight: false,
  checkLists: false,
  calendarTables: false,
  tableZoom: false,
  cellNotes: false,
  cardInCard: false,
  folding: false,
  zoom: false,
  tableOfContents: false,
  find: false,
  blockHandle: false,
  newDrawing: false,
} as const

const off = (on: boolean, keys: readonly string[]): readonly string[] => (on ? [] : keys)

/** The toolbar buttons the card editor hides, by key. */
export const CARD_EDITOR_HIDDEN_TOOLBAR: readonly string[] = [
  ...off(CARD_EDITOR_FEATURES.highlight, ['highlight', 'highlight-green', 'highlight-blue', MORE_KEY]),
  ...off(CARD_EDITOR_FEATURES.checkLists, ['checklist']),
]

/** The `/` rows the card editor hides, by key. */
export const CARD_EDITOR_HIDDEN_SLASH: readonly string[] = [
  ...off(CARD_EDITOR_FEATURES.checkLists, ['task-list']),
  ...off(CARD_EDITOR_FEATURES.calendarTables, ['calendar-table']),
  ...off(CARD_EDITOR_FEATURES.cardInCard, ['card']),
  ...off(CARD_EDITOR_FEATURES.newDrawing, ['drawing', 'diagram']),
]

/**
 * The options of a card's editor, from its page's (`outer`): the page's link sources, pills, images and boards; none of
 * the page's own channels (find, table of contents, outside changes, save), and the switches above.
 */
export function cardEditorOptions(outer: CreateCrepeOptions, root: HTMLElement): CreateCrepeOptions {
  const f = CARD_EDITOR_FEATURES
  return {
    root,
    defaultValue: '',
    features: { ...features, [CrepeFeature.Toolbar]: f.toolbar, [CrepeFeature.BlockEdit]: f.slashMenu, [CrepeFeature.CodeMirror]: f.codeBlocks, [CrepeFeature.Table]: f.tables },
    ...(f.pills ? {
      wikilinks: outer.wikilinks,
      linkLook: outer.linkLook,
      viewOnlyLinks: outer.viewOnlyLinks,
      wikilinkCandidates: outer.wikilinkCandidates,
      wikilinkNav: outer.wikilinkNav,
      vaultsOfLetters: outer.vaultsOfLetters,
      wikilinkHover: outer.wikilinkHover,
      markdownLinkNav: outer.markdownLinkNav,
      pathPaste: outer.pathPaste,
    } : {}),
    ...(f.images ? { image: outer.image } : {}),
    ...(f.boards && outer.boardEmbeds !== undefined ? { boardEmbeds: outer.boardEmbeds } : {}),
    ...(f.newDrawing ? { drawing: outer.drawing } : {}),
    hotkeys: outer.hotkeys,
    onCopyNotice: outer.onCopyNotice,
    enterKeepsStyle: outer.enterKeepsStyle,
    foldingOn: () => f.folding,
    outlineZoom: f.zoom,
    cellNotes: f.cellNotes,
    tableZoomPill: f.tableZoom,
    cardBlocks: f.cardInCard,
    hidden: { toolbar: CARD_EDITOR_HIDDEN_TOOLBAR, slash: CARD_EDITOR_HIDDEN_SLASH },
    extendToolbar: hideWordButton,
    extendSlash: newSideSlashRow,
  }
}
