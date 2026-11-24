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
