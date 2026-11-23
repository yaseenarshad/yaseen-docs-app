/** Context-menu sections for indented inline drawing and inline card rows in Sidebar Search (YAZ-6143, YAZ-6155). */
import { landOnCard } from '../editor/card/cardOpen'
import { landOnInlineDrawing } from '../editor/drawing/inlineDrawingLand'
import type { SearchCandidate } from '../search/searchCandidates'
import type { MenuSection } from './menuSections'

export interface InlineRowMenuHandlers {
  openSearchCard: (row: SearchCandidate, background: boolean) => void
  onOpenFile: (path: string) => void
  onOpenFileBackground: (path: string) => void
  unit: (text: string) => string
}

export function inlineRowMenuSections(card: SearchCandidate, { openSearchCard, onOpenFile, onOpenFileBackground, unit }: InlineRowMenuHandlers): MenuSection[] {
  const page = card.page ?? card.path
  if (card.inlineDrawing === true) {
    return [
      [
        { id: 'open-drawing-tab', label: 'Open in new tab', onSelect: () => openSearchCard(card, true) },
        {
          id: 'show-in-page',
          label: unit('Show in page'),
          onSelect: () => {
            if (card.index !== undefined) landOnInlineDrawing(page, card.index)
            onOpenFile(page)
          },
        },
      ],
    ]
  }
  return [
    [
      {
        id: 'open-card-tab',
        label: 'Open in new tab',
        onSelect: () => {
          if (card.id !== undefined) landOnCard(page, card.id)
          onOpenFileBackground(page)
        },
      },
      {
        id: 'show-in-page',
        label: unit('Show in page'),
        onSelect: () => {
          if (card.id !== undefined) landOnCard(page, card.id)
          onOpenFile(page)
        },
      },
    ],
  ]
}
