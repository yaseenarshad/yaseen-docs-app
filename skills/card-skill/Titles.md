Placeholder text. Yaseen's version replaces this page.

# Titles

Every card has a title. The Inbox, search, the list of cards and `[[ID]]` links show it. A good title tells you which idea you will open.

Every card's title is on its card line, right after its ID: `title "<title>"`. A card's text is only its sides: its first line is part of the question, never its title. A card file's front matter holds only `kind: card`, never a `title:`. This is the same for a card inside a page and for a card file.

The title is plain text on one line, in double quotes. In it, write `\"` for a quote, `\\` for a backslash and `\>` for `>`. A card with no title shows "Untitled card" in its head, and its ID in links.

## How to name a card

- **Name the idea, not the passage.** Ask what general idea the source is an example of. Name that idea.
- **Use the established name** when there is one: "Compound interest". When there is none, write a short plain phrase.
- **Make it distinct, not too broad.** "Decision making" could head fifty cards. Pick the widest name that only this card covers.
- **Do not write a question.** The title is a name. The question goes on the front.
- **Never leave it as "Title", or empty.**
- **Keep two terms on one line:** "Weather vs climate".

## Patterns for some formats

- Book: `<Title> by <Author> (Book)`, as in "On the Origin of Species by Charles Darwin (Book)".
- Person: the name alone, as in "Marie Curie".
- Quote: `<Speaker> on <topic>`, when you are sure who said it. Otherwise a short theme.
- Story: `Story: <Person> - <a cue you will remember>`.

## Shown or hidden on the front

A title is shown when it is a cue. It is hidden when it would give the answer away.

- **Shown:** the title names the task, and the answer is something else. "HTTP" on an acronym card. "Force quit a frozen app" on a procedure card.
- **Hidden:** the title is the answer. A vocabulary card titled "Terse" must not show "Terse" on the front.

The title is always plain text on the card line. Hiding it is an option of the card, not part of its text. Do not put the title in `{{ }}`.

How to hide it. Each way writes the part `notitle` on the card line, after the title, below the card's closing fence. This is the same for both kinds of card:

- **With the command:** add `--hide-title` to `yaseendocs card add …` or `yaseendocs card new …`.
- **In a file you write by hand:** put `, notitle` after the title on the card line of a new card: `<!-- card: title "<title>", notitle -->`.
- **In the app:** the card's ⋯ menu › "Title on the front" › Hide.

**The card line.** Never change a card line that the app wrote: it holds the card's ID, its title and its reviews. On a new card that you write by hand, put the line `<!-- card: title "<title>" -->` directly below the closing fence (add `, notitle` to hide the title on the front); the app adds the ID and keeps the rest. With the command, use `--title` and `--hide-title`. To rename a card later, click its title in the app.

A card inside a page, written by hand, with its title hidden:

````markdown
```card
A savings account pays 5% a year and adds the interest to the balance. Next year, the 5% is paid on the larger sum. This is {{compound interest}}.
```
<!-- card: title "Compound interest", notitle -->
````

A card file, written by hand, with its title hidden:

````markdown
---
kind: card
---
```card
A savings account pays 5% a year and adds the interest to the balance. Next year, the 5% is paid on the larger sum. This is {{compound interest}}.
```
<!-- card: title "Compound interest", notitle -->
````

In review, the front shows without the title. The title shows once the whole card is shown. Lists and links always show it.

**Defaults:** shown for acronym and procedure. Hidden for concept, comparison, vocabulary, book, person, fact, quote, story, and script and sounds. Change the default when a card calls for it.
