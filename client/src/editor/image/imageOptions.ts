/**
 * The host's side of first-class images (YAZ-1656): ONE options object, handed to `createCrepe`
 * as `opts.image`, that every image plugin in this folder reads from.
 *
 * Two consumers, two ways in:
 *  - `imageView.ts` captures it directly — `createImageView(opts)` is registered by createCrepe
 *    the way `createDrawingPreview(opts)` is.
 *  - `clipboardPaste.ts` cannot: it is a bare `$prose((ctx) => …)` with no options, and it must
 *    stay one (its paste-mode contract is the host's, not the image feature's). So createCrepe also
 *    INJECTS the options into the editor ctx under `imageOptionsCtx`, the same `Ctx` slice
 *    mechanism Milkdown's own features use for per-editor config (`imageAttr`, `editorViewOptionsCtx`).
 *    A null slice means "this editor has no image host" — paste falls through to text handling.
 */
import { createSlice, type Ctx } from '@milkdown/kit/ctx'
import type { OpenHow } from '../embed/types'
import type { LinkMenu } from '../linkMenu'

/** One image as the lightbox shows it: the RESOLVED src and the alt's text half. */
export interface GalleryImage {
  src: string
  alt: string
}

export interface ImageOptions {
  /** Vault root (absolute); with the page's directory it is what a relative `src` resolves against. */
  root: string
  /** ABSOLUTE path of the page this editor shows; its directory is the `from` of every relative src. */
  pagePath: string
  /**
   * Double-click on a rendered image: every image on the page in document order plus the one
   * clicked (the lightbox pages through them). Absent → double-click is inert.
   */
  onOpenImage?: (gallery: { images: GalleryImage[]; index: number }) => void
  /** A paste/drop that could not be written: the passive in-window notice, never a dialog. */
  onNotice?: (message: string) => void
  /** A board src (`![name|640x360](../Other/x.drawio)`) mounts a board window (YAZ-4828). Absent → it is an image. */
  boards?: ImageBoards
}

/** How the image node finds and opens a board in any vault of the window (YAZ-4828), as the Markdown link pill does. */
export interface ImageBoards {
  /** The board's vault root and absolute path, and that vault's name when it is not the page's; null outside the window's vaults. */
  place: (src: string) => { root: string; path: string; vault: string | null } | null
  /** The pill icon's attributes (`fileIconDecoration`). */
  icon?: (path: string) => Record<string, string>
  /** A double-click or the name pill (D12): opens the board as its link does. */
  open?: (path: string, how: OpenHow) => void
  /** The board link's own menu rows (Open, the place rows), with no edit or remove. Absent → only the embed's rows. */
  linkMenu?: (path: string) => LinkMenu
  /** "Edit in a popup" for a drawing (D12, A11): the drawing modal at the board's own vault root and path. Absent → no row. */
  onEditInPopup?: (root: string, path: string) => void
}

/** Per-editor image options for plugins that have no constructor of their own (see the module doc). */
export const imageOptionsCtx = createSlice<ImageOptions | null>(null, 'mdapp-image-options')

/** The injected options, or null when this editor has none (or was built without createCrepe). */
export function imageOptionsOf(ctx: Ctx): ImageOptions | null {
  return ctx.get(imageOptionsCtx)
}
