/**
 * ONE hotkey label on screen (YAZ-5332, `shared/keyLabel.ts`): "Done (Esc / Cmd+Enter)" — the action, then its keys in
 * brackets, quieter (`.key-label`, `app.css`). `KeyLabel` for React, `keyLabelDom` for a node view; a tooltip or an
 * aria-label takes the plain text, `withKeys`. One inline box, so a flex row's gap never splits the action from its keys.
 */
import type { ReactNode } from 'react'
import { keysText } from '@shared/keyLabel'

/**
 * `action`: its words, or a node that holds them (an answer button's own label span). `keys`: a label's keys
 * (`keysText`); or `words`, keys already in words (a user's key, `keyInWords`).
 */
export function KeyLabel({ action, ...k }: { action: ReactNode } & ({ keys: string } | { words: string })) {
  return (
    <span>
      {action} <span className="key-label">({'words' in k ? k.words : keysText(k.keys)})</span>
    </span>
  )
}

/** The same label in the DOM (no React): the action, then its keys in a quiet span, in one inline box. */
export function keyLabelDom(action: string, keys: string): HTMLElement {
  const box = document.createElement('span')
  const quiet = document.createElement('span')
  quiet.className = 'key-label'
  quiet.textContent = `(${keysText(keys)})`
  box.append(`${action} `, quiet)
  return box
}
