Placeholder text. Yaseen's version replaces this page.

# Rules for a good card

## What to recall

1. **Pick the format by what the learner must recall,** not by the topic. An acronym can need a concept card, an expansion card, or both.
2. **One recall task for each card.** Split facts that do not belong together. Keep a comparison together when the difference is the point.
3. **Hide the answer, not the clues.** The visible front must make sense to someone who does not know the answer.
4. **Keep the subject of a question visible.** Ask "What does DNS stand for?", not "What does {{DNS}} stand for?".
5. **Hide units of meaning.** Hide a short phrase that carries the idea, not scattered small words.
6. **On a definition, keep the term visible and hide its meaning.** "Inflation is {{a general rise in prices}}."
7. **Put the main answers on the front.** If the card is about a short list, hide the items on the front. The back explains them.

## How to write it

8. **Write prose that reads in one pass.** Short sentences, direct verbs, no filler.
9. **Use concrete situations.** Show the thing in use. If you use an analogy, say that it is one.
10. **Explain unfamiliar words in place.** A clue that needs another card to make sense is not a clue.
11. **Name the general idea, not the source passage.** The example from the book goes in the body, not in the title.
12. **Use `***` to divide sections on one side.** `---` starts a new side, so never use it as a divider.
13. **A picture teaches one point.** Give it labels and alt text.
14. **A link says what the other card adds.** Write "See [[ID]] for how it differs from X", not a bare link.

## How to check it

15. **Read the front with the answers hidden.** Then read the start of the back and look for words that give the answer away. Then show all and check the grammar and the facts.
16. **Do the substitution check.** If a nearby answer fits the clue as well, make the real difference sharper. Do not add trivia to force one answer.
17. **Meaning counts, not exact words.** Ask for exact wording only for commands, acronyms and quotes.
18. **Check the facts.** Say when an origin or a date is not certain. Keep the origin of an idea apart from its definition.
19. **When you edit a card, change only the part you were asked to change.** Point out other faults; do not fix them quietly.

## Before and after

Before: the question hides its own subject.

```markdown
DNS

What does {{DNS}} stand for?
```

After: the subject stays visible, and the answer is hidden.

```markdown
DNS

What does DNS stand for on the internet?
---
DNS stands for {{Domain Name System}}.

It turns a name like example.com into the address of a computer.
```

Before: small words are hidden, and nothing explains the term.

```markdown
Photosynthesis

{{Photosynthesis}} is how {{plants}} make {{food}} from {{light}}.
```

After: one term is hidden, and the clues stay visible.

```markdown
Photosynthesis

Plants use sunlight to turn water and carbon dioxide into sugar and oxygen. This process is {{photosynthesis}}.
```
