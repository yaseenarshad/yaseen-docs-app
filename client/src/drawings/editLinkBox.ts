import { fitMenu } from '../lib/fitMenu'

/**
 * Right-click › Edit link on a drawing's pill (YAZ-4039 D15): a small box at the pointer with the link's text, the part
 * between `[[` and `]]`. Enter writes it back as `[[text]]`; Esc, a click outside or leaving the box changes nothing.
 * The popup look is the link menu's (`.ctx-menu--editor`), so it sits where the menu did. Returns its close.
 */
export function openEditLinkBox(parent: HTMLElement, x: number, y: number, inner: string, done: (inner: string) => void): () => void {
  const box = document.createElement('div')
  box.className = 'ctx-menu ctx-menu--editor drawing-link-edit'
  box.style.left = `${x}px`
  box.style.top = `${y}px`
  const input = document.createElement('input')
  input.type = 'text'
  input.value = inner
  input.spellcheck = false
  input.setAttribute('aria-label', 'Link')
  box.appendChild(input)
  const close = () => {
    document.removeEventListener('mousedown', onMouseDown, true)
    input.removeEventListener('blur', close)
    box.remove()
  }
  const onMouseDown = (event: MouseEvent) => {
    if (!(event.target instanceof Node && box.contains(event.target))) close()
  }
  input.addEventListener('keydown', (event) => {
    // The board's keys stay out of the box.
    event.stopPropagation()
    if (event.key === 'Escape') close()
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    // Brackets typed around the text are the link's own.
    const next = input.value.trim().replace(/^\[\[|\]\]$/g, '').trim()
    close()
    if (next !== '' && next !== inner) done(next)
  })
  input.addEventListener('blur', close)
  document.addEventListener('mousedown', onMouseDown, true)
  parent.appendChild(box)
  input.focus()
  input.select()
  return close
}

/**
 * Right-click › Add alias / Edit alias on a link pill (YAZ-6353): a small floating box at the pointer positioned with
 * `fitMenu`. Enter calls `done(input.value)` even when empty (empty removes the alias); Esc, outside mousedown, or blur
 * cancels with no change. Returns its close.
 */
export function openAliasBox(
  parent: HTMLElement,
  x: number,
  y: number,
  currentAlias: string,
  done: (alias: string) => void,
  placeholder = 'Display text (empty removes alias)',
): () => void {
  const box = document.createElement('div')
  box.className = 'ctx-menu ctx-menu--editor drawing-link-edit'
  const input = document.createElement('input')
  input.type = 'text'
  input.value = currentAlias
  input.placeholder = placeholder
  input.spellcheck = false
  input.setAttribute('aria-label', 'Alias')
  box.appendChild(input)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    document.removeEventListener('mousedown', onMouseDown, true)
    input.removeEventListener('blur', close)
    box.remove()
  }
  const onMouseDown = (event: MouseEvent) => {
    if (!(event.target instanceof Node && box.contains(event.target))) close()
  }
  input.addEventListener('keydown', (event) => {
    // Keep editor/board hotkeys out of the alias box.
    event.stopPropagation()
    if (event.key === 'Escape' && !event.isComposing) {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    const next = input.value
    close()
    done(next)
  })
  input.addEventListener('blur', close)
  document.addEventListener('mousedown', onMouseDown, true)
  parent.appendChild(box)
  const { left, top } = fitMenu(box, x, y)
  box.style.left = `${left}px`
  box.style.top = `${top}px`
  input.focus()
  input.select()
  return close
}
