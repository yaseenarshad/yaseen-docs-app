/**
 * `shared/cardCheck.ts` (YAZ-5116, decision 9; suggestions 15, 16): the sure mistakes of a card's text. A false alarm
 * on a sensible card is a bug of the rule, not of the card.
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CARD_FAULT_TEXT, checkCard, type CardFault } from '@shared/cardCheck'
import { findCards } from '@shared/cardLine'
import { lineKinds } from '@shared/fences'

const fault = (kind: CardFault['kind'], side = 0): CardFault => ({ kind, side, text: CARD_FAULT_TEXT[kind] })

describe('checkCard: one case for each kind', () => {
  it('the texts are the ones of YAZ-5115', () => {
    expect(CARD_FAULT_TEXT).toEqual({
      unclosed: 'A {{ has no closing }}, so nothing is hidden.',
      'empty-hidden': 'A hidden word is empty.',
      'nothing-to-recall': 'Nothing is hidden, and the card has no back.',
      'no-title': 'The card has no title.',
      'title-placeholder': 'The title is still "Title".',
      'hidden-subject': 'The question hides its own subject.',
    })
  })

  it('unclosed: a {{ with no }} after it on that side', () => {
    expect(checkCard('Capital of France\nThe capital is Paris\n---\nIt is {{Paris')).toEqual([fault('unclosed', 1)])
    // `{{a … {{b}}` is one hidden word (the parser's own reading), so nothing is left open.
    expect(checkCard('Pair\nOne {{a and {{b}} here\n---\nback')).toEqual([])
    // A `}}` on the next side does not close it: each side is its own.
    expect(checkCard('Title line\nOpen {{here\n---\nclosed}} there {{x}}')).toEqual([fault('unclosed', 0)])
  })

  it('empty-hidden: {{}} with nothing in it', () => {
    expect(checkCard('Capital\nThe capital is {{}}\n---\nParis')).toEqual([fault('empty-hidden', 0)])
    expect(checkCard('Capital\nThe capital is {{Paris}}\n---\nNot {{ }} and not {{1::}}')).toEqual([fault('empty-hidden', 1)])
  })

  it('nothing-to-recall: one side and no hidden word', () => {
    expect(checkCard('Capital of France\nThe capital of France is Paris.')).toEqual([fault('nothing-to-recall')])
    expect(checkCard('Capital of France\nWhat is it?\n---\nParis')).toEqual([])
    expect(checkCard('Capital of France\nThe capital of France is {{Paris}}.')).toEqual([])
  })

  it('no-title: the front has no line with text', () => {
    expect(checkCard('\n\n---\nThe capital is {{Paris}}')).toEqual([fault('no-title')])
    expect(checkCard('')).toEqual([fault('nothing-to-recall'), fault('no-title')])
  })

  it('title-placeholder: the first line is still "Title"', () => {
    expect(checkCard('Title\nThe capital is {{Paris}}')).toEqual([fault('title-placeholder')])
    expect(checkCard('###### Title\nThe capital is {{Paris}}')).toEqual([fault('title-placeholder')])
    expect(checkCard('Title of the book\nIt is {{Dune}}')).toEqual([])
    expect(checkCard('title\nIt is {{Dune}}')).toEqual([])
  })

  it('hidden-subject: "What does {{…}} stand for" or "What does {{…}} mean", and nothing wider', () => {
    expect(checkCard('NASA\nWhat does {{NASA}} stand for?\n---\nNational Aeronautics and Space Administration')).toEqual([fault('hidden-subject', 0)])
    expect(checkCard('Ephemeral\nwhat DOES {{ephemeral}} Mean?\n---\nShort-lived')).toEqual([fault('hidden-subject', 0)])
    expect(checkCard('NASA\nWhat does NASA stand for?\n---\n{{National Aeronautics and Space Administration}}')).toEqual([])
    expect(checkCard('Ephemeral\nWhat does "ephemeral" mean?\n---\n{{Lasting a very short time}}')).toEqual([])
    expect(checkCard('Capital\nWhat does {{Paris}} have that Rome does not?\n---\nThe Louvre')).toEqual([])
  })

  it('a {{ in code is never checked: a code span or a code block', () => {
    expect(checkCard('Handlebars\nWrite `{{name}}` to print a value.\n---\nAnd `{{#if x}}` for a condition, and `{{oops`.')).toEqual([])
    expect(checkCard('Template\nWhat prints a value?\n---\n```hbs\n{{name\n{{}}\n```')).toEqual([])
    expect(checkCard('Docs\nWhat does `{{x}}` mean?\n---\nA hidden word.')).toEqual([])
  })

  it('a title in {{ }} is legal text (YAZ-5135)', () => {
    expect(checkCard('###### {{Capital of France}}\nThe capital is {{Paris}}')).toEqual([])
  })
})

/** One clean card for each of the 11 formats of the card skill: first line the title, `{{word}}`, `---`. */
const CLEAN: Record<string, string> = {
  acronym: 'NASA\nWhat does NASA stand for?\n---\n{{National Aeronautics and Space Administration}}',
  concept: 'Opportunity cost\nWhat is opportunity cost?\n---\nThe value of the {{next best option}} you give up when you choose.',
  comparison: 'TCP vs UDP\nHow does TCP differ from UDP?\n---\n- TCP: {{delivery and order are guaranteed}}\n- UDP: {{no guarantee, but less delay}}',
  vocabulary: 'Ephemeral\nWhat does "ephemeral" mean?\n---\n{{Lasting a very short time.}}\n\n*The ephemeral beauty of a sunset.*',
  book: 'Atomic Habits: the four laws\nThe four laws of behavior change: make it {{obvious}}, {{attractive}}, {{easy}} and {{satisfying}}.\n---\nJames Clear, *Atomic Habits*, chapter 3.',
  person: 'Ada Lovelace\nWho wrote the first published computer program?\n---\n{{Ada Lovelace}}, for the Analytical Engine of Charles Babbage (1843).',
  fact: 'Capital of Australia\nThe capital of Australia is {{Canberra}}, not Sydney.',
  procedure: 'Undo the last commit\nHow do you undo the last commit and keep its changes?\n---\n1. Run `git reset --soft HEAD~1`.\n2. The changes stay {{staged}}.',
  quote: 'Knuth on optimization\n> Premature optimization is the {{root of all evil}}.\n\n— Donald Knuth',
  story: 'The tortoise and the hare\nWhat is the lesson of the tortoise and the hare?\n---\n{{Slow and steady wins the race.}}',
  'script-and-sounds': 'Arabic letter ba\n![](assets/audio/ba.mp3)\nWhich letter makes this sound?\n---\n{{ب}} (bā), the sound "b".',
}

describe('checkCard: a clean card of each format gives no fault', () => {
  it('has the 11 formats', () => expect(Object.keys(CLEAN)).toHaveLength(11))
  for (const [format, text] of Object.entries(CLEAN)) it(format, () => expect(checkCard(text)).toEqual([]))
})

/** Every `.md` page of the shipped card skill (YAZ-5059 3A); none until 3A lands. */
const SKILL = path.resolve(__dirname, '../../../skills/card-skill')
function skillPages(dir = SKILL): string[] {
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((e) => (e.isDirectory() ? skillPages(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []))
}

/**
 * The card examples of a page (suggestion 1): each ```` ```markdown ```` block is one card, or holds ```` ```card ````
 * blocks. A bad card shown on purpose uses another fence (```` ```text ````), so it is not read here.
 */
function examplesOf(content: string): string[] {
  const lines = content.split('\n')
  const kinds = lineKinds(lines)
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = kinds[i] === 'fence' ? /^[ \t]*(`{3,}|~{3,})[ \t]*markdown[ \t]*$/i.exec(lines[i]) : null
    if (open === null) continue
    let end = i + 1
    while (end < lines.length && kinds[end] !== 'fence') end++
    const body = lines.slice(i + 1, end).join('\n')
    const cards = findCards(body)
    out.push(...(cards.length > 0 ? cards.map((c) => c.text) : [body]))
    i = end
  }
  return out
}

describe('the card skill’s own examples give no fault', () => {
  const pages = skillPages()
  it.skipIf(pages.length === 0)('every ```markdown example in skills/card-skill', () => {
    const faults = pages.flatMap((page) => examplesOf(readFileSync(page, 'utf8')).flatMap((text) => checkCard(text).map((f) => `${path.relative(SKILL, page)}: ${f.kind} in\n${text}`)))
    expect(faults).toEqual([])
  })

  it('reads a ```markdown block as a card, and the ```card blocks inside one', () => {
    expect(examplesOf('# Acronym\n\n```markdown\nNASA\nWhat does NASA stand for?\n---\n{{x}}\n```\n\n```text\nbad {{\n```\n')).toEqual(['NASA\nWhat does NASA stand for?\n---\n{{x}}'])
    expect(examplesOf('````markdown\n```card\nFact\nIt is {{y}}\n```\n````\n')).toEqual(['Fact\nIt is {{y}}'])
  })
})
