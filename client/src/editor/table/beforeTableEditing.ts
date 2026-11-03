/**
 * The one way to put plugins just BEFORE `tableEditing` (YAZ-4176): ProseMirror gives a key and a mousedown to the
 * plugins in order and stops at the first that takes it, and `tableEditing` keeps its own place (a plain `$prose`
 * would land after it). `tableColumnResize.ts`, `tableShiftArrow.ts`, `tableHandleSelect.ts` and `tableFold.ts` use it.
 */
import { SchemaReady, prosePluginsCtx } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Plugin } from '@milkdown/kit/prose/state'
import { tableEditingKey } from '@milkdown/kit/prose/tables'

/** `make()`'s plugins, just before `tableEditing` once the schema is ready (at the end when there is none); taken out again on removal. */
export const beforeTableEditing =
  (make: () => Plugin[]): MilkdownPlugin =>
  (ctx) =>
  async () => {
    await ctx.wait(SchemaReady)
    const plugins = make()
    ctx.update(prosePluginsCtx, (ps) => {
      const at = ps.findIndex((p) => p.spec.key === tableEditingKey)
      return at < 0 ? [...ps, ...plugins] : [...ps.slice(0, at), ...plugins, ...ps.slice(at)]
    })
    return () => {
      ctx.update(prosePluginsCtx, (ps) => ps.filter((p) => !plugins.includes(p)))
    }
  }
