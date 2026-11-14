Placeholder text. Yaseen's version replaces this page.

The app replaces this copy on each update. Duplicate it to change it.

# Start here

This skill tells you, or your AI agent, how to make good cards in Yaseen Docs.

## What a card is

A card is a short text that the app asks you to recall on a schedule. You read the front, try to recall the hidden part, then show the answer and say how well you knew it.

A card lives in one of three places: **by itself** in a card file, **inside a page** in a `card` block, or **embedded in a page** with `![[ID]]`. Cards need a vault that gives its pages IDs (Settings).

## How a card is written

- Every card has a title. The Inbox, search and links show it. It is plain text: to keep it off the front, hide it as [[Titles]] says, never with `{{ }}`.
- Every card's title is on its card line, right after its ID: `title "<title>"`. A card's text is only its sides: its first line is part of the question, never its title. A card file's front matter holds only `kind: card`, never a `title:`.
- `{{word}}` hides a word or a phrase. A line with only `---` starts a new side. `***` divides sections on one side.
- A picture is `![alt text](path)`. A link is `[[Name]]` or `[[ID]]`.

A card with two sides, inside a page, as you write it by hand:

````markdown
```card
The capital city of Australia is {{Canberra}}.
---
Many people guess Sydney. Canberra was built as a compromise between Sydney and Melbourne.
```
<!-- card: title "Capital of Australia" -->
````

The same card as a card file. Its front matter holds only `kind: card`. The app and `card new` name a card file `<kebab-title>-<id>.md`:

````markdown
---
kind: card
---
```card
The capital city of Australia is {{Canberra}}.
---
Many people guess Sydney. Canberra was built as a compromise between Sydney and Melbourne.
```
<!-- card: title "Capital of Australia" -->
````

The card is the same block in both places. The examples in the formats show it as it sits inside a page; in a card file, put `kind: card` in front matter above it.

The app writes the card line under the block. Never change a card line that the app wrote: it holds the card's ID, its title and its reviews. On a new card that you write by hand, put the line `<!-- card: title "<title>" -->` directly below the closing fence (add `, notitle` to hide the title on the front); the app adds the ID and keeps the rest. With the command, use `--title` and `--hide-title`.

## How to make a card

1. **Pick a format** by what the learner must recall. The `formats` folder has one page for each.
2. **Draft it** with the format's skeleton, the [[Rules for a good card]] and [[Titles]].
3. **Read it with the answers hidden,** as someone who does not know them.
4. **Add it** with a command, or in the app.

## Commands for an agent

- Add a card to the end of a page: `yaseendocs card add <page.md> --title <text> --body <text>`
- Make a card file in a folder: `yaseendocs card new <folder> --title <text> --body <text>`
- Print this skill: `yaseendocs card guide`

With `card add` and `card new`, `--title` is the card's title, written on its card line, and `--body` is its sides. `--body -` reads the body from standard input. `--hide-title` hides the title on the front.

## The pages

- [[Rules for a good card]], [[Titles]], [[What changed]].
- Formats: [[acronym]], [[concept]], [[comparison]], [[vocabulary]], [[book]], [[person]], [[fact]], [[procedure]], [[quote]], [[story]], [[script and sounds]].
