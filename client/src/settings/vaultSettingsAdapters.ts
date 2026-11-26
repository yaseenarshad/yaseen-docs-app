/**
 * Pure derived adapters bridging the single unified `useVaultSettings` doc to the 11 existing
 * `VaultScope` section contracts (`reviewSettings`, `linkClick`, `showIds`, `unit`, `textFormatting`,
 * `cardLook`, `tableLook`, `folderPages`, `linkPills`, `dailyPages`, `newPlaces`).
 *
 * Zero additional `vaultConfig.read` calls per vault — every adapter reads a nested section of
 * `vaultSettings.doc` and persists through `vaultSettings.setSection`.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { cardLookFile, cardLookOf, sanitizeCardLook, type CardLook, type CardLookSettings } from '@shared/cardLook'
import { DAILY_PAGES_OFF, dailyPagesFile, readDailyPagesFile, sameDailyPages, type DailyPagesSettings } from '@shared/dailyPagesFile'
import { folderPagesFile, folderPagesOf, folderPagesVault, sanitizeFolderPagesFile, type FolderPagesFile } from '@shared/folderPages'
import { isRecord } from '@shared/guards'
import { sanitizeLinkClick, type LinkClickSettings } from '@shared/linkClick'
import { NO_LINK_PILLS, isDefaultLinkPills, linkPillsFile, sanitizeLinkPills, type LinkPills } from '@shared/linkPills'
import { sanitizeVaultNewPlaces, vaultNewPlacesFile, type VaultNewPlaces } from '@shared/newPlaces'
import { sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { sanitizeShowIds, type ShowIdsSettings } from '@shared/showIds'
import { sanitizeTableLook, tableLookFile, tableLookOf, tableLookSettings, type TableLook, type TableLookSettings } from '@shared/tableLook'
import { sanitizeTextFormatting, textFormattingFile, type TextFormatting } from '@shared/textFormatting'
import type { FolderPagesSettings } from '@shared/types'
import { sanitizeUnitWord, unitTextOf, unitWordOf, type UnitWordSettings } from '@shared/unitWord'
import { VAULT_SETTINGS_FILE, readVaultSection } from '@shared/vaultSettings'
import type { LinkClickState } from '../explore/linkClick'
import type { NoticeKind } from '../lib/notice'
import type { CardLookState } from '../review/useCardLook'
import { publishReviewSettings, type ReviewSettingsState } from '../review/useReviewSettings'
import type { ShowIdsState } from '../search/showIds'
import { publishVaultUnit, type UnitWordState } from '../vault/unitWord'
import type { DailyPagesState } from './useDailyPages'
import type { FolderPagesFileState } from './useFolderPagesFile'
import type { LinkPillsState } from './useLinkPills'
import type { TableLookState } from './useTableLook'
import { NO_TEXT_FORMATTING, type TextFormattingState } from './useTextFormatting'
import { NO_NEW_PLACES, type VaultNewPlacesState } from './useVaultNewPlaces'
import type { VaultSettingsState } from './useVaultSettings'

function useStableValue<T>(next: T): T {
  const ref = useRef<T>(next)
  if (ref.current !== next && JSON.stringify(ref.current) !== JSON.stringify(next)) ref.current = next
  return ref.current
}

const EMPTY_CARD_LOOK: CardLook = Object.freeze({})
const EMPTY_TABLE_LOOK: TableLook = Object.freeze({})
const EMPTY_FOLDER_PAGES: FolderPagesFile = Object.freeze({})

export function useDerivedReviewSettings(
  root: string | null,
  vs: VaultSettingsState,
  onNotice: (text: string, icon?: NoticeKind) => void,
  idsOff = false,
): ReviewSettingsState {
  const raw = readVaultSection(vs.doc, 'review')
  const settings = useStableValue(useMemo(() => sanitizeReviewSettings(raw), [raw]))
  const liveRef = useRef({ settings, raw, malformed: vs.malformed })
  liveRef.current = { settings, raw, malformed: vs.malformed }

  useEffect(() => {
    if (root === null) return
    publishReviewSettings(root, idsOff && settings.enabled ? { ...settings, enabled: false } : settings)
    return () => publishReviewSettings(root, null)
  }, [root, settings, idsOff])

  const save = useCallback(
    (next: ReviewSettings) => {
      if (root === null) return
      if (liveRef.current.malformed) return onNotice(`Can't save the review settings: ${VAULT_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = sanitizeReviewSettings(next)
      const before = liveRef.current.settings
      const changed = Object.fromEntries(
        Object.entries(clean).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key as keyof ReviewSettings])),
      )
      const base = isRecord(liveRef.current.raw) ? liveRef.current.raw : {}
      void vs.setSection('review', { ...base, ...changed })
    },
    [root, onNotice, vs.setSection],
  )

  return useMemo(() => ({ settings, save, ready: vs.ready }), [settings, save, vs.ready])
}

export function useDerivedLinkClick(root: string | null, vs: VaultSettingsState): LinkClickState {
  const raw = readVaultSection(vs.doc, 'linkClick')
  const settings = useStableValue(useMemo(() => sanitizeLinkClick(raw), [raw]))
  const nowRef = useRef(settings)
  nowRef.current = settings
  const isExplore = useCallback(() => nowRef.current.click === 'explore', [])
  const save = useCallback(
    (next: LinkClickSettings) => {
      if (root === null) return
      void vs.setSection('linkClick', { ...sanitizeLinkClick(next) })
    },
    [root, vs.setSection],
  )
  return useMemo(() => ({ settings, save, isExplore }), [settings, save, isExplore])
}

export function useDerivedShowIds(root: string | null, vs: VaultSettingsState): ShowIdsState {
  const raw = readVaultSection(vs.doc, 'showIds')
  const settings = useStableValue(useMemo(() => sanitizeShowIds(raw), [raw]))
  const nowRef = useRef(settings)
  nowRef.current = settings
  const inSearch = useCallback(() => nowRef.current.search, [])
  const inTitle = useCallback(() => nowRef.current.title, [])
  const save = useCallback(
    (next: ShowIdsSettings) => {
      if (root === null) return
      void vs.setSection('showIds', { ...sanitizeShowIds(next) })
    },
    [root, vs.setSection],
  )
  return useMemo(() => ({ settings, save, inSearch, inTitle }), [settings, save, inSearch, inTitle])
}

export function useDerivedUnitWord(root: string | null, vs: VaultSettingsState): UnitWordState {
  const raw = readVaultSection(vs.doc, 'unitWord')
  const settings = useStableValue(useMemo(() => sanitizeUnitWord(raw), [raw]))
  const word = useMemo(() => unitWordOf(settings), [settings])
  const unit = useMemo(() => unitTextOf(word), [word])

  useEffect(() => {
    if (root === null) return
    publishVaultUnit(root, unit)
    return () => publishVaultUnit(root, null)
  }, [root, unit])

  const save = useCallback(
    (next: UnitWordSettings) => {
      if (root === null) return
      void vs.setSection('unitWord', { ...sanitizeUnitWord(next) })
    },
    [root, vs.setSection],
  )
  return useMemo(() => ({ settings, word, unit, save }), [settings, word, unit, save])
}

export function useDerivedTextFormatting(root: string | null, vs: VaultSettingsState, onNotice: (text: string, icon?: NoticeKind) => void): TextFormattingState {
  const raw = readVaultSection(vs.doc, 'textFormatting')
  const formatting = useStableValue(
    useMemo(() => {
      if (vs.malformed || raw === null) return NO_TEXT_FORMATTING
      const clean = sanitizeTextFormatting(raw)
      return Object.keys(clean).length === 0 ? NO_TEXT_FORMATTING : clean
    }, [vs.malformed, raw]),
  )
  const malformedRef = useRef(vs.malformed)
  malformedRef.current = vs.malformed

  const save = useCallback(
    (next: TextFormatting) => {
      if (root === null) return
      if (malformedRef.current) return onNotice(`Can't save the text formatting: ${VAULT_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = sanitizeTextFormatting(next)
      const settled = Object.keys(clean).length === 0 ? NO_TEXT_FORMATTING : clean
      void vs.setSection('textFormatting', textFormattingFile(settled))
    },
    [root, onNotice, vs.setSection],
  )
  return useMemo(() => ({ formatting, save }), [formatting, save])
}

export function useDerivedCardLook(root: string | null, vs: VaultSettingsState, onNotice: (text: string, icon?: NoticeKind) => void): CardLookState {
  const raw = readVaultSection(vs.doc, 'cardLook')
  const look = useStableValue<CardLook | null>(
    useMemo(() => {
      if (vs.malformed) return EMPTY_CARD_LOOK
      if (raw === null) return null
      const clean = sanitizeCardLook(raw)
      return Object.keys(clean).length === 0 ? EMPTY_CARD_LOOK : clean
    }, [vs.malformed, raw]),
  )
  const malformedRef = useRef(vs.malformed)
  malformedRef.current = vs.malformed

  const save = useCallback(
    (next: CardLookSettings) => {
      if (root === null) return
      if (malformedRef.current) return onNotice(`Can't save the card look: ${VAULT_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = sanitizeCardLook(cardLookOf(next))
      void vs.setSection('cardLook', cardLookFile(Object.keys(clean).length === 0 ? EMPTY_CARD_LOOK : clean) as unknown as Record<string, unknown>)
    },
    [root, onNotice, vs.setSection],
  )
  return useMemo(() => ({ look, save }), [look, save])
}

export function useDerivedTableLook(root: string | null, vs: VaultSettingsState, onNotice: (text: string, icon?: NoticeKind) => void): TableLookState {
  const raw = readVaultSection(vs.doc, 'tableLook')
  const look = useStableValue<TableLook | null>(
    useMemo(() => {
      if (vs.malformed) return EMPTY_TABLE_LOOK
      if (raw === null) return null
      const clean = sanitizeTableLook(raw)
      return Object.keys(clean).length === 0 ? EMPTY_TABLE_LOOK : clean
    }, [vs.malformed, raw]),
  )
  const settings = useMemo(() => (look === null ? null : tableLookSettings(look)), [look])
  const malformedRef = useRef(vs.malformed)
  malformedRef.current = vs.malformed

  const save = useCallback(
    (next: TableLookSettings) => {
      if (root === null) return
      if (malformedRef.current) return onNotice(`Can't save the table look: ${VAULT_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = sanitizeTableLook(tableLookOf(next))
      void vs.setSection('tableLook', tableLookFile(Object.keys(clean).length === 0 ? EMPTY_TABLE_LOOK : clean) as unknown as Record<string, unknown>)
    },
    [root, onNotice, vs.setSection],
  )
  return useMemo(() => ({ look, settings, save }), [look, settings, save])
}

export function useDerivedFolderPages(root: string | null, vs: VaultSettingsState, onNotice: (text: string, icon?: NoticeKind) => void): FolderPagesFileState {
  const raw = readVaultSection(vs.doc, 'folderPages')
  const file = useStableValue<FolderPagesFile | null>(
    useMemo(() => {
      if (vs.malformed) return EMPTY_FOLDER_PAGES
      if (raw === null) return null
      const clean = sanitizeFolderPagesFile(raw)
      return Object.keys(clean).length === 0 ? EMPTY_FOLDER_PAGES : clean
    }, [vs.malformed, raw]),
  )
  const vault = useMemo(() => (file === null ? null : folderPagesVault(file)), [file])
  const malformedRef = useRef(vs.malformed)
  malformedRef.current = vs.malformed

  const save = useCallback(
    (next: Partial<FolderPagesSettings>) => {
      if (root === null) return
      if (malformedRef.current) return onNotice(`Can't save the folder page defaults: ${VAULT_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = sanitizeFolderPagesFile(folderPagesOf(next))
      void vs.setSection('folderPages', folderPagesFile(Object.keys(clean).length === 0 ? EMPTY_FOLDER_PAGES : clean))
    },
    [root, onNotice, vs.setSection],
  )
  return useMemo(() => ({ file, vault, save }), [file, vault, save])
}

export function useDerivedLinkPills(root: string | null, vs: VaultSettingsState, onNotice: (text: string, icon?: NoticeKind) => void): LinkPillsState {
  const raw = readVaultSection(vs.doc, 'linkPills')
  const pills = useStableValue(
    useMemo(() => {
      if (vs.malformed || raw === null) return NO_LINK_PILLS
      const clean = sanitizeLinkPills(raw)
      return isDefaultLinkPills(clean) ? NO_LINK_PILLS : clean
    }, [vs.malformed, raw]),
  )
  const malformedRef = useRef(vs.malformed)
  malformedRef.current = vs.malformed

  const save = useCallback(
    (next: LinkPills) => {
      if (root === null) return
      if (malformedRef.current) return onNotice(`Can't save the link pills: ${VAULT_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = sanitizeLinkPills(next)
      void vs.setSection('linkPills', linkPillsFile(isDefaultLinkPills(clean) ? NO_LINK_PILLS : clean))
    },
    [root, onNotice, vs.setSection],
  )
  return useMemo(() => ({ pills, save }), [pills, save])
}

export function useDerivedDailyPages(root: string | null, vs: VaultSettingsState, onNotice: (text: string, icon?: NoticeKind) => void): DailyPagesState {
  const raw = readVaultSection(vs.doc, 'dailyPages')
  const file = useStableValue<DailyPagesSettings | null>(
    useMemo(() => {
      if (vs.malformed) return DAILY_PAGES_OFF
      return raw === null ? null : readDailyPagesFile(raw)
    }, [vs.malformed, raw]),
  )
  const liveRef = useRef({ file, malformed: vs.malformed })
  liveRef.current = { file, malformed: vs.malformed }

  const save = useCallback(
    (next: DailyPagesSettings) => {
      if (root === null) return
      if (liveRef.current.malformed) return onNotice(`Can't save the daily pages: ${VAULT_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = readDailyPagesFile(dailyPagesFile(next))
      if (liveRef.current.file !== null && sameDailyPages(liveRef.current.file, clean)) return
      void vs.setSection('dailyPages', dailyPagesFile(clean))
    },
    [root, onNotice, vs.setSection],
  )
  return useMemo(() => ({ file, save }), [file, save])
}

export function useDerivedNewPlaces(root: string | null, vs: VaultSettingsState, onNotice: (text: string, icon?: NoticeKind) => void): VaultNewPlacesState {
  const raw = readVaultSection(vs.doc, 'newPlaces')
  const value = useStableValue<VaultNewPlaces>(
    useMemo(() => {
      if (vs.malformed || raw === null) return NO_NEW_PLACES
      const clean = sanitizeVaultNewPlaces(raw)
      return Object.keys(clean).length === 0 ? NO_NEW_PLACES : clean
    }, [vs.malformed, raw]),
  )
  const liveRef = useRef({ value, raw, malformed: vs.malformed })
  liveRef.current = { value, raw, malformed: vs.malformed }

  const save = useCallback(
    (next: VaultNewPlaces) => {
      if (root === null) return
      if (liveRef.current.malformed) return onNotice(`Can't save where new things go: ${VAULT_SETTINGS_FILE} is not valid JSON`, 'error')
      const clean = sanitizeVaultNewPlaces(next)
      if (JSON.stringify(clean) === JSON.stringify(liveRef.current.value)) return
      const existing = isRecord(liveRef.current.raw) ? liveRef.current.raw : {}
      const hasPlaces = Array.isArray(existing.places)
      const nextSection = { ...existing, ...vaultNewPlacesFile(clean, !hasPlaces) }
      if (clean.newPage === undefined) delete nextSection.newPage
      if (clean.newBoard === undefined) delete nextSection.newBoard
      void vs.setSection('newPlaces', nextSection)
    },
    [root, onNotice, vs.setSection],
  )
  return useMemo(() => ({ value, save }), [value, save])
}
