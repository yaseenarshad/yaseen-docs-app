/**
 * Locked Crepe construction for this app (GRO-1961).
 *
 * Decisions baked in here (see docs/CONTRACTS.md "Editor rules"):
 *  - ImageBlock feature OFF: its serializer overwrites image alt text with the
 *    ratio ("![1.00](src)"). Plain commonmark image keeps alt/title intact.
 *  - list_item schema widened from `paragraph block*` to `block+` so that
 *    Logseq/Obsidian-style outlines (`* # Heading` / `* - nested`) do not get
 *    an empty `<br />` paragraph injected on round-trip.
 *  - Markdown out goes through `postProcessMarkdown()` which un-escapes
 *    `\[\[wikilink]]` / `!\[\[embed]]` that remark-stringify escapes.
 */
import { Crepe, type CrepeConfig } from '@milkdown/crepe'
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm'
import { replaceAll } from '@milkdown/kit/utils'

export interface CreateCrepeOptions {
  root: HTMLElement
  defaultValue?: string
  /** Called (debounced by the caller) whenever the document changes. */
  onMarkdownUpdated?: (markdown: string) => void
  /** Widen list_item to `block+` (default true). */
  outlineFriendlyListItems?: boolean
  features?: CrepeConfig['features']
}

export function createCrepe(opts: CreateCrepeOptions): Crepe {
  const crepe = new Crepe({
    root: opts.root,
    defaultValue: opts.defaultValue ?? '',
    features: {
      [Crepe.Feature.ImageBlock]: false,
      ...opts.features,
    },
  })
  if (opts.outlineFriendlyListItems ?? true) {
    crepe.editor.use(
      // NB: extend the GFM task-item schema, not the commonmark base — extendSchema()
      // always derives from the ORIGINAL schema, so extending listItemSchema directly
      // would silently drop task-list checkbox support.
      extendListItemSchemaForTask.extendSchema((prev) => (ctx) => ({ ...prev(ctx), content: 'block+' })),
    )
  }
  if (opts.onMarkdownUpdated) {
    const cb = opts.onMarkdownUpdated
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown, prev) => {
        if (markdown !== prev) cb(postProcessMarkdown(markdown))
      })
    })
  }
  return crepe
}

/** Markdown as it should be written to disk (frontmatter is added by the caller). */
export function getMarkdownForSave(crepe: Crepe): string {
  return postProcessMarkdown(crepe.getMarkdown())
}

/** Replace the whole document in an existing instance (e.g. external file change). */
export function setMarkdown(crepe: Crepe, markdown: string): void {
  crepe.editor.action(replaceAll(markdown, true))
}

export function postProcessMarkdown(md: string): string {
  return md.replace(/(!?)\\\[\\\[/g, '$1[[')
}
