Placeholder text. Yaseen's version replaces this page.

# Script and sounds

Use it to learn to read a new alphabet: the sound of a letter, two letters that look alike, or a word to read aloud. **Title: hidden.** The title names the letter, and the name is part of the answer. Hide it with `--hide-title`, not with `{{ }}` (see [[Titles]]).

## Skeleton

- One task for each card: a letter's sound, a contrast, or a word to read.
- Front: the letter or word, clear and visible. Its sound is hidden.
- Back: the letter's name, how to tell it apart, and one example word.
- Do not give the sound away on the front.

## Example

````markdown
```card
The Greek letter λ makes the sound {{l}}, as in "lamp".
---
Name: {{lambda}}.
Capital form: Λ, like an upside-down V.
Example: λάμπα (lampa) means "lamp".
```
<!-- card: title "Greek letter lambda", notitle -->
````
