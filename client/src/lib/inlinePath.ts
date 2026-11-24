/**
 * Async client path resolver for inline cards and inline drawings (YAZ-6467).
 * Reads the parent Markdown page from disk and computes `<pagePath>:<1-based line>`,
 * falling back to `ref.page` when the file is unreadable or the block is no longer found.
 */
import { inlineRefPathAtLine, type InlineRef } from '@shared/inlineRef'
import { api } from '../api'

export async function resolveInlineCopyPath(ref: InlineRef, fallbackIndex?: number): Promise<string> {
  try {
    const { content } = await api.readFile(ref.page)
    return inlineRefPathAtLine(ref, content, fallbackIndex)
  } catch {
    return ref.page
  }
}

/** Copies `text` (resolving `<page>:<line>` when `inlineDrawingIndex` is defined) and reports outcome via `notify`. */
export async function copyPathWithInlineSupport(
  text: string,
  inlineDrawingIndex: number | undefined,
  notify: (message: string, kind?: 'error' | 'info', type?: 'clipboard') => void,
): Promise<void> {
  const resolved = inlineDrawingIndex !== undefined ? await resolveInlineCopyPath({ kind: 'drawing', page: text, index: inlineDrawingIndex }) : text
  const copied = resolved.split('\n').length
  try {
    await navigator.clipboard.writeText(resolved)
    notify(copied === 1 ? 'Copied path' : `Copied ${copied} paths`, 'info', 'clipboard')
  } catch (error: unknown) {
    notify(`Can't copy path: ${error instanceof Error ? error.message : String(error)}`)
  }
}
