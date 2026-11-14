/**
 * The page's "Folding" switch (YAZ-4094 F1): on or off for one editor. View state only, like the folds.
 *
 * Off: the bullet and heading fold plugins (`outlineFolding.ts`, `headingFolding.ts`) draw no chevron, hide
 * nothing and take no fold request, and their queries (`collapsedItemsHiding`, `isHeadingCollapsed`, …) report
 * an open page — so CMD+F, outside changes, the TOC, the caret guard and "Copy without folded lines" all see
 * what the reader sees. The plugins KEEP their collapsed set and map it through edits, so the page's saved
 * folds (`folders[root].folds`) stay and come back when the switch is on again (F3). The saved keys change only
 * when an edit renames or deletes a folded row: the plugin then reports the kept set under its new keys. The
 * caret guard opens only the saved folds that would hide the caret then (`foldReveal.ts`).
 *
 * The host turns it with `setFoldingOn` (a meta-only transaction, no remount). A fold key on a page with
 * folding off calls `onBlocked` (the host's "Folding is off on this page" message) through `foldingBlocked`, only
 * when the command runs: a dry run (no `dispatch`) shows nothing.
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { type EditorState, Plugin, PluginKey, type Transaction } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

const pluginKey = new PluginKey<boolean>('mdapp-folding-switch')

/** The page host's message for a fold key on a page with folding off (YAZ-4094 item 12). One notice at a time: a new one replaces it. */
export const FOLDING_OFF_NOTICE = 'Folding is off on this page. Turn it on in the page cog.'

/** True unless this editor's folding is off. An editor without the plugin folds. */
export const isFoldingOn = (state: EditorState): boolean => pluginKey.getState(state) ?? true

/** Turn folding on or off for this editor. */
export const setFoldingOn = (tr: Transaction, on: boolean): Transaction => tr.setMeta(pluginKey, on)

/** Whether `tr` turns folding back on: the caret guard then opens the saved folds that hide the caret. */
export const turnsFoldingOn = (tr: Transaction): boolean => tr.getMeta(pluginKey) === true

/**
 * A fold key's command asks this first: with folding off it says "blocked". It tells the host (the message) only
 * when the command runs (`dispatch` given): a dry run, as the fold-all button's read, has no side effect.
 */
export const foldingBlocked = (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
  if (isFoldingOn(state)) return false
  if (dispatch !== undefined) (pluginKey.get(state)?.spec.onBlocked as (() => void) | undefined)?.()
  return true
}

/**
 * The host's door (YAZ-4094 F1), as `showSectionIndent` is Section indent's: a metadata-only transaction that is no
 * step of the history, so ⌘Z never undoes it and the page never turns unsaved. Nothing is sent when it already is.
 */
export const showFolding = (crepe: Crepe, on: boolean): void =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    if (isFoldingOn(view.state) !== on) view.dispatch(setFoldingOn(view.state.tr, on).setMeta('addToHistory', false))
  })

export const createFoldingSwitch = (initial: () => boolean, onBlocked?: () => void) =>
  $prose(
    () =>
      new Plugin<boolean>({
        key: pluginKey,
        onBlocked,
        state: {
          init: () => initial(),
          apply: (tr, on) => {
            const meta: unknown = tr.getMeta(pluginKey)
            return typeof meta === 'boolean' ? meta : on
          },
        },
      }),
  )
