/**
 * The Cards table's folder host (YAZ-5349 follow-up): what a table's column menus, header menu and "+ New" reach while
 * a view lists cards (YAZ-5319). It is the page's `FolderHost` with the column doors swapped for the cards' own, so
 * every menu works as it does for pages and none of it knows which kind it shows (`cardView.ts` is the other half):
 *
 *  - The columns' types are the view's cards' table's (`cardColumnsOf`): "+ Add column", "Add column to the right…"
 *    and Edit column's type write there, in the views' one write (`update`), with its Undo and ⌘Z step. Never the
 *    folder's `columns`, never a page's front matter.
 *  - Every card property is a card column of this folder page: no "From <parent>", no "Other properties", no
 *    "Separate value", no relation.
 *  - A value goes to the card's line (`changeCardLine`), as a cell edit's does: an option renamed in Edit column renames
 *    it on every card that holds it; "Delete column and clear N values" takes the property off each card's line, and
 *    its Undo puts them back.
 *  - "+ New" makes a card file in the folder (`createCardFile`), its card line seeded as a page's front matter is: a
 *    card is what a row of this table is.
 */
import { withCardProperty, withoutCardProperty, type CardLine } from '@shared/cardLine'
import { NEW_CARD_TITLE } from '@shared/cardFileFormat'
import type { IndexRecord } from '@shared/types'
import { cardLineChange, cardRowOfRecord, type CardRow } from './cardRows'
import { CARD_COLUMNS, cardColumnsOf } from './cardView'
import { pruneColumnFromViews, pruneColumnLabel } from './deleteColumn'
import { propertyLabel } from './engine'
import type { ColumnDecl } from './folderSettings'
import { renamedValue, renameOptionInFilters } from './renameOption'
import type { FolderHost } from './ViewsPane'
import type { Mutate, ViewDef, ViewSet } from './viewSchema'

/** What the Cards table's host is made of. */
export interface CardHostParts {
  /** The view's index; the def the menus see is through the card lens. */
  viewIndex: number
  /** The view's card columns' types, as the lens shows them (`cardColumnsOf`). */
  columns: Readonly<Record<string, ColumnDecl>>
  /** The card rows (`cardRowRecords`). */
  records: readonly IndexRecord[]
  /** The folder page's folder, root-relative: the owner of every card column. */
  here: string
  /** The folder page's folder, absolute: where "+ New" makes a card file. */
  dir: string
  /** The pages that are read only: a card in one is never written. */
  readOnly: ReadonlySet<string>
  /** The views' one write, through the card lens (`ViewsPane`'s `update`). */
  update: Mutate
  /** The live def, through the card lens: a label in a toast. */
  def: () => ViewSet
  /** One card line change, in one write of its page (`changeCardLine`). */
  changeLine: (path: string, id: string, change: (line: CardLine) => CardLine, index?: number) => Promise<unknown>
  /** A new card file (`createCardFile`). */
  createCard: (dir: string, title: string, line: (line: CardLine) => CardLine) => Promise<string>
}

/** What the column menus call the Cards table, where they name the folder ("Added Level to Cards", "Delete Level from Cards"). */
export const CARD_TABLE_NAME = 'Cards'

const bareOf = (key: string): string => key.replace(/^note\./, '')

/** The view at `viewIndex`, its card columns set to `columns` (none: the key goes). */
function withCardColumns(view: ViewDef, columns: Readonly<Record<string, ColumnDecl>>): ViewDef {
  const next: ViewDef = { ...view }
  if (Object.keys(columns).length === 0) delete next[CARD_COLUMNS]
  else next[CARD_COLUMNS] = { ...columns }
  return next
}

/** The cards' properties as columns this folder page owns: each declared one, and each a card holds. */
function ownedColumns(columns: Readonly<Record<string, ColumnDecl>>, records: readonly IndexRecord[], here: string): FolderHost['columns'] {
  const out: Record<string, { decl: ColumnDecl; owner: string }> = {}
  for (const r of records) for (const name of Object.keys(cardRowOfRecord(r)?.card.properties ?? {})) out[name] = { decl: { kind: 'text' }, owner: here }
  for (const [name, decl] of Object.entries(columns)) out[name] = { decl, owner: here }
  return out
}

/** Runs each card's change in turn (two cards of one page are two writes of it, one after the other); the failures' count. */
async function eachCard(cards: readonly CardRow[], change: (row: CardRow) => (line: CardLine) => CardLine, changeLine: CardHostParts['changeLine']): Promise<number> {
  let failed = 0
  for (const row of cards) {
    try {
      await changeLine(row.page, row.id, change(row), row.index)
    } catch {
      failed += 1
    }
  }
  return failed
}

/** The Cards table's host: `pages` with its column doors and "+ New" made the cards'. */
export function cardFolderHost(pages: FolderHost, parts: CardHostParts): FolderHost {
  const { viewIndex, columns, records, here, dir, readOnly, update, def, changeLine, createCard } = parts
  /** The card rows that may be written: each row of a page that is not read only. */
  const writable = (): CardRow[] => records.flatMap((r) => {
    const row = cardRowOfRecord(r)
    return row === undefined || readOnly.has(row.page) ? [] : [row]
  })
  const holding = (name: string): CardRow[] => writable().filter((row) => Object.hasOwn(row.card.properties ?? {}, name))
  const report = (failed: number, what: string) => {
    if (failed > 0) pages.onNotice?.(`${failed} ${failed === 1 ? 'card' : 'cards'} kept the old ${what}: try again`)
  }
  /** `next` as the card columns' types and `views` (through the lens) in ONE views write; `undo`, its toast. */
  const writeColumns = (next: Readonly<Record<string, ColumnDecl>>, views?: ViewDef[], labels?: { properties: ViewSet['properties'] }, undo?: string) =>
    update((d) => {
      if (views !== undefined) d.views = structuredClone(views)
      d.views[viewIndex] = withCardColumns(d.views[viewIndex], next)
      if (labels !== undefined) {
        if (labels.properties === undefined) delete d.properties
        else d.properties = labels.properties
      }
    }, undo)

  return {
    ...pages,
    settings: { ...pages.settings, columns: { ...columns }, fromBelow: undefined },
    columns: ownedColumns(columns, records, here),
    sources: { ...pages.sources, folderName: CARD_TABLE_NAME, of: () => ({}), columnOn: () => null },
    separate: undefined,
    relation: undefined,
    setColumn: async (key, next, _base, rename) => {
      update((d) => {
        d.views[viewIndex] = withCardColumns(d.views[viewIndex], { ...cardColumnsOf(d.views[viewIndex]), [key]: next })
        // The views' filters on the old option follow it (YAZ-4637 M5), as a page column's do.
        if (rename !== undefined) d.views = renameOptionInFilters(d.views, key, rename.from, rename.to) as ViewDef[]
      })
      if (rename === undefined) return
      // The option renamed on every card that holds it, on its card line.
      const cards = holding(key).filter((row) => renamedValue(row.card.properties?.[key], rename.from, rename.to) !== undefined)
      report(await eachCard(cards, (row) => (l) => withCardProperty(l, key, renamedValue(row.card.properties?.[key], rename.from, rename.to)), changeLine), 'option')
    },
    setColumns: (next, views, labels) => writeColumns(next, views, labels),
    addColumn: (key, decl, views, _viewIndex, toast) => writeColumns({ ...columns, [key]: decl }, views, undefined, toast),
    deleteColumn: async (key, clear = true) => {
      const name = bareOf(key)
      const label = propertyLabel(def(), key)
      const cleared = clear ? holding(name).map((row) => ({ row, value: row.card.properties?.[name] })) : []
      const restore = () => void eachCard(cleared.map((c) => c.row), (row) => (l) => withCardProperty(l, name, cleared.find((c) => c.row === row)!.value), changeLine).then((failed) => report(failed, 'value'))
      update(
        (d) => {
          const view = d.views[viewIndex]
          const { [name]: _gone, ...rest } = cardColumnsOf(view)
          d.views[viewIndex] = withCardColumns(pruneColumnFromViews([view], key)[0], rest)
          const labels = pruneColumnLabel(d.properties, key)
          if (labels === undefined) delete d.properties
          else d.properties = labels
        },
        `Deleted ${label}`,
        cleared.length === 0 ? undefined : restore,
      )
      report(await eachCard(cleared.map((c) => c.row), () => (l) => withoutCardProperty(l, name), changeLine), 'value')
    },
    valueCount: (key) => holding(bareOf(key)).length,
    create: (seed, name) => {
      const writes = Object.entries(seed.properties).map(([key, value]) => ({ key, value }))
      return createCard(dir, name ?? NEW_CARD_TITLE, writes.length === 0 ? (l) => l : cardLineChange(writes))
    },
  }
}
