/**
 * Settings › Files & Links › This vault › "Call a page a …" (YAZ-4938): Page (the default) · Doc · Note · Your own
 * word. The own word has two boxes, one and many, saved when a box loses the focus or takes Enter, never on a
 * keystroke: the vault's word is read once per change, and every label follows it. YAZ-5036: "Card" is no choice: a
 * card is its own thing, so a vault never shows two "New card" rows.
 *
 * rename-note-to-page: skip-file (the choice "Note" stays).
 */
import { useEffect, useState } from 'react'
import { OWN_WORD_MAX, cleanOwnWord, type UnitChoice, type UnitWordState } from '../vault/unitWord'
import { Segmented } from './controls'

const CHOICES: readonly { label: string; value: UnitChoice }[] = [
  { label: 'Page', value: 'page' },
  { label: 'Doc', value: 'doc' },
  { label: 'Note', value: 'note' },
  { label: 'Your own word', value: 'own' },
]

/**
 * True when the vault's own word is "card" in a vault that has cards (YAZ-4946 D16): its pages and its cards would
 * both be "cards". Cards keep their name; the row says so.
 */
export const clashesWithCards = (settings: UnitWordState['settings'], hasCards: boolean): boolean => hasCards && settings.unit === 'own' && /^cards?$/i.test(settings.own.one.trim())

export function UnitWordControl({ unitWord, hasCards = false }: { unitWord: UnitWordState; hasCards?: boolean }) {
  const { settings, save } = unitWord
  const [one, setOne] = useState(settings.own.one)
  const [many, setMany] = useState(settings.own.many)
  // Another Mac's sync, or a vault change, moves the boxes to what the file says.
  useEffect(() => {
    setOne(settings.own.one)
    setMany(settings.own.many)
  }, [settings.own.one, settings.own.many])
  const commit = (): void => {
    const next = { unit: 'own' as const, own: { one: cleanOwnWord(one), many: cleanOwnWord(many) } }
    if (next.own.one !== settings.own.one || next.own.many !== settings.own.many) save(next)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
  }
  const bad = (typed: string): boolean => typed.trim() !== '' && cleanOwnWord(typed) === ''
  return (
    <>
      <Segmented options={CHOICES} value={settings.unit} onChange={(unit) => save({ unit, own: settings.own })} ariaLabel="Call a page a" />
      {clashesWithCards(settings, hasCards) && (
        <p className="settings__error" role="status">
          Pages and cards would both be called cards.
        </p>
      )}
      {settings.unit === 'own' && (
        <>
          <input type="text" className={`settings__input${bad(one) ? ' settings__input--error' : ''}`} aria-label="Your own word, one" aria-invalid={bad(one)} placeholder="One, like Entry" maxLength={OWN_WORD_MAX} spellCheck={false} value={one} onChange={(e) => setOne(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
          <input type="text" className={`settings__input${bad(many) ? ' settings__input--error' : ''}`} aria-label="Your own word, many" aria-invalid={bad(many)} placeholder="Many, like Entries" maxLength={OWN_WORD_MAX} spellCheck={false} value={many} onChange={(e) => setMany(e.target.value)} onBlur={commit} onKeyDown={onKeyDown} />
        </>
      )}
    </>
  )
}
