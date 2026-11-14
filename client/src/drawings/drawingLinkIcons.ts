/**
 * A drawing pill's file icon (YAZ-4039 demo round 1): the same icon as a page's pill and the sidebar's `FileIcon`
 * (`fileIconDecoration`: the Line set, Material's icons, a pick or a rule, the icon style). The CSS draws that icon on a
 * span's `::before`, which a canvas cannot use, so the icon is read off that same CSS once: a hidden probe span in the
 * app's element, its `::before`'s image or mask and colour, drawn into a small canvas. The canvas is the image the
 * engine draws; its data URL goes into an SVG export and the editor overlay.
 *
 * One image for each icon (its attributes, the theme and the app's icon settings), at most `MAX_ICONS`, the oldest
 * dropped first. An icon that is not ready yet answers undefined (the engine draws its outline), and `onReady` is
 * called once when it is, so the boards draw again. Icons Off answers null: no icon, as in a page.
 */
import { fileIconDecoration, type IconsHere } from '../sidebar/FileIcon'

export interface PillIcon {
  image: HTMLCanvasElement
  url: string
}

const MAX_ICONS = 64
/** Drawn at twice the pill's icon size, so it stays sharp on a Retina screen and a zoomed board. */
const SIZE = 32

const icons = new Map<string, PillIcon | null | 'loading' | 'failed'>()

let here: IconsHere | null = null

/** The window's icons (`IconsContext`): the vaults' picks and the rules. True when they changed. */
export function setDrawingLinkIcons(next: IconsHere | null): boolean {
  if (next === here) return false
  here = next
  return true
}

const urlOf = (css: string): string | null => /url\((['"]?)(.*)\1\)/.exec(css)?.[2] ?? null

async function load(src: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = src
  await image.decode()
  return image
}

/** The icon as the CSS draws it now: an image, or a mask in a colour; null when there is none. */
function readIcon(attrs: Record<string, string>, app: Element): { image: string; color?: string } | null {
  const probe = document.createElement('span')
  for (const [name, value] of Object.entries(attrs)) probe.setAttribute(name, value)
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  app.appendChild(probe)
  try {
    const before = getComputedStyle(probe, '::before')
    if (before.content === 'none' || before.display === 'none') return null
    const mask = urlOf(before.getPropertyValue('mask-image') || before.getPropertyValue('-webkit-mask-image'))
    if (mask !== null) return { image: mask, color: before.backgroundColor }
    const image = urlOf(before.backgroundImage)
    return image === null ? null : { image }
  } finally {
    probe.remove()
  }
}

async function draw(icon: { image: string; color?: string }): Promise<PillIcon> {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const context = canvas.getContext('2d')!
  context.drawImage(await load(icon.image), 0, 0, SIZE, SIZE)
  if (icon.color !== undefined) {
    // a mask: the glyph's shape in the colour
    context.globalCompositeOperation = 'source-in'
    context.fillStyle = icon.color
    context.fillRect(0, 0, SIZE, SIZE)
  }
  return { image: canvas, url: canvas.toDataURL() }
}

/** The pill icon of `path`: ready, undefined while it is drawn (then `onReady` once), or null for no icon. */
export function drawingLinkIcon(path: string, folder: boolean, onReady: () => void): PillIcon | null | undefined {
  const app = document.querySelector('.app')
  if (app === null) return undefined
  const attrs = fileIconDecoration(here, path, folder)
  const theme = document.documentElement.dataset.theme ?? ''
  const { sidebarIconSet = '', sidebarFileIcons = '', sidebarFolderIcons = '' } = (app as HTMLElement).dataset
  const key = JSON.stringify([attrs['data-kind'], attrs['data-icon'], attrs['data-icon-custom'], attrs.style, folder, theme, sidebarIconSet, sidebarFileIcons, sidebarFolderIcons])
  const held = icons.get(key)
  if (held !== undefined) return held === 'loading' || held === 'failed' ? undefined : held
  const icon = readIcon(attrs, app)
  // Every look counts toward the limit, "no icon" too (YAZ-4074 6A item 20).
  if (icons.size >= MAX_ICONS) icons.delete(icons.keys().next().value!)
  if (icon === null) {
    icons.set(key, null)
    return null
  }
  icons.set(key, 'loading')
  // A look dropped while it loaded (the 64 limit) stays dropped: the limit holds.
  void draw(icon).then(
    (drawn) => {
      if (icons.get(key) !== 'loading') return
      icons.set(key, drawn)
      onReady()
    },
    // An icon that does not load keeps the outline.
    () => icons.get(key) === 'loading' && icons.set(key, 'failed'),
  )
  return undefined
}
