/** Context-menu sections and copy helpers for indented inline drawing and inline card rows in Sidebar Search (YAZ-6143, YAZ-6155, YAZ-6469). */
import { createElement } from 'react'
import { keyHint, type HotkeyOverrides } from '@shared/hotkeyBindings'
import { parseInlineRef } from '@shared/inlineRef'
import { landOnCard, openCardWindow } from '../editor/card/cardOpen'
import { landOnInlineDrawing } from '../editor/drawing/inlineDrawingLand'
import { copyText } from '../lib/copyText'
import { resolveInlineCopyPath } from '../lib/inlinePath'
import type { NoticeKind, NoticeType } from '../lib/notice'
import type { SearchCandidate } from '../search/searchCandidates'
import { CopyIcon } from '../views/view/icons'
import { errorText, type MenuAction, type MenuSection } from './menuSections'

export interface InlineRowMenuHandlers {
  openSearchCard: (row: SearchCandidate, background: boolean) => void
  onOpenFile: (path: string) => void
  onOpenFileBackground: (path: string) => void
  onOpenNewWindow?: (path: string) => void
  onRevealInFiles: (path: string, focus?: boolean) => void
  onOpenInlineDrawingExplore?: (path: string, index: number) => void
  onOpenCardExplore?: (path: string, id: string, index: number) => void
  onOpenVsCode: (path: string) => void
  onOpenDefault: (path: string) => void
  onReveal: (path: string) => void
  onNotice: (message: string, kind?: NoticeKind, type?: NoticeType) => void
  hotkeys?: HotkeyOverrides
  unit: (text: string) => string
}

/**
 * Resolves and copies the canonical path for a Sidebar Search row: `<pagePath>:<1-based line>`
 * for inline cards and inline drawings, or `path` directly for regular files/folders.
 */
export async function copySearchRowPath(
  path: string,
  card: SearchCandidate | undefined,
  onNotice: (message: string, kind?: NoticeKind, type?: NoticeType) => void,
): Promise<void> {
  const ref =
    card !== undefined
      ? card.inlineDrawing === true && card.index !== undefined
        ? { kind: 'drawing' as const, page: card.page ?? card.path, index: card.index }
        : card.id !== undefined
          ? { kind: 'card' as const, page: card.page ?? card.path, id: card.id }
          : parseInlineRef(card.path)
      : parseInlineRef(path)
  const resolved = ref !== null ? await resolveInlineCopyPath(ref, card?.index) : path
  try {
    await navigator.clipboard.writeText(resolved)
    onNotice('Copied path', 'info', 'clipboard')
  } catch (error: unknown) {
    onNotice(`Can't copy path: ${errorText(error)}`)
  }
}

export function inlineRowMenuSections(
  card: SearchCandidate,
  {
    openSearchCard,
    onOpenFile,
    onOpenFileBackground,
    onOpenNewWindow,
    onRevealInFiles,
    onOpenInlineDrawingExplore,
    onOpenCardExplore,
    onOpenVsCode,
    onOpenDefault,
    onReveal,
    onNotice,
    hotkeys,
    unit,
  }: InlineRowMenuHandlers,
): MenuSection[] {
  const page = card.page ?? card.path
  const notifyCopy = (message: string): void => {
    if (message.startsWith('Copied')) onNotice(message, 'info', 'clipboard')
    else onNotice(message)
  }
  const openInGroup: MenuSection = [
    {
      id: 'open-in',
      label: 'Open in',
      children: [
        [
          { id: 'open-vscode', label: 'VS Code', onSelect: () => onOpenVsCode(page) },
          { id: 'open-default', label: 'Default app', onSelect: () => onOpenDefault(page) },
        ],
        [{ id: 'reveal', label: 'Reveal in Finder', onSelect: () => onReveal(page) }],
      ],
    },
  ]
  const copyPathItem: MenuAction = {
    id: 'copy-path',
    label: 'Copy path',
    icon: createElement(CopyIcon),
    hint: keyHint('copyPath', hotkeys),
    onSelect: () => {
      void copySearchRowPath(card.path, card, onNotice)
    },
  }

  if (card.inlineDrawing === true) {
    const openGroup: MenuSection = [
      {
        id: 'show-in-page',
        label: unit('Show in page'),
        onSelect: () => {
          if (card.index !== undefined) landOnInlineDrawing(page, card.index)
          onOpenFile(page)
        },
      },
      { id: 'open-drawing-tab', label: 'Open in new tab', onSelect: () => openSearchCard(card, true) },
      ...(onOpenNewWindow !== undefined ? [{ id: 'open-window', label: 'Open in new window', onSelect: () => onOpenNewWindow(page) }] : []),
      ...(onOpenInlineDrawingExplore !== undefined && card.index !== undefined
        ? [{ id: 'open-in-explore', label: 'Open in Explore', onSelect: () => onOpenInlineDrawingExplore(page, card.index!) }]
        : []),
      { id: 'show-in-sidebar', label: 'Show in sidebar', onSelect: () => onRevealInFiles(page) },
    ]
    return [openGroup, [copyPathItem], openInGroup]
  }

  const openGroup: MenuSection = [
    {
      id: 'show-in-page',
      label: unit('Show in page'),
      onSelect: () => {
        if (card.id !== undefined) landOnCard(page, card.id)
        onOpenFile(page)
      },
    },
    {
      id: 'open-card-tab',
      label: 'Open in new tab',
      onSelect: () => {
        if (card.id !== undefined) landOnCard(page, card.id)
        onOpenFileBackground(page)
      },
    },
    ...(onOpenNewWindow !== undefined ? [{ id: 'open-window', label: 'Open in new window', onSelect: () => onOpenNewWindow(page) }] : []),
    ...(card.id !== undefined
      ? [
          {
            id: 'open-in-explore',
            label: 'Open in Explore',
            onSelect: () => {
              if (onOpenCardExplore !== undefined) onOpenCardExplore(page, card.id!, card.index ?? 0)
              else openCardWindow(page, card.id!, card.index ?? 0)
            },
          },
        ]
      : []),
    { id: 'show-in-sidebar', label: 'Show in sidebar', onSelect: () => onRevealInFiles(page) },
  ]
  const copyGroup: MenuSection = [
    copyPathItem,
    ...(card.id !== undefined
      ? [
          {
            id: 'copy-card-id',
            label: 'Copy card ID',
            icon: createElement(CopyIcon),
            hint: card.id,
            onSelect: () => copyText(card.id!, 'card ID', notifyCopy, undefined, true),
          },
          {
            id: 'copy-card-link',
            label: 'Copy card link',
            icon: createElement(CopyIcon),
            onSelect: () => copyText(`[[${card.id!}]]`, 'card link', notifyCopy, undefined, true),
          },
        ]
      : []),
  ]
  return [openGroup, copyGroup, openInGroup]
}
