/**
 * Text on save keeps its escapes when it ends in whitespace (YAZ-3727 B5).
 *
 * Milkdown's `text` stringify handler (`@milkdown/core` `remark-handlers.ts`) writes text RAW when it ends in whitespace
 * and has no `*`, `_` or `\`, so a trailing space never saves as `&#x20;`. That skip also drops every escape: a plain
 * line whose whole text is `1. `, `# `, `> `, `- `, `+ `, `1) ` or `--- ` saved bare and reloaded as a numbered line,
 * a heading, a quote, a bullet or a line. Ours escapes the text before the trailing whitespace, as remark would, and
 * writes the whitespace itself raw, as Milkdown does. Text with no escapable character keeps Milkdown's bytes exactly
 * (`hello  `, `  `, `end\t`); text that does not end in whitespace, or has `*`, `_` or `\`, takes Milkdown's path.
 * Milkdown's `strong` / `emphasis` handlers stay.
 */
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { Handle } from 'mdast-util-to-markdown'

/** Milkdown's raw case: whitespace at the end, no `*`, `_` or `\` (its regex, split into text and trailing whitespace). */
const RAW_TAIL = /^([^*_\\]*?)(\s+)$/

const text: Handle = (node: { value: string }, _parent, state, info) => {
  const raw = RAW_TAIL.exec(node.value)
  if (raw === null) return state.safe(node.value, { ...info, encode: [] })
  const [, body, tail] = raw
  return state.safe(body, { ...info, after: tail[0], encode: [] }) + tail
}

/** Replaces Milkdown's `text` handler; call in a `crepe.editor.config` (read once, when Milkdown builds remark). */
export function textStringify(ctx: Ctx): void {
  ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, handlers: { ...prev.handlers, text } }))
}
