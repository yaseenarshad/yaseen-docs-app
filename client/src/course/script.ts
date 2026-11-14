/**
 * The card course's words, version 3 (YAZ-5148; version 2 was YAZ-5147, version 1 YAZ-5119, issue 6A of YAZ-5118).
 * Each clip is one or two spoken sentences, and it is also the caption. The comment above each clip says what the scene
 * shows (issue 6C) and, after "WAITS:", where the person acts. "SOURCE:" names the study or page behind a fact (the
 * comment "Sources (agent)" on YAZ-5148 has the links). "APP:" names the file that confirms an app fact, as the code is
 * after the demo branch and the YAZ-5036 rename were merged in (`ee5c7f18b`).
 *
 * Version 3 keeps the chapters Yaseen approved on version 2 (1, 3, 4, 5, 6, 8, 9 and the gardener). It reworks chapter
 * 2 (the title facts, the toolbar, no "atomic") and chapter 7 (cards as nodes on a tree), adds chapter 10 (links), and
 * adds links and scheduled agents to the gardener (now 11). A clip whose words changed keeps its id; a new clip takes
 * the next free number. The gardener and the last chapter moved from 10 and 11 to 11 and 12, so their ids did too.
 *
 * Version 3, round 2 (written by hand after Yaseen's comments on YAZ-5148): a card is the hub of one idea, not a line or two.
 * Chapter 2 shows a real card and its parts (a small front to recall, a back with room to understand, links at the
 * bottom). Chapter 7 teaches the umbrella card and its branches. Chapters 10 and 11 carry the same tree on: links join
 * branches across trees, and the gardener grows and prunes them. One example runs through all four: protein, carbs and
 * fat. The shape of the example card follows Yaseen's own cards (a front of a sentence or two with one or two hidden
 * parts; a back in sections; each link with a few words on why).
 *
 * Round 3 (Yaseen's comments in the doc YAS-2084): the front is the short version of the idea, with the key part hidden;
 * the back has the details, in sections (his word). A front may be a question, or a sentence with a hidden part
 * ("cloze deletion" to memory scientists, "hidden words" in the app). Links are made with the agent, handmade: the
 * agent shows each one in the chat, and the person reads and approves it.
 *
 * Yaseen approves each chapter's words before its voice is made (issue 6D). `skills/card-skill/Course transcript.md` is
 * made from this file: run `UPDATE_COURSE_TRANSCRIPT=1 npx vitest run client/src/course/script.test.ts` after a change.
 */
import type { TourStep } from './tour'

/** One spoken line: its clip, its caption, and the moments in it that a scene waits for. */
export interface CourseClip { id: string; text: string; marks?: number[] }

/** One chapter: what is shown, then the optional steps to try in the real app. */
export interface CourseChapter { id: string; title: string; clips: CourseClip[]; tryIt?: TourStep[] }

/** The first sentence of the prompt for the person's own agent (issue 1C, "Copy prompt for your agent"). `{path}` is the card skill's folder. */
export const AGENT_PROMPT = 'Read the card skill at "{path}" before you make or change cards in this vault.'

/** Chapter 8: the one line after 60 seconds with no new card from the agent (YAZ-5124). The course keeps waiting. */
export const NO_CARDS_YET = 'No new cards yet. Did you check with your agent?'

export const COURSE: CourseChapter[] = [
  {
    id: 'why',
    title: 'Why you forget, and the fix',
    clips: [
      // A fact glows on the stage; the forgetting curve starts to fall and the fact fades.
      { id: 'c1-01', text: 'Say you learn something today. A week from now, your brain will have forgotten most of it.' },
      // An old notebook page of nonsense syllables ("DAX", "BOK", "YAT"); the year 1885.
      // SOURCE: Ebbinghaus 1885, Memory: A Contribution to Experimental Psychology; savings data as given in Murre & Dros 2015, PLOS ONE, Table 3.
      { id: 'c1-02', text: 'In the 1880s, Hermann Ebbinghaus measured this on himself. One day after he learned a list, most of that work was gone. Learning it again took two thirds of the time.' },
      // The old curve from 1885 and a new one from 2015 slide over each other; they match.
      // SOURCE: Murre & Dros 2015, "Replication and Analysis of Ebbinghaus' Forgetting Curve", PLOS ONE 10(7): "We conclude that the Ebbinghaus forgetting curve has indeed been replicated."
      { id: 'c1-22', text: 'In 2015, scientists repeated his experiment. A hundred and thirty years later, they got the same curve.' },
      // A review just before the curve drops; the curve lifts and falls slower.
      { id: 'c1-03', text: 'But review it again before you forget, and it sticks longer.' },
      // Three reviews; the gaps label "1 day", "1 week", "1 month" on the marks. (Approved sample, unchanged.)
      { id: 's2b', text: 'Each time, the gap grows. A day. A week. A month.', marks: [0.439, 0.597, 0.74] },
      // A small glowing memory, faint at first, grows solid over time.
      // SOURCE: Squire, Genzel, Wixted & Morris 2015, "Memory Consolidation", Cold Spring Harb Perspect Biol.
      { id: 'c1-04', text: 'A new memory starts out fragile. Over time, the brain makes it stable. Scientists call this consolidation.' },
      // Each review mark pushes the memory deeper, from a "Short-term" band into a "Long-term" band.
      { id: 'c1-05', text: 'Each review, near the point where you would forget, pushes the memory further into long-term memory.' },
      // Two brain cells and the link between them; with each spaced pulse, a switch inside the cell turns on and the link grows stronger.
      // SOURCE: Naqib, Sossin & Farah 2012, "Molecular Determinants of the Spacing Effect", Neural Plasticity (CREB-dependent gene expression after spaced training, in Aplysia, Drosophila and rodents).
      { id: 'c1-18', text: 'This is hard science. Researchers have watched it in brain cells: spaced practice switches on the genes that build long-term memory.' },
      // A Nobel medal; "2000".
      // SOURCE: The Nobel Prize in Physiology or Medicine 2000 (Eric Kandel, with Carlsson and Greengard): how nerve cells change to store memory.
      { id: 'c1-19', text: 'The work that first showed how brain cells store a memory won a Nobel Prize.' },
      // A wall of small study tiles fills in, "317 experiments"; spaced reviews beat reviews done all at once.
      // SOURCE: Cepeda, Pashler, Vul, Wixted & Rohrer 2006, "Distributed practice in verbal recall tasks", Psychological Bulletin: 317 experiments in 184 articles.
      { id: 'c1-06', text: 'Scientists have tested this for more than a century. One review alone covered 317 experiments, and spacing won.' },
      // A ridge-shaped graph: memory kept, against the gap before the review; a peak in the middle, lower on both sides; "more than 1,350 people".
      // SOURCE: Cepeda, Vul, Rohrer, Wixted & Pashler 2008, "Spacing effects in learning: a temporal ridgeline of optimal retention", Psychological Science 19(11): more than 1,350 people; the best gap depends on how long the memory must last.
      { id: 'c1-20', text: 'And yes, there is a best moment to review. A study of more than 1,300 people found it: too early or too late, and you keep less.' },
      // A paper index card drops onto the stage.
      { id: 'c1-07', text: 'So how do you store each thing you learn in the app? Answer: on a card.' },
      // The paper index card becomes the app's real card: a title, a fact, one word as a blank.
      // v3: "one small fact" became "one idea" (the node idea of chapter 7: a card can start as a light overview).
      { id: 'c1-08', text: 'A card is one idea, with part of it hidden.' },
      // Many cards fan out across the stage, each with one fact.
      { id: 'c1-09', text: 'You will have many cards, one for each thing you want to keep.' },
      // Behind the curve, small gears turn; a date lights up on a calendar just before the curve drops. The words "Spaced repetition algorithm" settle under it. (Yaseen's line, from the doc YAS-2084.)
      { id: 'c1-16', text: 'The app runs an algorithm behind the scenes to keep track of this for you, and predicts the day you are about to forget it. This is called a spaced repetition algorithm.' },
      // The words "FSRS" over a card; behind it, a small graph of one memory: a curve, and numbers that update.
      // SOURCE: shared/cardSchedule.ts (FSRS through ts-fsrs 5.4.2, the FSRS-6 weights); FSRS models each card's memory (stability, difficulty) and computes the chance of recall.
      { id: 'c1-12', text: 'That algorithm is called FSRS. It is a mathematical model of your memory.' },
      // A card's curve with a dotted line at 90%; the odds tick down day by day; the next date lands where the curve meets the line.
      // SOURCE: shared/reviews.ts DEFAULT_REVIEW_SETTINGS.retention = 0.9; shared/cardSchedule.ts `recallChance`.
      { id: 'c1-17', text: 'For every card, every day, it works out the odds that you still remember it. When they drop to about ninety percent, the card comes back.' },
      // The 90% line and the ridge's peak from before line up; a marker lands on the best moment for this card, then the next card, then the next.
      { id: 'c1-21', text: 'The algorithm finds that moment for every card, precisely for you, by studying your memory.' },
      // A calendar; each card takes its own date.
      { id: 'c1-10', text: 'The app keeps a calendar for every card. On the day a card is due, it shows it to you.' },
      // The blank fills in; two buttons, Forgot and Remembered.
      { id: 'c1-11', text: 'You try to recall the hidden part, then check. And you answer: forgot, or remembered.' },
      // The chapter list lights up, 1 to 12.
      { id: 'c1-13', text: 'This course takes about twenty-eight minutes, in twelve short chapters.' },
      // The "Try it in the app" button, with "Optional" beside it.
      { id: 'c1-14', text: 'Some chapters let you try the steps in the real app. That part is always your choice.' },
      // The curve with its growing gaps, then the paper index card alone in the middle of the stage.
      { id: 'c1-15', text: 'Your brain forgets on a curve. Now you have a way to beat it. Next: what a card really is, and you make your first one.' },
    ],
  },
  {
    id: 'first-card',
    title: 'The card: the hub of an idea',
    clips: [
      // The paper index card from chapter 1, and the calendar behind it.
      { id: 'c2-01', text: 'Quick recap: each thing you learn goes on a card. Now, what a card really is, and how to make one.' },
      // The small paper index card with one short line of handwriting on it.
      { id: 'c2-02', text: 'When most people hear "card", they picture a line or two on a small piece of paper.' },
      // The paper card becomes a dot in the middle of the stage; short lines reach out from it, like spokes. The word "Hub".
      { id: 'c2-03', text: 'Think of it another way. A card is the hub of one idea: the centre where what you know about it comes together.' },
      // A REAL CARD fills the stage, in the app's own look. Title: "Protein, carbs and fat". The front lights up:
      //   "The three things food is mostly made of are {{protein, carbs and fat}}."
      //   "Your body builds and repairs with {{protein}}, and gets its quick energy from {{carbs}}."
      // The hidden parts show as blanks.
      { id: 'c2-04', text: 'Here is a real one. The front is the short version: the idea in a sentence or two, with the key part hidden.' },
      // The same card turns to its back; three parts light up in turn, each under a thin line:
      //   "Protein builds and repairs. Carbs are quick energy. Fat is slow energy, stored."
      //   EXAMPLE: "An egg is mostly protein and fat. Bread is mostly carbs."
      //   MEMORY HOOK: "Protein is the bricks. Carbs are the kindling. Fat is the logs."
      { id: 'c2-05', text: 'The back has the details: how it works, an example, a hook to remember it by.' },
      // The bottom of the back: CONNECTIONS, with one link pill and a few grey words after it.
      { id: 'c2-22', text: 'And at the bottom, links to the cards it connects to. You will make those in chapter 10.' },
      // A SECOND REAL CARD, for a word. Title: "candid". The front lights up, two lines, the word a blank in both:
      //   "I asked for {{candid}} feedback, and she told me plainly what did not work."
      //   "Honest and direct, even when it is hard to hear, is {{candid}}."
      { id: 'c2-30', text: 'Here is another, for a new word. The front has a sentence that uses the word, then what it means. The word is hidden in both.' },
      // The word card turns to its back; its sections light up in turn:
      //   "Candid means open and honest, with nothing held back."
      //   PRONUNCIATION: "KAN-did". MEMORY HOOK: "A candid photo is one nobody posed for." EXAMPLES: two more sentences.
      { id: 'c2-31', text: 'Its back has the details too: how to say it, where it comes from, more examples.' },
      // Three sizes side by side: one bare line, the real card, a full page of text. The real card gets the check; "Front: the short version", "Back: the details".
      { id: 'c2-23', text: 'So a card is more than one line, and far less than a page. The short version on the front, the details on the back.' },
      // The name "Piotr Wozniak" and "1999"; on the real card, only the front's blanks glow.
      // SOURCE: Wozniak 1999, "Effective learning: Twenty rules of formulating knowledge", rule 4, the minimum information principle (supermemo.com).
      { id: 'c2-24', text: 'Piotr Wozniak, who built SuperMemo, made it a rule: keep the front simple. A simple front is easier to remember.' },
      // The real card with a short back; a second and a third part join the back over time. It stays one card.
      { id: 'c2-25', text: 'A card is never finished. It starts light, and it grows as you learn more.' },
      // All the cards together form one growing set, labelled "Card base"; cards slide together in new groups, like pieces that fit many ways.
      { id: 'c2-26', text: 'All your cards together are your card base. Each card is one idea, so cards can be mixed and matched, wherever you need them.' },
      // A blank card in the middle of the stage.
      { id: 'c2-06', text: 'Your turn. Think of something you learned this week.' },
      // An empty card with a blinking caret. WAITS: the person types a sentence or two.
      { id: 'c2-07', text: 'Type the short version of it, in a sentence or two.' },
      // The words become buttons. WAITS: the person taps the word to hide.
      { id: 'c2-08', text: 'Now tap the word you want to hide.' },
      // The word turns into a blank; the card takes its frame; the label "Front".
      { id: 'c2-09', text: "That's the front. The hidden word is the part you will try to recall." },
      // A line labelled "Side 2" appears under the front, with a caret. WAITS: the person types a line (or skips).
      { id: 'c2-28', text: 'Now the back. Add one detail: how it works, or an example.' },
      // The card, front only. WAITS: the person taps the card to show the word, then the back.
      { id: 'c2-10', text: 'Tap the card to check yourself.' },
      // Forgot and Remembered under the card. WAITS: the person picks one.
      { id: 'c2-11', text: 'Did you remember it?' },
      // The answer's quiet line under the card.
      { id: 'c2-12', text: 'Either answer is fine. The app saves it with the card.' },
      // The sidebar: the folder "Course Cards" opens and shows the new card file.
      { id: 'c2-13', text: 'Your card is now a real file, in a folder called Course Cards, at the top of your vault.' },
      // A folder's right-click menu, "New card"; the name box in the sidebar; a title is typed, Enter; the card's tab opens in Edit card, empty.
      // APP: client/src/sidebar/menuSections.ts (`newCard`, "New card"), client/src/sidebar/CreateInline.tsx (Enter), client/src/review/newCardFile.ts (the typed name is the title; the tab opens in Edit card).
      { id: 'c2-15', text: 'In the app, right-click a folder and choose New card. Type the title, press Enter, then the front.' },
      // A word is selected; the toolbar shows over it; the braces button "Hide word" is clicked; then the key row "Cmd + L hide word".
      // APP: client/src/editor/card/cardEditor.ts (`hideWordButton`: "Hide word", ⌘L, right after H1 H2 H3 T), client/src/editor/card/cardBlockView.ts (`CARD_EDIT_KEYS`, written "Cmd + L" by client/src/keys/keyWords.ts).
      { id: 'c2-16', text: 'To hide a word, select it, and click Hide word in the toolbar. The key is Command L.' },
      // "/" opens the menu; "New side" is chosen; a line labelled "Side 2" splits the card; then the key row "Cmd + Shift + Enter new side".
      // APP: client/src/editor/card/cardEditor.ts (`newSideSlashRow`: "New side", ⌘⇧↵), client/src/editor/card/card.css ("Side 2" label, YAZ-5103). The toolbar has no side button.
      { id: 'c2-17', text: 'For the back, type slash, and choose New side. The key is Command Shift Enter.' },
      // On the back, three stars are typed on an empty line; they turn into a thin line; "EXAMPLE" is typed under it. Yaseen's word for each part is a section.
      // APP: client/src/editor/card/cardEditor.ts (three stars on an empty line stay a line, an hr; three dashes are a new side).
      { id: 'c2-29', text: 'You can add sections to the back. Type three stars on an empty line, and they turn into a line. Sections break up the details, so they are easier to take in.' },
      // Esc, or the Done button in the card's head; the card shows again, saved.
      // APP: client/src/editor/card/cardBlockView.ts (the edit button reads "Done" while editing; "Cmd + Enter / Esc Done").
      { id: 'c2-20', text: 'Press Escape, or click Done, and the card saves.' },
      // The card file's tab: the big title at the top; a click, new words, Enter; the tab and the sidebar take the new name.
      // APP: shared/cardFileFormat.ts (the title is the `title` property, the file is named after it), client/src/editor/CardFileView.tsx (`PageTitle`: click, type, Enter). A card INSIDE a page keeps its first line as its title (chapter 4 does not say it).
      { id: 'c2-14', text: "The title sits at the top of the card's tab. Click it to change it, and the file's name follows." },
      // The card's ⋯ menu: "Title on the front · Show"; a click; it reads "Hide".
      // APP: client/src/review/cardPane.tsx (`cardMenuSections`: "Title on the front", Show / Hide).
      { id: 'c2-21', text: "If the title gives the answer away, set Title on the front to Hide, in the card's menu." },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c2-18', text: 'To make one in the real app now, choose Try it in the app.' },
      // The real card as a hub, with its spokes; then the sidebar's Inbox row glows softly.
      { id: 'c2-19', text: 'A card is the hub of one idea: the short version on the front, the details on the back, and room to grow. Next: the place your cards come back to, each day.' },
    ],
    tryIt: [
      { target: 'sidebar-course-cards', say: 'Right-click the Course Cards folder in the sidebar.', done: { event: 'folder-menu-open' } },
      { target: 'new-card', say: 'Choose New card.', done: 'click' },
      { target: 'new-card-name', say: 'Type a title, and press Enter.', done: { event: 'card-file-created' } },
      { target: 'card-editor', say: 'Now type the front: the short version, in a sentence or two.', done: { event: 'card-text-changed' } },
      { target: 'card-editor', say: 'Select one word. In the toolbar above it, click Hide word.', done: { event: 'card-word-hidden' } },
      { target: 'card-editor', say: 'Type slash, and choose New side. Then add one detail.', done: { event: 'card-side-added' } },
      { target: 'card-done', say: 'Press Escape, or click Done, to save your card.', done: { event: 'card-edit-done' } },
    ],
  },
  {
    id: 'inbox',
    title: 'The Inbox, each day',
    clips: [
      // The card from chapter 2, in the Course Cards folder.
      { id: 'c3-01', text: 'You made your first card. Here is the daily habit that brings it back.' },
      // A calendar with many cards on many days; it fades.
      { id: 'c3-02', text: 'So which card do you look at, and when?' },
      // The real sidebar; the Inbox row lights up.
      { id: 'c3-03', text: 'The app keeps track of the dates for you. All you do is open the Inbox every day.' },
      // The Inbox row's number, "4".
      { id: 'c3-04', text: 'The Inbox is in the sidebar. The number beside it is how many cards are due now.' },
      // The real Inbox on sample cards: one card in the middle, "1 of 4".
      { id: 'c3-05', text: 'The Inbox shows one card at a time. Look at the card, and try to recall what is hidden.' },
      // The cover of the journal Science, 15 February 2008; a paper slides out: "The Critical Importance of Retrieval for Learning"; one sentence is highlighted.
      // SOURCE: Karpicke & Roediger 2008, "The Critical Importance of Retrieval for Learning", Science 319(5865):966-968.
      { id: 'c3-06', text: 'Trying to recall is what makes it stick. A study in the journal Science put it to the test.' },
      // Two bars rise, one week later: "Kept testing themselves: 80%", "Kept re-reading, no testing: 36%".
      // SOURCE: the same paper, Fig. 2 and text: about 80% recalled in the repeated-testing conditions (ST, SnT); 36% in the repeated-study, no-more-testing condition (STn).
      { id: 'c3-07', text: 'People who kept testing themselves remembered 80 percent a week later. People who kept re-reading, with no testing, remembered 36 percent.' },
      // Under the bars: "Rounds of practice: 237 and 243".
      // SOURCE: the same paper, Table 1: 236.8 trials (SnT, repeated testing) against 243.0 trials (STn, repeated study).
      { id: 'c3-23', text: 'About the same amount of work. More than double the memory.' },
      // Space; the hidden word shows, then the back.
      { id: 'c3-08', text: 'Press Space to show the hidden words, one at a time, and then the back.' },
      // Forgot and Remembered show under the card.
      { id: 'c3-09', text: 'Then choose Forgot or Remembered. Be honest. It only helps you.' },
      // The hover on Remembered: "Remembered · 9 days".
      { id: 'c3-10', text: 'Hold the pointer on a button to see when the card comes back.' },
      // The key row: 1 and 2 on the buttons; ⌘Z.
      { id: 'c3-11', text: 'You can also press 1 for Forgot and 2 for Remembered. Command Z takes back the last answer.' },
      // The calendar again, under the card.
      { id: 'c3-12', text: 'Based on that, the app moves the calendar for you.' },
      // Forgot; the card's date moves closer.
      { id: 'c3-13', text: 'If you forgot, the card comes back sooner, so you can learn it again.' },
      // The forgotten card goes to the end of the queue and comes round again.
      { id: 'c3-14', text: 'In fact, a card you forgot comes back later in the same review, until you remember it.' },
      // Remembered; the card's date moves further, a bigger gap each time.
      { id: 'c3-15', text: 'If you remembered, the card waits longer. Each time you remember it, the wait grows.' },
      // A new card: two check marks, then it leaves for a later day.
      { id: 'c3-16', text: 'A new card needs two Remembered in a row. Then it leaves for a day or more.' },
      // The dates fill in by themselves.
      { id: 'c3-17', text: 'You never set a date. The app works out each date from your answers.' },
      // A few days pass on the calendar; the due cards wait in the Inbox.
      { id: 'c3-18', text: "Missed a day? That's fine. The cards that are due wait in the Inbox until you come back." },
      // "New cards a day: 10" in Settings › Review.
      { id: 'c3-19', text: 'To keep it light, the Inbox brings at most ten new cards a day. You can change that number in Settings.' },
      // The done screen: "Inbox complete."
      { id: 'c3-20', text: "When nothing is left, the Inbox says Inbox complete. That's it for today." },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c3-21', text: 'To answer your own card in the real app, choose Try it in the app.' },
      // A page of text, with a space between two paragraphs.
      { id: 'c3-22', text: 'A few minutes a day, and the algorithm does the rest. Next: your cards can live right inside your pages.' },
    ],
    tryIt: [
      { target: 'sidebar-course-cards', say: 'Right-click the Course Cards folder.', done: { event: 'folder-menu-open' } },
      { target: 'review-folder', say: 'Choose Review this folder.', done: 'click' },
      { target: 'inbox-card', say: 'Look at the card, and try to recall the hidden word. Then press Space.', done: { event: 'inbox-step-shown' } },
      { target: 'inbox-answers', say: 'Now choose Forgot or Remembered.', done: { event: 'inbox-answered' } },
      { target: 'sidebar-inbox', say: 'From tomorrow, start here. Click Inbox to see what is due.', done: 'click' },
    ],
  },
  {
    id: 'where',
    title: 'Where a card lives',
    clips: [
      // The card file and the Inbox, side by side.
      { id: 'c4-01', text: 'So far, your card is a file of its own. It can also live beside your pages.' },
      // Three empty frames side by side: "By itself", "In a page", "Embedded".
      { id: 'c4-02', text: 'A card can live in three places. The review works the same in each one.' },
      // The card file from chapter 2 in its own tab.
      { id: 'c4-03', text: "First, a card by itself. That's the card file you made: one file, one card." },
      // A page of text with a card between two paragraphs.
      { id: 'c4-04', text: 'Second, a card inside a page. Your pages on a topic can hold cards right beside the text.' },
      // A "/card" typed in a page; a new card opens for editing.
      { id: 'c4-05', text: 'In a page, type slash card, and press Enter. A new card opens, ready to edit.' },
      // A card in a page with its ⋯ menu, its Reviews, and the Inbox behind it.
      { id: 'c4-06', text: 'A card in a page has the same menu, the same history, and the same Inbox.' },
      // A page's right-click menu: "Review this page".
      { id: 'c4-07', text: 'To review only the cards of one page, right-click the page, and choose Review this page.' },
      // A page shows a card that lives in another file; an arrow back to the card file.
      { id: 'c4-08', text: 'Third, a card embedded in a page. The card lives in one place, and the page shows it.' },
      // The card's ⋯ menu, "Copy card link"; a paste in the page, a pill; a right-click on the pill, "Show as embed".
      // APP: client/src/review/cardPane.tsx ("Copy card link" copies `[[ID]]`, on the card file tab), client/src/editor/linkMenu.ts ("Show as embed"),
      // client/src/editor/card/cardEmbed.test.ts. v3: the paste chip's "Embed" shows only for a pasted card file PATH (client/src/editor/pathPaste.ts), not for `[[ID]]`.
      { id: 'c4-09', text: "To embed one, copy the card's link from its menu, and paste it in a page. Then right-click the link, and choose Show as embed." },
      // A short message to the agent: "Embed my protein card in the Food page"; the embed appears in the page.
      { id: 'c4-16', text: 'Or just tell your agent: embed this card in that page.' },
      // The embed's head: ↗ Embedded from "…" · ID.
      { id: 'c4-10', text: "The embed has a small head that says Embedded from, with the card's title." },
      // Edit card on the embed; the card file changes too.
      { id: 'c4-11', text: 'Edit an embed, and you change the one real card. Its history stays with it.' },
      // A card moves between the three frames; its history line follows.
      { id: 'c4-12', text: 'You can move a card between these places at any time. Its history goes with it.' },
      // Two labels: "A fact on its own" under the card file, "Part of your pages" under the page.
      { id: 'c4-13', text: 'Use a card file for a fact on its own. Use a card in a page when it belongs with your pages.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c4-14', text: 'To embed your first card in a page, choose Try it in the app.' },
      // One card shown in three pages at once; lines lead back to it. Then the stage widens.
      { id: 'c4-15', text: 'This is the mix and match from before: one card, one home, shown wherever it helps. Next: where all of this can take you.' },
    ],
    tryIt: [
      { target: 'card-menu', say: "Open your card's menu: the three dots in its head.", done: 'click' },
      { target: 'card-copy-link', say: 'Choose Copy card link.', done: 'click' },
      { target: 'course-page', say: 'Now open Course page, in the Course Cards folder.', done: 'click' },
      { target: 'page-editor', say: 'Click in the page, and paste with Command V. Then right-click the link, and choose Show as embed.', done: { event: 'card-embedded' } },
    ],
  },
  {
    id: 'compound',
    title: 'Why it is worth it',
    clips: [
      // The four chapters so far, as four small ticks.
      { id: 'c5-01', text: 'You can make, review and place a card. Now, why it is worth doing.' },
      // A small sum grows on itself, like interest on savings.
      { id: 'c5-02', text: 'What you learn this way compounds. To compound is to grow on itself, like interest.' },
      // One card, then a new card that hooks onto it.
      { id: 'c5-03', text: 'Each thing you keep gives the next thing something to hold on to.' },
      // A counter: 5 cards a day, the days of a year pass, "1,825".
      { id: 'c5-04', text: 'Say you make five cards a day. In a year, that is more than 1,800 small things you still know.' },
      // The pile grows tall; the daily stack beside it stays small.
      { id: 'c5-05', text: 'And known cards come back less often, so the daily review stays small as the pile grows.' },
      // One card on a time line; four marks appear: "2 days", "11 days", "6 weeks", "5 months". The gaps stretch across the stage.
      // SOURCE: this app's own scheduler with its default settings (ts-fsrs 5.4.2, FSRS-6 weights, 90% retention, no fuzz), each answer Remembered on the due day: gaps of 2, 11, 46 and 163 days; then the default longest gap of 365 days (shared/reviews.ts `maxDays`).
      { id: 'c5-13', text: 'Follow one card you keep remembering. It comes back after two days. Then eleven. Then about six weeks. Then about five months.' },
      // The time line zooms out: the card's next mark is far off to the right, past "2 months in".
      { id: 'c5-14', text: 'So a couple of months in, that card is already months away.' },
      // The card fades into the outline of a person, and stays there as a small steady light.
      { id: 'c5-15', text: 'By then you are not really reviewing it any more. It is part of what you know. It is part of who you are.' },
      // Wooden boxes of paper slips; the name "Niklas Luhmann", "1951 to 1996", "about 90,000 cards".
      // SOURCE: Niklas Luhmann-Archiv, Bielefeld University: about 90,000 notes, made between 1951 and 1996. (rename-note-to-page: keep)
      { id: 'c5-06', text: 'The sociologist Niklas Luhmann kept a box of paper slips for about 45 years. It grew to around 90,000 of them.' },
      // A shelf of his books fills in: "nearly 600 publications", "over 40 books".
      // SOURCE: Niklas Luhmann-Archiv, Bielefeld University: nearly 600 publications, among them over 40 monographs.
      { id: 'c5-07', text: 'He wrote nearly 600 publications, among them more than 40 books.' },
      // Long boxes of 4 by 6 index cards; the name "Ryan Holiday".
      // SOURCE: Ryan Holiday, YouTube video UBdlprawTkA (his card system): tens of thousands of cards, over 20 years.
      { id: 'c5-08', text: 'The writer Ryan Holiday has kept tens of thousands of index cards over twenty years. He says the most value came later, from all of them added up.' },
      // Three small scenes: a meeting, a page in another language, a field that becomes clear.
      { id: 'c5-09', text: 'You do not need to write books. Think of the meeting where the right fact is there when you need it.' },
      // A page in another language becomes readable; a hard subject comes into focus.
      { id: 'c5-10', text: 'The language you keep. The subject you finally understand.' },
      // The card base, now large, glows: "Your card base".
      { id: 'c5-11', text: 'Over time, your card base becomes a record of what you know. Because you review it, you still know it.' },
      // One card, held in a hand; "Yours".
      { id: 'c5-12', text: 'Small cards, every day, add up. But only if they are truly yours: that is next.' },
    ],
  },
  {
    id: 'knowledge-base',
    title: 'Your card base is your knowledge base',
    clips: [
      // The large card base from chapter 5.
      { id: 'c6-01', text: 'Your cards add up, and what you know compounds. So what should go into them?' },
      // The card base, and a head in profile; the two match.
      { id: 'c6-02', text: 'Your card base is your knowledge base. It is a picture of what you know.' },
      // An endless scroll of web pages pours past; a tiny card base under it.
      { id: 'c6-03', text: 'The goal is not to copy the internet into it. There is always more.' },
      // A page of text boils down to two short cards in plain words.
      { id: 'c6-04', text: 'The goal is to distil. Take what you learned, and put it in your own words and your own formats.' },
      // A simple picture of digestion: food in, a smaller, useful part kept.
      { id: 'c6-05', text: 'Think of it like digestion. You do not have to know a thing fully before you make its card.' },
      // The useful part is kept; the rest passes.
      { id: 'c6-06', text: 'But you do have to digest it first.' },
      // A person thinks over an idea, then says it in one simple line.
      { id: 'c6-07', text: 'To digest is to think it through, until you can say it simply.' },
      // A shallow glance versus a deep look; the deep one leaves a lasting mark.
      // SOURCE: Craik & Lockhart 1972, "Levels of processing: A framework for memory research", Journal of Verbal Learning and Verbal Behavior.
      { id: 'c6-08', text: 'Memory researchers call this depth of processing. It is one of the most cited ideas in the science of memory: the more you think about what something means, the longer you keep it.' },
      // Someone else's deck is copied in; the cards stay grey.
      { id: 'c6-09', text: "That is why copying someone else's cards makes no sense: it skips the thinking that makes you learn." },
      // A phone note: a quick line written down while someone talks. (rename-note-to-page: keep)
      { id: 'c6-10', text: 'So when you hear something worth keeping, write it down somewhere.' },
      // A rushed, messy card is made on the spot; it gets a red mark.
      { id: 'c6-11', text: 'Do not make the card in that moment. Rushed cards are poor cards, they pile up, and review becomes a chore.' },
      // Later, at a quiet desk: the note becomes a clean card. (rename-note-to-page: keep)
      { id: 'c6-12', text: 'Make the card later, when you have time to sit and think. Capture first, make later.' },
      // The new-card line: "New cards · 60 waiting", ten a day; a week of days ticks past.
      { id: 'c6-13', text: 'With ten new cards a day and sixty waiting, a new card can take about a week to reach you.' },
      // The card arrives in the Inbox; it looks familiar, like a friend.
      { id: 'c6-14', text: 'When it comes, it is no surprise. You made it, you digested it, and you have been looking forward to it.' },
      // A mental map of the card base, with the cards in their places.
      { id: 'c6-15', text: 'You carry a picture of your card base in your head, because you put each card there.' },
      // The card base and the head in profile, matching; then a clean card next to a messy one.
      { id: 'c6-16', text: 'Your card base is your knowledge base: make it yours. Next: how to make a card you will be glad to see again.' },
    ],
  },
  {
    id: 'good-card',
    title: 'What makes a good card',
    clips: [
      // A digested idea, and an empty card beside it.
      { id: 'c7-01', text: 'You have digested an idea. Here is how to make its card a good one.' },
      // A long page of text is pasted into one card; the card bulges.
      { id: 'c7-02', text: 'Many people paste a whole page of text into one card. Then they review it, and nothing sticks.' },
      // The wall of text, with a question mark over it.
      { id: 'c7-03', text: 'A wall of text is not a card. It asks you to recall everything at once, so you recall nothing well.' },
      // The other extreme: a card with one bare line and an empty back.
      { id: 'c7-20', text: 'A single bare line is the other extreme. You may recall the words, and still not understand the idea.' },
      // One sentence in the wall lights up.
      { id: 'c7-04', text: 'So before you make a card, ask one question. What is the short version of this idea?' },
      // The lit sentence moves to a card's front and gets a blank; the rest of the page sorts itself into sections on the back.
      { id: 'c7-21', text: 'That goes on the front, with the key part hidden. The details go on the back, in sections.' },
      // The real card of chapter 2 in the Inbox: the blank on the front fills in; then the back shows, section by section.
      { id: 'c7-22', text: 'So a review is quick: you fill in the front. Then the back gives you the details again.' },
      // One card alone, with an umbrella drawn over it: "Protein, carbs and fat".
      { id: 'c7-05', text: 'Now, how cards grow. Start with an umbrella: one card that covers a whole topic.' },
      // The real card of chapter 2 again: "Protein, carbs and fat", light, three short lines on its back.
      { id: 'c7-06', text: 'Say, how protein, carbs and fat differ. One light card is enough to start.' },
      // Lines about protein pile up on the umbrella card's back until they no longer fit; they lift off into a new card, "Protein".
      { id: 'c7-07', text: 'As you learn more about protein, it outgrows that card. So protein gets a card of its own.' },
      // A line joins the two cards, with a pill at each end; the umbrella card keeps one line about protein.
      { id: 'c7-18', text: 'The two link to each other. The umbrella stays the overview, and protein becomes a branch.' },
      // More branches: "Carbs", then "Fibre" from it. A small tree, the umbrella at its root. The words "Node: a point where branches meet".
      { id: 'c7-23', text: 'Over time you get a tree: the umbrella, its branches, and smaller branches from those. Each card is a node, a point where branches meet.' },
      // The tree with only two cards on day one; more appear as a calendar runs.
      // Yaseen's own wording, from the doc (YAS-2084).
      { id: 'c7-19', text: 'The tree grows as your understanding grows. So start light, and do not feel like you have to build the whole tree on day one.' },
      // An old paper flashcard: "What does DNS stand for?" on one side, "Domain Name System" on the other.
      { id: 'c7-24', text: 'Now, the front itself. Most people think a card is a question on one side, and the answer on the other.' },
      // The question card stays; beside it, a sentence card: "DNS stands for {{Domain Name System}}." Both get a tick.
      { id: 'c7-25', text: 'You can ask a question. Or you can just write the idea as a sentence, and hide the key part.' },
      // The words "cloze deletion" over the blank, in small type; then the app's own words: "hidden word".
      // SOURCE: Taylor 1953, "Cloze procedure: A new tool for measuring readability", Journalism Quarterly 30 (the origin of the word "cloze").
      { id: 'c7-26', text: 'Memory scientists call that cloze deletion. In this app, we just call them hidden words.' },
      // "DNS stands for" and a blank; the blank fills in: "Domain Name System".
      { id: 'c7-27', text: '"DNS stands for", then a blank. You jump straight in and fill it. It is faster to make, and faster to review.' },
      // The DNS card grows a first line above it, an example, in the shape of Yaseen's cards:
      //   "When you type a website's name, {{DNS}} finds the number your computer needs."
      //   "DNS stands for {{Domain Name System}}."
      // Its back: the details of DNS, in sections.
      { id: 'c7-28', text: 'An example on the front helps too. With your agent, one is easy to get.' },
      // Card A: "{{DNS}} stands for {{Domain Name System}}." Card B: "DNS stands for {{Domain Name System}}." WAITS: the person picks one.
      { id: 'c7-08', text: 'Your turn. Which of these two cards is better?' },
      // Card B gets the check; card A is all blanks.
      { id: 'c7-09', text: 'The second one. The first card hides everything that matters, so there is no clue to recall from.' },
      // Rule 1 as a title; card B's front shows, the answer hidden.
      { id: 'c7-10', text: 'So, rule one. Hide the answer, not the clue. The front must still make sense with the blank in it.' },
      // A report card with ten rows, the ten ways to learn; "Re-reading" and "Highlighting" get the lowest grade.
      // SOURCE: Dunlosky, Rawson, Marsh, Nathan & Willingham 2013, "Improving students' learning with effective learning techniques", Psychological Science in the Public Interest 14(1): ten techniques; rereading and highlighting rated low utility.
      { id: 'c7-11', text: 'Reading is not recalling. Researchers graded ten of the most common ways to learn. Re-reading and highlighting got the lowest grade.' },
      // Two rows light up with the top grade: "Testing yourself", "Spacing it out"; a card sits on both.
      // SOURCE: the same review: practice testing and distributed practice rated high utility.
      { id: 'c7-29', text: 'Only two got the top grade: testing yourself, and spacing it out over time. A card does both.' },
      // Rule 2; "{{It}} is a system." with a question mark, then "DNS stands for {{Domain Name System}}." with a tick.
      { id: 'c7-12', text: 'Rule two. Leave enough in view to point to one answer. A blank that could be many things teaches you nothing.' },
      // Rule 3; a sentence with three scattered blanks, then one blank over a whole phrase.
      { id: 'c7-13', text: 'Rule three. Hide a phrase that means something, not a few scattered words.' },
      // The answer shows; the person's own words differ, and still get the check.
      { id: 'c7-14', text: 'When you check yourself, the same meaning in other words counts. Exact words matter only for quotes and commands.' },
      // A title changes from "From the podcast, part 3" to the name of the idea.
      { id: 'c7-15', text: 'Name each card after the idea, not after where you found it.' },
      // Four small cards: a word, a person, a process, a quote; then the card skill's Formats folder.
      { id: 'c7-16', text: 'Different things need different formats: a word, a person, a process, a quote. Each has a short page in the card skill.' },
      // The small tree of cards; then a terminal window with an agent in it.
      { id: 'c7-17', text: 'The short version on the front, the details on the back, and a tree that grows with you. Next, a tool that can help, and hurt.' },
    ],
  },
  {
    id: 'ai',
    title: 'Make cards with your AI, without vibe writing',
    clips: [
      // A terminal window with an agent in it, next to the app.
      { id: 'c8-01', text: 'A good card starts with digestion. Now, a tool that makes cards fast, and why that is a danger.' },
      // A card file opens as plain text: the title line, the fact, the hidden word in marks; the word "Markdown".
      { id: 'c8-02', text: 'One fact matters here: each card is a plain Markdown file, plain text with a few light marks.' },
      // The agent's window reads a card file.
      { id: 'c8-03', text: 'An agent is an AI tool that can read and write files on your computer. Any agent like that works here.' },
      // The app with a line through a cloud: no AI inside, nothing sent.
      { id: 'c8-04', text: 'The app has no AI inside, and it sends nothing anywhere. You use your own agent.' },
      // The screen goes quiet; one line: "Do not vibe write your cards."
      { id: 'c8-05', text: 'Now the warning. Do not vibe write your cards.' },
      // An agent pours out card after card; nobody reads them.
      { id: 'c8-06', text: 'Vibe writing means letting an AI pour out cards you never thought through.' },
      // The card base floods with grey cards; the Inbox row dims, then goes dark.
      { id: 'c8-07', text: 'It is the fastest way to ruin your card base, which is your knowledge base, and to make the whole system worthless.' },
      // Two paths: "Vibe write" leads down; "Digest, then make" leads up.
      { id: 'c8-08', text: 'If you want this system to fail, vibe write your cards. If you want what you know to compound, do not.' },
      // The name "Ryan Holiday" and his line, in quotes.
      // SOURCE: Ryan Holiday, YouTube video UBdlprawTkA, on taking notes by hand: "The inefficiency is the efficiency." (rename-note-to-page: keep)
      { id: 'c8-09', text: 'Ryan Holiday puts it this way: "The inefficiency is the efficiency." The thinking is where you learn.' },
      // Digested ideas go into the agent; well-made cards come out; a person reads them.
      { id: 'c8-10', text: 'The right way: bring ideas you have already digested. The agent shapes them into cards, and you read each one.' },
      // A text box with "Use the example" under it. WAITS: the person pastes text or picks the example.
      { id: 'c8-11', text: "Let's try it. Paste something you have digested, or use the example." },
      // The prompt with a Copy button; its lines light up: the skill, three cards, Course Cards. WAITS: the person clicks Copy.
      { id: 'c8-12', text: 'Copy the prompt. It tells your agent to read the card skill, then make three cards in Course Cards.' },
      // The agent's window; a paste; card files appear in the course, one by one. WAITS: the agent writes card files in Course Cards.
      { id: 'c8-13', text: 'Paste it into your agent. The cards show up here as it writes them.' },
      // The quiet line "No new cards yet. Did you check with your agent?"
      { id: 'c8-14', text: 'If nothing shows up after a minute, check with your agent.' },
      // The three new cards open one by one; the person reads each; "Read" ticks beside it. The word "Handmade". (The card check was removed, YAZ-5060.)
      { id: 'c8-15', text: 'Now read each one. That is the handmade part: nothing stays that you have not read.' },
      // Skip, then three ready example cards with "Make these cards".
      { id: 'c8-16', text: 'No agent? Skip this step. The course shows three example cards, and makes them only if you say so.' },
      // A person reads a card, rewrites a line, and deletes another card.
      { id: 'c8-17', text: 'Your agent drafts fast, but you decide. Keep only what you want to recall, in your own words.' },
      // The card skill's right-click menu: "Copy prompt for your agent".
      { id: 'c8-18', text: 'To copy the prompt later, right-click the card skill, and choose Copy prompt for your agent.' },
      // The loop: you digest, the agent shapes, you decide; then three icons: a pen, the Inbox, shears.
      { id: 'c8-19', text: 'You digest and decide; your agent only shapes. Next: the three habits that keep it all alive.' },
    ],
  },
  {
    id: 'habits',
    title: 'Three habits: make, review, tend',
    clips: [
      // The pen icon: cards by hand and with the agent.
      { id: 'c9-01', text: "Let's step back and see the whole system." },
      // Three icons in a row: a pen "Make", the Inbox "Review", shears "Tend".
      { id: 'c9-02', text: 'It has three habits: making cards, reviewing cards, and tending cards. Tending means fixing and improving the cards you have.' },
      // The Inbox icon lights up; a sunrise.
      { id: 'c9-03', text: 'Reviewing is the daily one. You open the Inbox, and the app picks the cards.' },
      // A person with a thought bubble: "I am sure that worked"; a gauge beside it reads the opposite.
      { id: 'c9-04', text: 'Trust the schedule, even when it feels slow. Your gut is a poor judge of your own memory.' },
      // Ten figures: nine light up, "Spacing won"; then seven of the ten hold a sign, "I think it lost".
      // SOURCE: Kornell 2009, "Optimising learning using flashcards: Spacing is more effective than cramming", Applied Cognitive Psychology 23: spacing was more effective for 90% of participants; 72% believed the opposite.
      { id: 'c9-05', text: 'In one experiment, spacing won for nine people out of ten. Yet seven out of ten walked away sure it had lost.' },
      // The Science paper again; a highlighted line: everyone predicted "about 50%"; the real bars: 80% and 36%.
      // SOURCE: Karpicke & Roediger 2008, Science 319: in all four conditions people predicted they would recall about 50% of the pairs; actual recall was about 80% or about a third.
      { id: 'c9-11', text: 'In the Science study, everyone guessed they would remember about half. Some kept 80 percent. Some kept a third. Nobody saw it coming.' },
      // The shears icon lights up, inside the Inbox: a card with a small fix.
      { id: 'c9-06', text: 'Tending needs no time of its own. It happens while you review.' },
      // Thought bubbles over a card, "Not clear", "Needs a link"; a short message goes to the agent; the review goes on.
      { id: 'c9-07', text: 'This card is not clear. That one needs a link. With an agent, you send the fix right then, and keep going.' },
      // A clock face: a short arc for review and tending.
      { id: 'c9-08', text: 'Even with a large card base, review and tending together can fit in fifteen to twenty minutes a day.' },
      // The pen icon lights up; a quiet desk.
      { id: 'c9-09', text: 'Making is the one you set time aside for. Digesting takes thought, so give it a quiet moment.' },
      // The three icons with their times; then two cards with a line between them.
      { id: 'c9-10', text: 'Make with time set aside. Review every day. Tend as you review. Next: the idea that changes how you organise everything.' },
    ],
  },
  {
    id: 'links',
    title: 'Links: how cards connect',
    clips: [
      // The three habit icons; then two cards, a thin line drawn between them.
      { id: 'c10-01', text: 'Quick recap: you make, review and tend your cards. Now, how they connect, and why that beats folders.' },
      // A computer's folders: one file goes into one folder, and the folder closes.
      { id: 'c10-02', text: 'Most of us keep things in files and folders. Computers taught us: one thing, one place.' },
      // A new card hovers over three folders; a question mark: "Where does this go?"
      { id: 'c10-03', text: 'So when you make a card, you ask: where does this go?' },
      // All the cards fall into one open box, "Cards"; nothing is sorted.
      { id: 'c10-04', text: 'Cards do not need that. They can all live in one place, or one folder at most.' },
      // A line goes from one card to another; the words "Link: points to another card"; the protein card of chapter 7 and its line back to the umbrella.
      { id: 'c10-05', text: 'Links hold them together. You have seen one: the protein card, linked to its umbrella.' },
      // A head in profile; inside it, ideas as dots with lines between them, not boxes.
      { id: 'c10-06', text: 'Your mind does not work like folders. It works by association: one idea calls up another.' },
      // One dot lights up; the light spreads along its lines to the dots linked to it.
      // SOURCE: Collins & Loftus 1975, "A spreading-activation theory of semantic processing", Psychological Review 82(6): memory as a network of linked concepts; activation spreads from one to the ones linked to it (priming).
      { id: 'c10-07', text: 'Researchers describe memory as a web of linked ideas. Think of one, and the ones linked to it come to mind more easily.' },
      // A new dot joins the web where it fits, next to dots already there; it stays lit.
      // SOURCE: van Kesteren, Ruiter, Fernández & Henson 2012, "How schema and novelty augment memory formation", Trends in Neurosciences 35(4); Brod, Werkle-Bergner & Shing 2013, "The influence of prior knowledge on memory", Frontiers in Behavioral Neuroscience 7.
      { id: 'c10-08', text: 'And researchers found that new facts are usually remembered better when they fit with something you already know.' },
      // The food tree of chapter 7 on the left; a second small tree on the right, "Exercise". A dotted line wants to cross between them.
      { id: 'c10-23', text: 'A tree has branches. But ideas also connect across trees, and a folder cannot show that.' },
      // The card "Protein" goes into a folder "Food".
      { id: 'c10-09', text: 'An easy example. Your protein card sits in a folder called Food.' },
      // A card "How muscle grows" goes into a folder "Exercise".
      { id: 'c10-10', text: 'Your card on how muscle grows sits in Exercise.' },
      // An arm lifts a weight; small protein blocks move into the muscle.
      { id: 'c10-11', text: 'They belong together: your body builds muscle out of protein.' },
      // The two folders stay shut, each card inside its own; then a line runs from the protein card straight to the muscle card.
      { id: 'c10-12', text: 'Each card has one folder, so the folders keep them apart. A link joins them.' },
      // Two questions side by side: "Folders: where does this go?" and "Links: what does this connect to?"
      { id: 'c10-13', text: 'Folders ask: where does this go? Links ask: what does this connect to?' },
      // A card links to a card file, a card in a page, and a page.
      // APP: docs/CONTRACTS.md "Links to a card" (YAZ-5030); client/src/links/completion.ts (`cardLinkCandidates`: cards in files and in pages, after the pages).
      { id: 'c10-14', text: 'A card can link to any card, wherever it lives, and to any page.' },
      // The agent's window: "These two cards connect: Protein and How muscle grows. Add the link?"
      { id: 'c10-26', text: 'The easy way: ask your agent to find the connections.' },
      // The agent shows the link and its reason in the chat; the person reads it and says yes; only then does the card change. The word "Handmade".
      { id: 'c10-27', text: 'Keep it handmade: the agent shows you each one in the chat, and you read it and approve it.' },
      // After the pill, a few grey words: "muscle is built from protein". The pill and its reason sit on one line.
      { id: 'c10-24', text: 'Beside each link go a few words on why the two connect. The reason is worth as much as the link.' },
      // Edit card on the protein card; the caret at the end of a line; "[[" and "mus" are typed; the list opens.
      // APP: client/src/editor/card/cardEditorFeatures.ts (pills and the `[[` picker are on in Edit card), client/src/editor/wikilink/wikilinkPicker.ts.
      { id: 'c10-15', text: "To link by hand, edit the card. Type two square brackets, then a few letters of the other card's title." },
      // The list: pages, then cards with the card icon; the card row is clicked.
      // APP: client/src/links/completion.ts (card rows have the card icon and insert `[[ID]]`). Not on this branch: YAZ-5134's fix (2e1182e51), so a card file shows two rows here until it merges.
      { id: 'c10-16', text: 'A list shows what matches. Click the one with the card icon.' },
      // `[[DEMO-12]]` turns into a pill: the card icon, "How muscle grows", and the ID small and grey.
      // APP: docs/CONTRACTS.md "Links to a card": the pill shows the title, then the ID small and grey, with the card icon (`wikilink--card`).
      { id: 'c10-17', text: "The link turns into a pill: the other card's title, with its ID small beside it." },
      // A click on the pill; the muscle card opens in the card window; under it, "Linked mentions (1)" lists the protein card.
      // APP: client/src/editor/createCrepe.ts (a card pill's plain click opens the card window), client/src/review/cardPane.tsx ("Linked mentions (n)"), shared/cardLinks.ts (`cardBacklinks`), shared/fences.ts (a card's text counts).
      { id: 'c10-18', text: 'Click the pill, and that card opens. Under it, Linked mentions lists what links to it.' },
      // One card with many lines coming in to it, "Linked mentions (12)"; it glows as a hub, like the dot of chapter 2.
      { id: 'c10-25', text: 'Some cards end up with many links pointing to them. Those are your hubs: the ideas the rest leans on.' },
      // In Edit card, the caret after the pill; Backspace; the pill goes.
      // APP: client/src/editor/wikilink/idLinkCaret.ts (Backspace removes the whole link), client/src/editor/linkMenu.ts ("Remove link" on a right-click).
      { id: 'c10-19', text: 'To remove a link, edit the card, and delete the pill like a word.' },
      // A loose pile of cards; lines join them one by one, until it is one connected web.
      { id: 'c10-20', text: 'Your card base is your knowledge base. Links make it a base, not a pile.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c10-21', text: 'To link two of your Course Cards, choose Try it in the app.' },
      // The protein card and the muscle card with their line; then the garden from chapter 9.
      { id: 'c10-22', text: 'Ask what a card connects to, not where it goes. Next: how to keep your tree alive.' },
    ],
    tryIt: [
      { target: 'sidebar-course-cards', say: 'Open the Course Cards folder, and click one of your cards.', done: { event: 'card-file-open' } },
      { target: 'card-edit', say: 'Click Edit card, or press E.', done: { event: 'card-edit-open' } },
      { target: 'card-editor', say: "At the end of a line, type two square brackets. Then a few letters of another card's title.", done: { event: 'link-picker-open' } },
      { target: 'link-picker', say: 'Click the row with the card icon.', done: { event: 'card-link-added' } },
      { target: 'card-done', say: 'Press Escape, or click Done. The link is now a pill.', done: { event: 'card-edit-done' } },
      { target: 'card-link-pill', say: 'Click the pill. The other card opens, and Linked mentions lists your first card.', done: 'click' },
    ],
  },
  {
    id: 'care',
    title: 'Be a gardener',
    clips: [
      // The trees of cards with their links; then the Inbox with a card, and the shears icon from chapter 9.
      { id: 'c11-01', text: 'Your cards form trees, joined by links. Now, how to tend them as you review.' },
      // A garden: a gardener clears weeds and prunes a branch; the garden fills out.
      { id: 'c11-02', text: 'Think of a gardener. A garden does well when someone clears it and prunes it.' },
      // A card is reworded; a small glow over it.
      { id: 'c11-03', text: 'That is not a chore. Each fix makes you think about the idea again, and that is learning too.' },
      // A card that keeps turning red; a magnifying glass over its wording.
      // v3: "or two cards in one" became "or it asks too much at once" (chapter 7 no longer teaches splitting).
      { id: 'c11-04', text: 'A card you keep missing is a sign to look at it. Often it is unclear, or it asks too much at once.' },
      // A short message to the agent: "Make this card's clue clearer"; the card file changes.
      { id: 'c11-06', text: 'To fix a card, tell your agent what to change, and keep reviewing. Each card is a file, so it can.' },
      // Edit card on a card; then E in the Inbox.
      { id: 'c11-05', text: 'Or do it yourself: click Edit card, or press E in the Inbox. Press Escape when you are done.' },
      // A clock; an agent's window wakes on its own each morning and reads the card base. Not the app: the person's own agent tool.
      { id: 'c11-15', text: 'Some agent tools can run by themselves at set times: a scheduled agent.' },
      // The agent writes a short list: "Make this clue clearer", "Link Protein to How muscle grows". Nothing in the card base changes.
      { id: 'c11-16', text: 'It can read your card base, and propose fixes, or new links.' },
      // The person reads the list, approves one change, and skips another. Only the approved one lands.
      { id: 'c11-17', text: 'But you approve each change by hand. An agent never changes your card base on its own.' },
      // A branch is cut; the plant looks better for it.
      { id: 'c11-07', text: 'Some cards no longer earn their place. Pruning is part of it.' },
      // The card's ⋯ menu, "Archive card"; the card turns muted.
      { id: 'c11-08', text: 'To stop reviewing a card, open its menu and choose Archive card. It keeps its history.' },
      // The Inbox's All cards menu, the Archived row, and Unarchive.
      { id: 'c11-09', text: 'Archived cards are at the bottom of the All cards menu, in the Inbox. Unarchive brings one back.' },
      // A card's back has grown long on one part; that part lifts off into its own card, and a line joins the two.
      { id: 'c11-20', text: 'Growing is tending too. When one part of a card keeps growing, give it its own card, and link the two.' },
      // Two cards side by side; a line is drawn between them.
      { id: 'c11-18', text: 'Tend the links as well. When you notice two cards belong together, link them.' },
      // A link between two cards that no longer fit is cut, as a branch is.
      { id: 'c11-19', text: 'When a link no longer helps, delete it like a word.' },
      // ⋯ › Put at top of Inbox; the chip "Up next".
      { id: 'c11-10', text: 'To see a card first, choose Put at top of Inbox. It gets the Up next mark until you answer it.' },
      // Reviews under a card opens: each answer with its bin; then ⋯ › Reset history, and the card shows New.
      // APP: client/src/review/cardParts.tsx (the table's delete, on the card tab and the card window; not in the Inbox), client/src/review/cardPane.tsx ("Reset history").
      { id: 'c11-11', text: 'Each card keeps its review history. You can delete one wrong answer, or choose Reset history to start fresh.' },
      // The All cards menu: the row "New cards 10 / 48"; a click on the count turns it into "Add [10] more new cards"; Enter.
      // APP: client/src/review/CardInboxBar.tsx, client/src/review/AddMoreField.tsx (YAZ-5042 round 2). v3: there is no plain "Add" button in the menu now.
      { id: 'c11-12', text: 'Want more new cards today? Click their count in the All cards menu, and press Enter.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c11-13', text: 'To try Archive and Up next on your own card, choose Try it in the app.' },
      // The garden, full and tidy; then a calendar page for the week ahead.
      { id: 'c11-14', text: 'Grow a branch here, prune one there, and your card base stays true. Next: your first week.' },
    ],
    tryIt: [
      { target: 'card-menu', say: 'Open the menu of one of your Course Cards.', done: 'click' },
      { target: 'card-menu-archive', say: 'Choose Archive card.', done: 'click' },
      { target: 'sidebar-inbox', say: 'Now open the Inbox.', done: 'click' },
      { target: 'inbox-filter', say: 'Open the All cards menu. Your card is in the Archived list.', done: 'click' },
      { target: 'inbox-unarchive', say: 'Click Unarchive to bring it back.', done: 'click' },
      { target: 'card-menu', say: "Open the card's menu once more.", done: 'click' },
      { target: 'card-menu-up-next', say: 'Choose Put at top of Inbox. Next time you open the Inbox, it comes first.', done: 'click' },
    ],
  },
  {
    id: 'where-things-are',
    title: 'Where things are, and your first week',
    clips: [
      // The three habit icons, then the real sidebar.
      { id: 'c12-01', text: 'To finish: where things are, and your first week.' },
      // The real sidebar; the card skill's row at the bottom lights up.
      { id: 'c12-02', text: 'The card skill is at the bottom of the sidebar.' },
      // The card skill opens: Start here, the rules, Formats, Course transcript.
      { id: 'c12-03', text: 'It is a short guide for you and your agent: the rules, the formats with examples, and the words of this course.' },
      // The lock on the skill; right-click › "Duplicate into …".
      { id: 'c12-04', text: 'It is read only. To change it, duplicate it into your vault, and make it your own.' },
      // The duplicate in the vault; an update arrow on the built-in skill.
      { id: 'c12-05', text: 'Your copy syncs with your vault. The built-in skill still gets each update of the app.' },
      // A terminal: `yaseendocs card guide` prints the skill's first page.
      { id: 'c12-06', text: 'Your agent can find it too. One command prints its first page.' },
      // Settings › Review: "Card skill in the sidebar" and "Open the course".
      { id: 'c12-07', text: 'In Settings, under Review, one switch shows or hides the card skill. Open the course brings you back here.' },
      // A week of seven days appears.
      { id: 'c12-08', text: 'Now, your first week.' },
      // Day 1: one card, made from something the person already understands.
      { id: 'c12-09', text: 'Today, make one card, from something you already understand well.' },
      // Each day ticks: the Inbox row lights up.
      { id: 'c12-10', text: 'Each day, open the Inbox, and answer what is due.' },
      // A capture note fills during the week; on one day, a desk and a few new cards. (rename-note-to-page: keep)
      { id: 'c12-11', text: 'Keep one place to capture things as you hear them. Once this week, set time aside to make a few cards from it.' },
      // A new card; a line from it to a card already there.
      { id: 'c12-16', text: 'For each new card, ask what it connects to, and link it.' },
      // In the Inbox, a small fix to a card.
      { id: 'c12-12', text: 'As you review, fix what is unclear. That is tending, and it is how your card base stays yours.' },
      // A small seedling in fresh soil.
      // A common saying, not a study. Ryan Holiday uses it in video UBdlprawTkA; the name is left out, because the saying is not his.
      { id: 'c12-13', text: 'The best time to start was years ago. The second best time is now.' },
      // One new card, then a calendar page turns to tomorrow and the Inbox lights up.
      { id: 'c12-14', text: "That's the whole course. Make one card today. Open the Inbox tomorrow." },
      // The course's end screen: cards made, and when they come back.
      { id: 'c12-15', text: 'Your card base is your knowledge base. Build it one card at a time, and what you learn becomes part of who you are.' },
    ],
    tryIt: [
      { target: 'card-skill-row', say: 'This is the card skill. Click it to open it.', done: 'click' },
      { target: 'settings-review', say: 'Now press Command comma to open Settings, and click Review.', done: 'click' },
      { target: 'settings-card-skill', say: 'This switch shows or hides the card skill in the sidebar.', done: { event: 'tour-next' } },
      { target: 'settings-course', say: 'And this button brings you back to the course, at any time.', done: { event: 'tour-next' } },
    ],
  },
]
