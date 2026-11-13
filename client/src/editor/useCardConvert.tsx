/**
 * A PAGE'S CONVERT ACTIONS (YAZ-5037 phase 5), for the page's host (`Editor`): the door its cards and card embeds call
 * (`CardConvertDoor`: "Move to its own file", "Put back into this page"), the cog's "Turn into a card file", and the
 * one ask they need ("2 other pages embed this card. They will show it from this page."). Small and eager; the writes
 * (`review/cardConvert.ts`) load when an action runs.
 *
 * Only in a vault with IDs (D8). The actions that MAKE a card file (Move, Turn into a card file) show only while the
 * vault's Review is on, as New card does. Each is a file action: the vault's Read only asks first (`allowFileAction`).
 * A failure says why in one notice, and nothing changed.
 */
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { cardFileShape } from '@shared/cardFileFormat'
import { cardIdOf } from '@shared/cardLine'
import { cardEmbedders } from '@shared/cardLinks'
import { splitFrontmatter } from '@shared/frontmatter'
import { ConfirmSheet } from '../components/ConfirmSheet'
import type { CardConvertDoor } from './noteCard/noteCardView'
import type { PageSwitch } from './PageSettings'
import { linkCard, type WikilinkResolveSource } from './wikilink/wikilinkPlugin'

type Actions = typeof import('../review/cardConvert')

/**
 * Runs one convert action of the vault `root`: the vault's Read only asks first; a failure is one notice
 * ("Can't move the card: the file changed on disk. Nothing changed; try again."). Resolves true when it ran to the end.
 */
export async function runConvert(root: string, allow: (root: string) => Promise<boolean>, onNotice: (message: string) => void, failure: string, action: (actions: Actions) => Promise<unknown>): Promise<boolean> {
  if (!(await allow(root))) return false
  const actions = await import('../review/cardConvert')
  try {
    await action(actions)
    return true
  } catch (err) {
    onNotice(`Can't ${failure}: ${actions.convertFailure(err)}`)
    return false
  }
}

/** Can the page `content` turn into a card file? One card with its ID and no other text (`canBeCardFile`, read here without its module). */
function oneCardOnly(content: string): boolean {
  const shape = cardFileShape(splitFrontmatter(content).body)
  return shape.problem === 'ok' && cardIdOf(shape.cards[0].line) !== null
}

export interface CardConvertHost {
  root: string
  path: string
  /** The vault's index and links. Absent (no vault index): no action shows. */
  wikilinks?: WikilinkResolveSource
  /** The vault's Review is on: the actions that make a card file show. */
  reviewOn: boolean
  /** The page is a folder page's Page tab: it never turns into a card file. */
  inFolderPage: boolean
  /** The page's bytes on disk now (the cog's row reads them when the menu opens). */
  disk: () => string
  allowFileAction: (root: string) => Promise<boolean>
  onNotice?: (message: string) => void
  /** The page became a card file under the same name: the tab reads it again, to show it as one. */
  onReread?: () => void
}

/** The page's convert door (made once: it reads the host at each call), its cog rows, and its ask while one is open. */
export function useCardConvert(host: CardConvertHost): { door: CardConvertDoor; rows: () => readonly PageSwitch[]; sheet: ReactNode } {
  const ref = useRef(host)
  ref.current = host
  const [ask, setAsk] = useState<{ text: string; go: () => void } | null>(null)
  const labelId = useId()

  const run = useCallback((failure: string, action: (actions: Actions) => Promise<unknown>): Promise<boolean> => {
    const h = ref.current
    return runConvert(h.root, h.allowFileAction, h.onNotice ?? (() => {}), failure, action)
  }, [])

  const door = useMemo(
    (): CardConvertDoor => ({
      canMove: () => ref.current.reviewOn && ref.current.wikilinks?.ids === true,
      move: (id, index) => void run('move the card', (a) => a.moveCardToFile(ref.current.path, id, index)),
      putBack: (card, inner, nth) => {
        const { path, wikilinks } = ref.current
        const go = () => void run('put the card back', (a) => a.putCardBackIntoPage(path, card.path, card.id, inner, nth))
        // The other pages that embed it show it from this page after.
        const others = wikilinks === undefined ? 0 : cardEmbedders(wikilinks.records, card.id, (target) => linkCard(target, wikilinks)).filter((r) => r.path !== path && r.path !== card.path).length
        if (others === 0) return go()
        setAsk({ text: others === 1 ? '1 other page embeds this card. It will show it from this page.' : `${others} other pages embed this card. They will show it from this page.`, go })
      },
    }),
    [run],
  )

  const rows = useCallback((): readonly PageSwitch[] => {
    const h = ref.current
    if (h.inFolderPage || !h.reviewOn || h.wikilinks?.ids !== true || !oneCardOnly(h.disk())) return []
    return [
      {
        label: 'Turn into a card file',
        divider: true,
        onToggle: () =>
          void run('turn the page into a card file', (a) => a.turnIntoCardFile(ref.current.path)).then((done) => {
            // A new name remaps the tab, which reads it; the same name is read again here.
            if (done) ref.current.onReread?.()
          }),
      },
    ]
  }, [run])

  const sheet =
    ask === null ? null : (
      <ConfirmSheet
        labelId={labelId}
        text={ask.text}
        confirmLabel="Put back"
        focusConfirm
        onConfirm={() => {
          setAsk(null)
          ask.go()
        }}
        onCancel={() => setAsk(null)}
      />
    )
  return { door, rows, sheet }
}
