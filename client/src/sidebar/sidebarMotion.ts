/**
 * YAZ-6146 / YAZ-6161: GPU-only FLIP glide when toggling the sidebar or switching between
 * tabs with different sidebar widths. Layout snaps once to its final width (zero per-frame
 * ProseMirror/flex reflows); Web Animations API glides on the compositor for 120 ms and
 * leaves no leftover `transform` when finished.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'

const SIDEBAR_GLIDE_MS = 120
const SIDEBAR_GLIDE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'
const OPTS: KeyframeAnimationOptions = { duration: SIDEBAR_GLIDE_MS, easing: SIDEBAR_GLIDE_EASING }

const activeClose = new WeakMap<HTMLElement, Animation>()
const activeMain = new WeakMap<HTMLElement, Animation>()

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

const cancelRunning = (el: HTMLElement | null): void => {
  if (el === null || typeof el.getAnimations !== 'function') return
  for (const anim of el.getAnimations()) anim.cancel()
}

const glideMain = (main: HTMLElement, fromX: number): void => {
  cancelRunning(main)
  main.style.willChange = 'transform'
  const anim = main.animate([{ transform: `translateX(${fromX}px)` }, { transform: 'translateX(0)' }], OPTS)
  activeMain.set(main, anim)
  const clear = () => {
    if (activeMain.get(main) !== anim) return
    activeMain.delete(main)
    main.style.willChange = ''
  }
  anim.onfinish = clear
  anim.oncancel = clear
}

/** Runs a 120 ms GPU-composited FLIP glide for `.workspace` when switching between two open-sidebar tabs of different widths. */
export function animateSidebarWidthChange(main: HTMLElement | null, delta: number): void {
  if (main === null || delta === 0 || prefersReducedMotion() || typeof main.animate !== 'function') return
  glideMain(main, delta)
}

/** Runs a 120 ms GPU-composited FLIP glide for `.sidebar-shell` + `.workspace` after `collapsed` changes. */
export function animateSidebarToggle(shell: HTMLElement | null, main: HTMLElement | null, collapsed: boolean, width: number): void {
  if (shell === null || main === null || width <= 0 || prefersReducedMotion() || typeof main.animate !== 'function') return

  const sidebar = shell.querySelector<HTMLElement>(':scope > .sidebar') ?? shell
  cancelRunning(sidebar)
  shell.style.overflow = ''
  shell.style.opacity = ''
  activeClose.delete(shell)

  if (!collapsed) {
    // Opening: layout is already at final open position; glide both elements in from the left.
    if (typeof sidebar.animate === 'function') {
      sidebar.animate([{ transform: 'translateX(-100%)', opacity: 0.4 }, { transform: 'translateX(0)', opacity: 1 }], OPTS)
    }
    glideMain(main, -width)
    return
  }

  // Closing: layout is already at final closed position (shell width 0, main at x=0).
  // Temporarily reveal the shell overflow while `.sidebar` glides out behind `.workspace` so there is no blank gap.
  shell.style.overflow = 'visible'
  shell.style.opacity = '1'
  glideMain(main, width)
  if (typeof sidebar.animate === 'function') {
    const anim = sidebar.animate([{ transform: 'translateX(0)', opacity: 1 }, { transform: 'translateX(-100%)', opacity: 0.4 }], OPTS)
    activeClose.set(shell, anim)
    const clear = () => {
      if (activeClose.get(shell) !== anim) return
      activeClose.delete(shell)
      shell.style.overflow = ''
      shell.style.opacity = ''
    }
    anim.onfinish = clear
    anim.oncancel = clear
  } else {
    shell.style.overflow = ''
    shell.style.opacity = ''
  }
}

/** Triggers GPU FLIP glides on sidebar collapse/expand or per-tab width changes (skipping initial mount, Files windows, and drag-resize). */
export function useSidebarMotion(shellRef: RefObject<HTMLElement | null>, collapsed: boolean, width: number, disabled: boolean, resizing = false): void {
  const prevRef = useRef<{ collapsed: boolean; width: number; resizing: boolean } | null>(null)
  useLayoutEffect(() => {
    const prev = prevRef.current
    prevRef.current = { collapsed, width, resizing }
    if (disabled || prev === null) return
    const shell = shellRef.current
    const main = shell?.parentElement?.querySelector<HTMLElement>(':scope > .workspace') ?? null
    if (prev.collapsed !== collapsed) {
      animateSidebarToggle(shell, main, collapsed, collapsed ? prev.width : width)
    } else if (!collapsed && prev.width !== width && !resizing && !prev.resizing) {
      animateSidebarWidthChange(main, prev.width - width)
    }
  }, [shellRef, collapsed, width, disabled, resizing])
}
