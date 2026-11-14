Placeholder text. Yaseen's version replaces this page.

The app replaces this copy on each update. Duplicate it to change it.

# Start here

This skill tells you, or your AI agent, how to make good cards in Yaseen Docs.

## What a card is

A card is a short text that the app asks you to recall on a schedule. You read the front, try to recall the hidden part, then show the answer and say how well you knew it.

A card lives in one of three places: **by itself** in a card file, **inside a page** in a `card` block, or **embedded in a page** with `![[ID]]`. Cards need a vault that gives its notes IDs (Settings).

## How a card is written

- The **first line** is the card's title. The Inbox, search and links show it.
- `{{word}}` hides a word or a phrase. A line with only `---` starts a new side. `***` divides sections on one side.
- A picture is `![alt text](path)`. A link is `[[Name]]` or `[[ID]]`.

A card with two sides, inside a page:

````markdown
```card
Capital of Australia

The capital city of Australia is {{Canberra}}.
---
Many people guess Sydney. Canberra was built as a compromise between Sydney and Melbourne.
```
````

The app writes the line under the block, with the card's ID and its reviews. Never write that line by hand.

## How to make a card

1. **Pick a format** by what the learner must recall. The `formats` folder has one page for each.
2. **Draft it** with the format's skeleton, the [[Rules for a good card]] and [[Titles]].
3. **Read it with the answers hidden,** as someone who does not know them.
4. **Check it** with [[Check your card]].
5. **Add it** with a command, or in the app.

## Commands for an agent

- Add a card to the end of a page: `yaseendocs card add <page.md> --title <text> --body <text>`
- Make a card file in a folder: `yaseendocs card new <folder> --title <text> --body <text>`
- Check the cards of a page: `yaseendocs card check <page.md>`
- Print this skill: `yaseendocs card guide`

`--title` is the card's first line, and `--body` is the rest. `--body -` reads the body from standard input.

## The pages

- [[Rules for a good card]], [[Titles]], [[Check your card]], [[What changed]].
- Formats: [[acronym]], [[concept]], [[comparison]], [[vocabulary]], [[book]], [[person]], [[fact]], [[procedure]], [[quote]], [[story]], [[script and sounds]].
