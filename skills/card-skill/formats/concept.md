Placeholder text. Yaseen's version replaces this page.

# Concept

Use it to learn an idea, a principle, a term or a tool: what it is and how it is used. **Title: hidden.** The title is the term, and the term is the answer. Hide it with `--hide-title`, not with `{{ }}` (see [[Titles]]).

## Skeleton

- Title: the term. Hide it on the front.
- Front, part 1: a concrete situation that shows it in use, with the term hidden.
- Front, part 2: a one-sentence definition, with the meaning visible and the term hidden again.
- Back: the term visible and its core meaning hidden. Then extra detail, mechanisms or a picture as needed.
- For a short list, such as three levels, hide the items on the front. The back explains them.

## Example

````markdown
```card
A savings account pays 5% a year and adds the interest to the balance. Next year, the 5% is paid on the larger sum. This is {{compound interest}}.

Interest paid on both the original sum and the interest already earned is {{compound interest}}.
---
Compound interest is interest paid on {{earlier interest as well as the original sum}}.

So the balance grows {{faster each year}}, even when the rate stays the same.
```
<!-- card: title "Compound interest", notitle -->
````
