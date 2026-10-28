/**
 * MONACO'S RIGHT-CLICK MENU WITH THE APP'S SPACING (YAZ-3478; YAZ-3439 "The same judgment for features and
 * looks"). Monaco keeps its items and its logic; only the look changes, to the app's `.ctx-menu`.
 *
 * Monaco draws the menu in an OPEN shadow root, on a host (`.shadow-root-host`) it adds to the editor's
 * mount the first time a menu shows. `codeEditor.css` gives that host the colors, corners, border, shadow
 * and font (custom properties inherit into the shadow tree). The spacing is in Monaco's own rules inside
 * the shadow root, where no app rule reaches. So this adds ONE `<style>` to the shadow root, once per host.
 *
 * A `MutationObserver` on the mount's own children (not its subtree) sees the host arrive. Its callback is
 * a microtask, so it runs before the menu's first paint. The rules use one more class than Monaco's, so
 * they win in any order (Monaco adds its menu's style sheet after this one).
 */

/**
 * The app's `.ctx-menu` spacing (`app.css`): 4 px around, hints at 11 px, and each row is the app's own
 * row: `--menu-row-padding` (it inherits into the shadow root) around one line of 13 px text at
 * `line-height: normal`. So the height follows the font, as the app's row does, and the two cannot drift
 * (YAZ-3503: a fixed 27 px was 1 px short of the app's 28 px row on a Mac).
 */
export const MENU_LOOK_CSS = `
.context-view .monaco-menu.monaco-menu {
  min-width: 140px;
  font-size: 13px;
}
.context-view .monaco-menu.monaco-menu .monaco-action-bar.vertical {
  padding: 4px 0;
}
.context-view .monaco-menu.monaco-menu .monaco-action-bar.vertical .action-menu-item {
  height: auto;
  margin: 0 4px;
  border-radius: 5px;
}
.context-view .monaco-menu.monaco-menu .monaco-action-bar.vertical .action-label:not(.separator) {
  max-height: none;
  padding: var(--menu-row-padding, 6px 10px);
  font-size: 13px;
  line-height: normal;
}
.context-view .monaco-menu.monaco-menu .monaco-action-bar.vertical .keybinding {
  padding: 0 10px 0 16px;
  font-size: 11px;
  opacity: 0.5;
}
.context-view .monaco-menu.monaco-menu .monaco-action-bar.vertical .action-label.separator {
  margin: 4px 0;
  padding: 0;
  border-bottom: 1px solid var(--border);
}
`

/** The marker on the one style this adds, so a host gets it once. */
const MARK = 'data-app-menu-look'

/** Adds the spacing to each Monaco menu host in `mount`, now and when one arrives. */
export function attachMenuLook(mount: HTMLElement): { dispose: () => void } {
  const dress = (): void => {
    for (const host of mount.children) {
      const root = host.classList.contains('shadow-root-host') ? host.shadowRoot : null
      if (root === null || root.querySelector(`style[${MARK}]`) !== null) continue
      const style = document.createElement('style')
      style.setAttribute(MARK, '')
      style.textContent = MENU_LOOK_CSS
      root.appendChild(style)
    }
  }
  const observer = new MutationObserver(dress)
  observer.observe(mount, { childList: true })
  dress()
  return { dispose: () => observer.disconnect() }
}
