/**
 * THE PAGE FRAME (YAZ-5164 Option A, Yaseen: "one shape everywhere … what you see is what you get, both in a tab and an
 * explorer"). The page's scroller and its stacked blocks, in one order: the header row (the title and the Properties
 * panel, YAZ-918), then the body (`children`: the text's mount, the comment stream, "Linked mentions"). The page tab's
 * editor draws it, and so does Explore's page layer, reading and editing: the same frame, the same 48 px sides, the
 * text at the same spot, so a switch between read and edit moves nothing on screen.
 */
import { createContext, type HTMLAttributes, type ReactNode, type Ref } from 'react'

/**
 * The page controls of an Explore layer's TITLE ROW (YAZ-5974): its fold-all button, the page's cog and the zoom pill,
 * on the right of the title row, before the Properties chip. The layer hands them to the editor it holds; the page's
 * header (and a card file's top line) draws them between the title and Properties. Null: none (a tab, whose controls
 * stand in its own toolbar row).
 */
export const TitleRowControls = createContext<ReactNode>(null)

export function PageFrame({ header, children, className, ref, ...rest }: HTMLAttributes<HTMLDivElement> & { header: ReactNode; ref?: Ref<HTMLDivElement> } & Record<`data-${string}`, string | undefined>) {
  return (
    <div ref={ref} className={className === undefined ? 'editor-host' : `editor-host ${className}`} data-page="page" {...rest}>
      {/* Title and properties share ONE header row (YAZ-918): the panel sits to the title's right and wraps under it
          when the title runs long. */}
      <div className="page-header">{header}</div>
      {children}
    </div>
  )
}
