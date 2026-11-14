/**
 * The card course's words, version 2 (YAZ-5147; version 1 was YAZ-5119, issue 6A of YAZ-5118). Each clip is one or two
 * spoken sentences, and it is also the caption. The comment above each clip says what the scene shows (issue 6C) and,
 * after "WAITS:", where the person acts. "SOURCE:" names the study or page behind a fact (the comment "Sources (agent)"
 * on YAZ-5147 has the links).
 *
 * Chapter 1 keeps two clips of the approved sample with their ids and words (`s2b`, `s3a`). Yaseen rewrote the rest of
 * its opening, so those clips have new ids. Chapters 3 and 4 keep version 1's approved lines; only the opening recap,
 * the closing lines and one fact are new there.
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
      { id: 'c1-02', text: 'In the 1880s, Hermann Ebbinghaus measured this on himself, with lists of made-up syllables.' },
      // The curve at "1 day"; a bar shows two thirds of the first effort, needed again.
      // SOURCE: Murre & Dros 2015, Table 3: Ebbinghaus's savings after 1 day = 0.337, so relearning took about 66% of the first effort.
      { id: 'c1-03', text: 'After just one day, learning a list again took him about two thirds of the time it took at first.' },
      // A review just before the curve drops; the curve lifts and falls slower.
      { id: 'c1-04', text: 'But review it again before you forget, and it sticks longer.' },
      // Three reviews; the gaps label "1 day", "1 week", "1 month" on the marks. (Approved sample, unchanged.)
      { id: 's2b', text: 'Each time, the gap grows. A day. A week. A month.', marks: [0.439, 0.597, 0.74] },
      // A small glowing memory, faint at first, grows solid over time.
      // SOURCE: Squire, Genzel, Wixted & Morris 2015, "Memory Consolidation", Cold Spring Harb Perspect Biol.
      { id: 'c1-05', text: 'A new memory starts out fragile. Over time, the brain makes it stable. Scientists call this consolidation.' },
      // Each review mark pushes the memory deeper, from a "Short-term" band into a "Long-term" band.
      { id: 'c1-06', text: 'Each review, near the point where you would forget, pushes the memory further into long-term memory.' },
      // The words "Spaced repetition" settle under the curve. (Approved sample, unchanged.)
      { id: 's3a', text: "That's all spaced repetition is." },
      // A wall of small study tiles fills in, "317 experiments"; spaced study beats crammed study.
      // SOURCE: Cepeda, Pashler, Vul, Wixted & Rohrer 2006, "Distributed practice in verbal recall tasks", Psychological Bulletin: 317 experiments in 184 articles.
      { id: 'c1-07', text: 'It is one of the most tested ideas about memory. One review of 317 experiments found that spaced study beats cramming.' },
      // A paper index card drops onto the stage.
      { id: 'c1-08', text: 'So where does each thing you learn go? Picture a paper index card, the kind people study with.' },
      // The paper index card becomes the app's real card: a title, a fact, one word as a blank.
      { id: 'c1-09', text: 'That is a card: one small fact, with part of it hidden.' },
      // Many cards fan out across the stage, each with one fact.
      { id: 'c1-10', text: 'You will have many cards, one for each thing you want to keep.' },
      // A calendar; each card takes its own date.
      { id: 'c1-11', text: 'The app keeps a calendar for every card. On the day a card is due, it shows it to you.' },
      // The blank fills in; two buttons, Forgot and Remembered.
      { id: 'c1-12', text: 'You try to recall the hidden part, then check. And you answer: forgot, or remembered.' },
      // A card's curve with a dotted line at 90%; the next date lands where the curve meets the line.
      // SOURCE: shared/cardSchedule.ts (FSRS through ts-fsrs 5.4.2); shared/reviews.ts DEFAULT_REVIEW_SETTINGS.retention = 0.9.
      { id: 'c1-13', text: 'The app sets each date with an open scheduling method called FSRS. It brings a card back when your chance of recalling it drops to about ninety percent.' },
      // The chapter list lights up, 1 to 11.
      { id: 'c1-14', text: 'This course takes about twenty-five minutes, in eleven short chapters.' },
      // The "Try it in the app" button, with "Optional" beside it.
      { id: 'c1-15', text: 'Some chapters let you try the steps in the real app. That part is always your choice.' },
      // The curve with its growing gaps, as a small picture to keep.
      { id: 'c1-16', text: 'If you remember one thing, make it this. Review just before you forget, and each memory lasts longer.' },
      // The paper index card again, alone in the middle of the stage.
      { id: 'c1-17', text: 'Next: why a card is the right shape for what you learn. And you make your first one.' },
    ],
  },
  {
    id: 'first-card',
    title: 'The card: one small fact',
    clips: [
      // The paper index card from chapter 1, and the calendar behind it.
      { id: 'c2-01', text: 'Quick recap. Each thing you want to learn goes on a card, and the app brings it back on time.' },
      // The card turns, as if to be looked at closely.
      { id: 'c2-02', text: 'Now, why a card is small, and how to make one.' },
      // The word "Atomic" over one small card.
      { id: 'c2-03', text: 'A good card is atomic. That means it holds one small idea, and nothing else.' },
      // Small cards slide together in new groups, like pieces that fit many ways.
      { id: 'c2-04', text: 'Small pieces can be mixed and matched, wherever you need them.' },
      // The name "Piotr Wozniak" and "1999"; one big card splits into three small ones.
      // SOURCE: Wozniak 1999, "Effective learning: Twenty rules of formulating knowledge", rule 4, the minimum information principle (supermemo.com).
      { id: 'c2-05', text: 'Piotr Wozniak, who built the program SuperMemo, made this a rule: keep each card as simple as you can.' },
      // The three small cards each get their own date; the hard one comes back more often.
      // SOURCE: Wozniak 1999, rule 4: simple items are easier to remember and easier to schedule.
      { id: 'c2-06', text: 'A simple card is easier to remember. And a hard part on its own card gets the reviews it needs.' },
      // All the cards together form one growing set, labelled "Card base".
      { id: 'c2-07', text: 'All your cards together are your card base. It grows one small piece at a time.' },
      // A blank card in the middle of the stage.
      { id: 'c2-08', text: 'So a good card holds one small fact. Think of something you learned this week.' },
      // An empty card with a blinking caret. WAITS: the person types a fact.
      { id: 'c2-09', text: 'Type one thing you want to remember. One short sentence is best.' },
      // The fact's words become buttons. WAITS: the person taps the word to hide.
      { id: 'c2-10', text: 'Now tap the word you want to hide.' },
      // The word turns into a blank; the card takes its frame.
      { id: 'c2-11', text: "That's a card. The hidden word is the part you will try to recall." },
      // The card, front only. WAITS: the person taps the card to show the word.
      { id: 'c2-12', text: 'Tap it to check yourself.' },
      // Forgot and Remembered under the card. WAITS: the person picks one.
      { id: 'c2-13', text: 'Did you remember it?' },
      // The answer's quiet line under the card.
      { id: 'c2-14', text: 'Either answer is fine. The app saves it with the card.' },
      // The sidebar: the folder "Course Cards" opens and shows the new card file.
      { id: 'c2-15', text: 'Your card is now a real file, in a folder called Course Cards. It sits at the top of your vault, the folder the app has open.' },
      // The card file's tab: the title line is marked "Title".
      { id: 'c2-16', text: 'A card file holds one card. Its first line is the title.' },
      // The card's ⋯ menu, "Title on the front" › Hide; the title leaves the front.
      { id: 'c2-17', text: "If the title gives the answer away, hide it. Open the card's menu, and choose Title on the front." },
      // A folder's right-click menu; "New card" lights up.
      { id: 'c2-18', text: 'In the app, you make a card yourself. Right-click a folder, and choose New card.' },
      // The new card in Edit card, with "Title" selected; text is typed in.
      { id: 'c2-19', text: 'The card opens, ready to edit. Type the title, then the fact.' },
      // A word is selected; the key row shows "⌘L hide word"; the word is marked.
      { id: 'c2-20', text: 'To hide a word, select it and press Command L.' },
      // Three dashes on an empty line; the card splits into a front and a back.
      { id: 'c2-21', text: 'To add a back side, type three dashes on an empty line. What comes after them is the back.' },
      // The back side: the answer, and one short line that explains it.
      { id: 'c2-22', text: 'On the back, put the answer, or a short line that explains it.' },
      // Esc; the card shows again and the tab takes the title as its name.
      { id: 'c2-23', text: 'When you are done, press Escape. The card saves, and the file takes its name from the title.' },
      // The one small card, alone, with "One card, one fact" under it.
      { id: 'c2-24', text: 'One card, one small fact. Everything else is built from that.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c2-25', text: 'To make one in the real app now, choose Try it in the app. Or go on to the next chapter.' },
      // The sidebar's Inbox row glows softly.
      { id: 'c2-26', text: 'Next: the one place you open each day, where your cards come back.' },
    ],
    tryIt: [
      { target: 'sidebar-course-cards', say: 'Right-click the Course Cards folder in the sidebar.', done: { event: 'folder-menu-open' } },
      { target: 'new-card', say: 'Choose New card.', done: 'click' },
      { target: 'card-editor', say: 'Type a title. Then, on the next line, one fact.', done: { event: 'card-text-changed' } },
      { target: 'card-editor', say: 'Select one word, and press Command L to hide it.', done: { event: 'card-word-hidden' } },
      { target: 'card-done', say: 'Press Escape, or click Done, to save your card.', done: { event: 'card-edit-done' } },
    ],
  },
  {
    id: 'inbox',
    title: 'The Inbox, each day',
    clips: [
      // The card from chapter 2, in the Course Cards folder.
      { id: 'c3-01', text: 'You made your first card. Here is the short daily habit that brings it back.' },
      // A calendar with many cards on many days; it fades.
      { id: 'c3-02', text: 'So which card do you look at, and when?' },
      // The real sidebar; the Inbox row lights up.
      { id: 'c3-03', text: 'The app keeps track of the dates for you. All you do is open the Inbox every day.' },
      // The Inbox row's number, "4".
      { id: 'c3-04', text: 'The Inbox is in the sidebar. The number beside it is how many cards are due now.' },
      // The real Inbox on sample cards: one card in the middle, "1 of 4".
      { id: 'c3-05', text: 'The Inbox shows one card at a time. Look at the card, and try to recall what is hidden.' },
      // Two bars: "Tested themselves 61%", "Re-read 40%", one week later.
      // SOURCE: Roediger & Karpicke 2006, "Test-enhanced learning", Psychological Science, Experiment 2: 61% (STTT) vs 40% (SSSS) after 1 week.
      { id: 'c3-06', text: 'Trying to recall is what makes it stick. In one study, students who tested themselves remembered 61 percent of a text a week later.' },
      // The second bar fills: "Re-read 40%".
      { id: 'c3-07', text: 'Students who only re-read it remembered 40 percent.' },
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
      // The Inbox row, and a small calendar with each day ticked.
      { id: 'c3-21', text: 'Open the Inbox each day, answer honestly, and let the app keep the dates.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c3-22', text: 'To answer your own card in the real app, choose Try it in the app.' },
      // A page of notes, with a space between two paragraphs.
      { id: 'c3-23', text: 'Next: a card can also live right inside your notes.' },
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
      { id: 'c4-01', text: 'So far, your card is a file of its own. But it can also sit beside the notes it came from.' },
      // Three empty frames side by side: "By itself", "In a page", "Embedded".
      { id: 'c4-02', text: 'A card can live in three places. The review works the same in each one.' },
      // The card file from chapter 2 in its own tab.
      { id: 'c4-03', text: "First, a card by itself. That's the card file you made: one file, one card." },
      // A page of notes with a card between two paragraphs.
      { id: 'c4-04', text: 'Second, a card inside a page. Your notes on a topic can hold cards right beside the text.' },
      // A "/card" typed in a page; a new card opens for editing.
      { id: 'c4-05', text: 'In a page, type slash card, and press Return. A new card opens, ready to edit.' },
      // A card in a page with its ⋯ menu, its Reviews, and the Inbox behind it.
      { id: 'c4-06', text: 'A card in a page has the same menu, the same history, and the same Inbox.' },
      // A page's right-click menu: "Review this page".
      { id: 'c4-07', text: 'To review only the cards of one page, right-click the page, and choose Review this page.' },
      // A page shows a card that lives in another file; an arrow back to the card file.
      { id: 'c4-08', text: 'Third, a card embedded in a page. The card lives in one place, and the page shows it.' },
      // The card's ⋯ menu, "Copy card link"; a paste in the page; the choice "Embed".
      { id: 'c4-09', text: "To embed one, copy the card's link from its menu. Paste it in a page, and choose Embed." },
      // The embed's head: ↗ Embedded from "…" · ID.
      { id: 'c4-10', text: "The embed has a small head that says Embedded from, with the card's title." },
      // Edit card on the embed; the card file changes too.
      { id: 'c4-11', text: 'Edit an embed, and you change the one real card. Its history stays with it.' },
      // A card moves between the three frames; its history line follows.
      { id: 'c4-12', text: 'You can move a card between these places at any time. Its history goes with it.' },
      // Two labels: "A fact on its own" under the card file, "Part of your notes" under the page.
      { id: 'c4-13', text: 'Use a card file for a fact on its own. Use a card in a page when it belongs with your notes.' },
      // One card, shown in three pages at once; lines lead back to the one card.
      { id: 'c4-14', text: 'This is the mix and match from before. One card, one home, shown wherever it helps.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c4-15', text: 'To embed your first card in a page, choose Try it in the app.' },
      // The stage widens; many cards, far into the distance.
      { id: 'c4-16', text: "That's the how. Next, a short break, to see where all this can take you." },
    ],
    tryIt: [
      { target: 'card-menu', say: "Open your card's menu: the three dots in its head.", done: 'click' },
      { target: 'card-copy-link', say: 'Choose Copy card link.', done: 'click' },
      { target: 'course-page', say: 'Now open Course page, in the Course Cards folder.', done: 'click' },
      { target: 'page-editor', say: 'Click in the page, and paste with Command V. Then choose Embed.', done: { event: 'card-embedded' } },
    ],
  },
  {
    id: 'compound',
    title: 'Why it is worth it',
    clips: [
      // The four chapters so far, as four small ticks.
      { id: 'c5-01', text: 'You can make a card, review it, and place it in your notes. Now, why it is worth doing.' },
      // A small sum grows on itself, like interest on savings.
      { id: 'c5-02', text: 'What you learn this way compounds. To compound is to grow on itself, like interest.' },
      // One card, then a new card that hooks onto it.
      { id: 'c5-03', text: 'Each thing you keep gives the next thing something to hold on to.' },
      // A counter: 5 cards a day, the days of a year pass, "1,825".
      { id: 'c5-04', text: 'Say you make five cards a day. In a year, that is more than 1,800 small things you still know.' },
      // The pile grows tall; the daily stack beside it stays small.
      { id: 'c5-05', text: 'And because known cards come back less and less often, the daily review stays small while the pile grows.' },
      // Wooden boxes of paper slips; the name "Niklas Luhmann", "1951 to 1996", "about 90,000 cards".
      // SOURCE: Niklas Luhmann-Archiv, Bielefeld University: about 90,000 notes, made between 1951 and 1996.
      { id: 'c5-06', text: 'The sociologist Niklas Luhmann kept a box of paper slips for about 45 years. It grew to around 90,000 of them.' },
      // A shelf of his books fills in: "nearly 600 publications", "over 40 books".
      // SOURCE: Niklas Luhmann-Archiv, Bielefeld University: nearly 600 publications, among them over 40 monographs.
      { id: 'c5-07', text: 'He wrote nearly 600 publications, among them more than 40 books.' },
      // Long boxes of 4 by 6 index cards; the name "Ryan Holiday".
      // SOURCE: Ryan Holiday, YouTube video UBdlprawTkA (his note card system): tens of thousands of cards, over 20 years.
      { id: 'c5-08', text: 'The writer Ryan Holiday has kept tens of thousands of index cards, over twenty years.' },
      // His first book, then the second and third; the stack of cards under them keeps growing.
      // SOURCE: same video: his first book got some use from the cards; the most value came from years of cards added up.
      { id: 'c5-09', text: 'He says the most value came years later, from all the cards added up.' },
      // Three small scenes: a meeting, a page in another language, a field that becomes clear.
      { id: 'c5-10', text: 'You do not need to write books. Think of the meeting where the right fact is there when you need it.' },
      // A page in another language becomes readable; a hard subject comes into focus.
      { id: 'c5-11', text: 'The language you keep. The subject you finally understand.' },
      // The card base, now large, glows: "Your card base".
      { id: 'c5-12', text: 'Over time, your card base becomes a record of what you know. Because you review it, you still know it.' },
      // A few cards a day, and a long road of days behind them.
      { id: 'c5-13', text: 'Small cards, every day, add up to a lot.' },
      // One card, held in a hand; "Yours".
      { id: 'c5-14', text: 'But only if the cards are truly yours. That is next.' },
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
      { id: 'c6-03', text: 'So the goal is not to copy the internet into it. There is always more. You would never finish.' },
      // A page of notes boils down to two short cards in plain words.
      { id: 'c6-04', text: 'The goal is to distil. Take what you learned, and put it in your own words and your own formats.' },
      // A simple picture of digestion: food in, a smaller, useful part kept.
      { id: 'c6-05', text: 'Think of it like digestion. You do not have to know a thing fully before you make its card.' },
      // The useful part is kept; the rest passes.
      { id: 'c6-06', text: 'But you do have to digest it first.' },
      // A person thinks over a note, then says it in one simple line.
      { id: 'c6-07', text: 'To digest is to think it through, until you can say it simply.' },
      // A shallow glance versus a deep look; the deep one leaves a lasting mark.
      // SOURCE: Craik & Lockhart 1972, "Levels of processing: A framework for memory research", Journal of Verbal Learning and Verbal Behavior.
      { id: 'c6-08', text: 'Memory researchers call this depth of processing. The more you think about what something means, the longer you keep it.' },
      // Two words: "fast", made by the person, glows longer than "fast", only read.
      // SOURCE: Slamecka & Graf 1978, "The generation effect: Delineation of a phenomenon", J. Exp. Psych.: Human Learning and Memory.
      { id: 'c6-09', text: 'In one classic study, people remembered words they came up with themselves better than words they only read.' },
      // Someone else's deck is copied in; the cards stay grey.
      { id: 'c6-10', text: "That is why copying someone else's cards makes no sense. It skips the very part that makes you learn." },
      // A phone note: a quick line written down while someone talks.
      { id: 'c6-11', text: 'So here is the habit. When you hear something worth keeping, write it down somewhere. A note, a list, anywhere.' },
      // A rushed, messy card is made on the spot; it gets a red mark.
      { id: 'c6-12', text: 'Do not make the card in that moment. A card made in a hurry is usually a poor card.' },
      // Poor cards pile up in the Inbox; the Inbox row dims.
      { id: 'c6-13', text: 'Poor cards pile up. Review turns into a chore, and you stop opening the Inbox.' },
      // Later, at a quiet desk: the note becomes a clean card.
      { id: 'c6-14', text: 'Make the card later, when you have time to sit and think. Capture first, make later.' },
      // A stack of marked books beside a desk; a second pass; a few lines stand out.
      // SOURCE: Ryan Holiday, YouTube video UBdlprawTkA: he lets a book sit, then makes note cards on a second pass.
      { id: 'c6-15', text: 'Ryan Holiday does this with books. He lets a book sit, then makes his cards on a second pass.' },
      // The new-card line: "New cards · 60 waiting", ten a day; a week of days ticks past.
      { id: 'c6-16', text: 'Remember the ten new cards a day. If sixty are waiting, a new card can take about a week to reach you.' },
      // The card arrives in the Inbox; it looks familiar, like a friend.
      { id: 'c6-17', text: 'When it comes, it is no surprise. You made it, you digested it, and you have been looking forward to it.' },
      // A mental map of the card base, with the cards in their places.
      { id: 'c6-18', text: 'You carry a picture of your card base in your head, because you put each card there.' },
      // The card base and the head in profile again, matching.
      { id: 'c6-19', text: 'Keep this: your card base is your knowledge base. Make it yours, one digested card at a time.' },
      // A clean card next to a messy one.
      { id: 'c6-20', text: 'So what does a good card look like? That is next.' },
    ],
  },
  {
    id: 'good-card',
    title: 'What makes a good card',
    clips: [
      // A digested note, and an empty card beside it.
      { id: 'c7-01', text: 'You have digested an idea. Here is how to make its card a good one.' },
      // A long page of notes is pasted into one card; the card bulges.
      { id: 'c7-02', text: 'Many people paste a whole page of notes into one card. Then they review it, and nothing sticks.' },
      // The wall of notes, with a question mark over it.
      { id: 'c7-03', text: 'A wall of notes is not a card. It asks you to recall everything at once, so you recall nothing well.' },
      // One sentence in the wall lights up.
      { id: 'c7-04', text: 'Before you make a card, ask one question. What is the one thing I want to recall?' },
      // The wall splits into four small cards, one fact each.
      { id: 'c7-05', text: 'Then split it. One card for each thing. Small cards are quick to answer, and easy to remember.' },
      // Notes about one word become four cards: meaning, how to say it, an example, where it comes from.
      { id: 'c7-06', text: 'For example, notes about a new word become four cards. What it means, how to say it, one example, and where it comes from.' },
      // A card that turns red each time splits in two.
      { id: 'c7-07', text: 'If a card is hard every time, it is often two cards in one. Split it again.' },
      // Card A: "What does {{DNS}} stand for?" Card B: "What does DNS stand for?" with the back "{{Domain Name System}}". WAITS: the person picks one.
      { id: 'c7-08', text: 'Your turn. Which of these two cards is better?' },
      // Card B gets the check; card A's blank shows it hides the subject.
      { id: 'c7-09', text: 'The second one. The first card hides the subject of its own question. Without it, there is no clue to recall from.' },
      // Rule 1 as a title; card B's front shows, the answer hidden.
      { id: 'c7-10', text: 'So, rule one. Hide the answer, not the clue. The front must make sense to someone who does not know the answer.' },
      // A card with nothing hidden; under it, "Re-reading: low" and "Testing yourself: high".
      // SOURCE: Dunlosky, Rawson, Marsh, Nathan & Willingham 2013, "Improving students' learning with effective learning techniques", Psychological Science in the Public Interest.
      { id: 'c7-11', text: 'Reading is not recalling. A large review of study methods rated re-reading and highlighting low, and testing yourself high.' },
      // Rule 2; "What does DNS stand for?" with "DNS" underlined.
      { id: 'c7-12', text: 'Rule two. In a question, keep the subject in view. Ask what DNS stands for, and hide only the meaning.' },
      // Rule 3; a sentence with three scattered blanks, then one blank over a whole phrase.
      { id: 'c7-13', text: 'Rule three. Hide a phrase that means something, not a few scattered words.' },
      // The answer shows; the person's own words differ, and still get the check.
      { id: 'c7-14', text: 'When you check yourself, the same meaning in other words counts as remembered. Exact words matter only for things like a quote or a command.' },
      // A title changes from "From the podcast, part 3" to the name of the idea.
      { id: 'c7-15', text: 'Name the card after the idea, not after where you found it. Picture looking for it again in six months.' },
      // Four small cards: a word, a person, a process, a quote.
      { id: 'c7-16', text: 'Different things need different cards. A word, a person, a process, or a quote each has its own format.' },
      // The card skill's Formats folder, one page for each format.
      { id: 'c7-17', text: 'Each format is a short page in the card skill, with an example. You will see where it is in the last chapter.' },
      // The four small cards from before, side by side.
      { id: 'c7-18', text: 'One thing to recall. Hide the answer, not the clue. Small cards beat big ones.' },
      // A terminal window with an agent in it, beside a card.
      { id: 'c7-19', text: 'Good cards take thought. Next, a tool that can help make them, and how it can hurt.' },
    ],
  },
  {
    id: 'ai',
    title: 'Make cards with your AI, without vibe writing',
    clips: [
      // A terminal window with an agent in it, next to the app.
      { id: 'c8-01', text: 'You know a good card starts with digestion. Now, a tool that makes cards fast, and why that speed is also its danger.' },
      // A card file opens as plain text: the title line, the fact, the hidden word in marks.
      { id: 'c8-02', text: 'First, a fact that matters here. Each card is a plain Markdown file on your computer.' },
      // The word "Markdown", then plain text with a few light marks.
      { id: 'c8-03', text: 'Markdown is plain text with a few light marks, so any tool that reads files can read your cards.' },
      // The agent's window reads a card file.
      { id: 'c8-04', text: 'An agent is an AI tool that can read and write files on your computer. Any agent like that works here.' },
      // The app with a line through a cloud: no AI inside, nothing sent.
      { id: 'c8-05', text: 'The app has no AI inside, and it sends nothing anywhere. You use your own agent.' },
      // The screen goes quiet; one line: "Do not vibe write your cards."
      { id: 'c8-06', text: 'Now the warning. Do not vibe write your cards.' },
      // An agent pours out card after card; nobody reads them.
      { id: 'c8-07', text: 'Vibe writing means letting an AI pour out cards you never thought through.' },
      // The card base from chapter 6 floods with grey cards.
      { id: 'c8-08', text: 'That is the fastest way to ruin your card base. And your card base is your knowledge base.' },
      // The Inbox fills with strangers; the Inbox row dims, then goes dark.
      { id: 'c8-09', text: 'Your Inbox fills with cards you do not know, and the whole system becomes worthless.' },
      // Two paths: "Vibe write" leads down; "Digest, then make" leads up.
      { id: 'c8-10', text: 'If you want this system to fail, vibe write your cards. If you want what you know to compound, do not.' },
      // The name "Ryan Holiday" and his line, in quotes.
      // SOURCE: Ryan Holiday, YouTube video UBdlprawTkA, on taking notes by hand: "The inefficiency is the efficiency."
      { id: 'c8-11', text: 'Ryan Holiday puts it in four words: "The inefficiency is the efficiency." The slow part, the thinking, is where you learn.' },
      // A digested note goes into the agent; well-made cards come out; a person reads them.
      { id: 'c8-12', text: 'The right way: the AI helps you make cards from what you have already digested.' },
      // The note, the agent, and the person, in a loop.
      { id: 'c8-13', text: 'You bring notes you thought through. The agent shapes them into cards, by the rules you just learned.' },
      // The person reads each new card.
      { id: 'c8-14', text: 'Then you read each one.' },
      // A text box with "Use the example notes" under it. WAITS: the person pastes notes or picks the example.
      { id: 'c8-15', text: "Let's try it. Paste some notes you have already digested. Or use the example notes." },
      // The prompt with a Copy button. WAITS: the person clicks Copy.
      { id: 'c8-16', text: 'Next, copy the prompt.' },
      // The prompt's lines light up one by one: the skill, three cards, Course Cards, the check.
      { id: 'c8-17', text: 'The prompt tells your agent to read the card skill first. Then it asks for three cards from your notes, in Course Cards, and a check of each one.' },
      // The card skill's pages flow into the agent.
      { id: 'c8-18', text: 'The skill teaches your agent the same rules you just learned.' },
      // The agent's window; a paste. WAITS: the agent writes card files in Course Cards.
      { id: 'c8-19', text: 'Paste the prompt into your agent, and let it work.' },
      // Card files appear in the course, one by one.
      { id: 'c8-20', text: 'The cards show up here as soon as your agent writes them.' },
      // The quiet line "No new cards yet. Did you check with your agent?"
      { id: 'c8-21', text: 'If nothing shows up after a minute, check with your agent. The course keeps waiting.' },
      // Each new card gets a check mark or "1 thing to check".
      { id: 'c8-22', text: 'Then the app checks each card for sure mistakes. For example, a card with nothing hidden.' },
      // "3 cards. 2 pass the check." with the fault listed under the third.
      { id: 'c8-23', text: 'You see how many cards pass, and what to fix in the others. Fix them yourself, or ask your agent.' },
      // Skip, then three ready example cards with "Make these cards".
      { id: 'c8-24', text: 'No agent? Skip this step. The course shows three example cards, and makes them only if you say so.' },
      // A person reads a card, rewrites a line, and deletes another card.
      { id: 'c8-25', text: 'An agent drafts fast, but you decide. Read each card, and keep only what you want to recall.' },
      // A line on a card is rewritten in plainer words.
      { id: 'c8-26', text: 'Where a card does not sound like you, put it in your own words.' },
      // The card skill's right-click menu: "Copy prompt for your agent".
      { id: 'c8-27', text: 'You can copy the same prompt at any time. Right-click the card skill in the sidebar, and choose Copy prompt for your agent.' },
      // The loop again: you digest, the agent shapes, you decide.
      { id: 'c8-28', text: 'So, the line to keep: you digest and decide. Your agent only shapes.' },
      // Three icons appear: a pen, the Inbox, a pair of shears.
      { id: 'c8-29', text: 'Making cards is one of three habits. Next, all three.' },
    ],
  },
  {
    id: 'habits',
    title: 'Three habits: make, review, tend',
    clips: [
      // The pen icon: cards by hand and with the agent.
      { id: 'c9-01', text: "You can now make cards by hand and with your agent. Let's step back and see the whole system." },
      // Three icons in a row: a pen "Make", the Inbox "Review", shears "Tend".
      { id: 'c9-02', text: 'It has three habits: making cards, reviewing cards, and tending cards. Tending means fixing and improving the cards you have.' },
      // The Inbox icon lights up; a sunrise.
      { id: 'c9-03', text: 'Reviewing is the daily one. You open the Inbox, and the app picks the cards.' },
      // Two bars: "Spacing worked better: 90%", "Believed cramming worked better: 72%".
      // SOURCE: Kornell 2009, "Optimising learning using flashcards: Spacing is more effective than cramming", Applied Cognitive Psychology.
      { id: 'c9-04', text: 'Trust the schedule, even when it feels slow. In one study, spacing worked better than cramming for 90 percent of learners.' },
      // The second bar fills: "Believed cramming worked better: 72%".
      { id: 'c9-05', text: 'Yet 72 percent of them believed cramming had worked better.' },
      // The shears icon lights up, inside the Inbox: a card with a small fix.
      { id: 'c9-06', text: 'Tending needs no time of its own. It happens while you review.' },
      // Thought bubbles over a card: "Not clear", "Needs a link".
      { id: 'c9-07', text: 'This card is not clear. That one needs a link. You notice it right there, in the review.' },
      // A short message goes to the agent; the review goes on.
      { id: 'c9-08', text: 'With an agent, you send the fix in that moment, and keep going.' },
      // A separate "chore" block on a calendar dissolves into the review block.
      { id: 'c9-09', text: 'Tending used to need time of its own. Now it rides along with the review.' },
      // A clock face: a short arc for review and tending.
      { id: 'c9-10', text: 'Even with a large card base, review and tending together can fit in fifteen to twenty minutes a day.' },
      // The pen icon lights up; a quiet desk.
      { id: 'c9-11', text: 'Making is the one you set time aside for. Digesting takes thought, so give it a quiet moment.' },
      // The three icons with their times: "Time set aside", "Every day", "While you review".
      { id: 'c9-12', text: 'Make with time set aside. Review every day. Tend as you review.' },
      // A garden path; the shears icon.
      { id: 'c9-13', text: 'Next, the tending itself, and why it is learning too.' },
    ],
  },
  {
    id: 'care',
    title: 'Be a gardener',
    clips: [
      // The Inbox with a card, and the shears icon from chapter 9.
      { id: 'c10-01', text: 'Tending happens as you review. Here is how, and why it is worth it.' },
      // A garden: a gardener clears weeds and prunes a branch; the garden fills out.
      { id: 'c10-02', text: 'Think of a gardener. A garden does well when someone clears it and prunes it.' },
      // A card is reworded; a small glow over it.
      { id: 'c10-03', text: 'That is not a chore apart from learning. Each fix makes you think about the idea again, and that is learning too.' },
      // A card that keeps turning red; a magnifying glass over its wording.
      { id: 'c10-04', text: 'A card you keep missing is not a failure. It is a sign to look at it.' },
      // The card's wording comes into focus; it splits in two.
      { id: 'c10-05', text: 'Often the wording is unclear, or it is two cards in one.' },
      // Edit card on a card; then E in the Inbox.
      { id: 'c10-06', text: 'To fix a card, click Edit card, or press E in the Inbox. Press Escape when you are done.' },
      // A short note to the agent: "Make this card's clue clearer"; the card file changes.
      { id: 'c10-07', text: 'Or, since each card is a file, tell your agent what to change, and keep reviewing.' },
      // A branch is cut; the plant looks better for it.
      { id: 'c10-08', text: 'Some cards no longer earn their place. Pruning is part of it.' },
      // The card's ⋯ menu, "Archive card"; the card turns muted.
      { id: 'c10-09', text: 'To stop reviewing a card, open its menu and choose Archive card. It keeps its history.' },
      // The Inbox's All cards menu, the Archived row, and Unarchive.
      { id: 'c10-10', text: 'Archived cards are at the bottom of the All cards menu, in the Inbox. Unarchive brings one back.' },
      // ⋯ › Put at top of Inbox; the chip "Up next".
      { id: 'c10-11', text: 'To see a card first, choose Put at top of Inbox. It gets the Up next mark, and comes before the others.' },
      // The first answer; the Up next chip goes.
      { id: 'c10-12', text: 'The mark comes off when you answer the card.' },
      // Reviews under a card in a page opens: each answer, and the Next row.
      { id: 'c10-13', text: 'Under each card is its review history. Click Reviews to see each answer, and when it comes next.' },
      // A row of Reviews with its ×.
      { id: 'c10-14', text: 'Each row has a small cross. Use it to delete one wrong answer.' },
      // ⋯ › Reset history; the card shows New.
      { id: 'c10-15', text: 'If a card changed a lot, choose Reset history. It starts again as a new card.' },
      // The All cards menu: "New cards · 38 more" and its Add button.
      { id: 'c10-16', text: 'Want more today? In the All cards menu, click Add for more new cards. Tomorrow, the usual number comes back.' },
      // The garden again, full and tidy; the card base beside it.
      { id: 'c10-17', text: 'Prune a little each day, and your card base stays a true picture of what you know.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c10-18', text: 'To try Archive and Up next on your own card, choose Try it in the app.' },
      // The sidebar, and a calendar page for the week ahead.
      { id: 'c10-19', text: 'One chapter left: where things are, and your first week.' },
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
      { id: 'c11-01', text: 'You know the three habits, and how to tend as you go. To finish: where to find things, and how to start.' },
      // The real sidebar; the card skill's row at the bottom lights up.
      { id: 'c11-02', text: 'The card skill is at the bottom of the sidebar.' },
      // The card skill opens: Start here, the rules, Formats, Course transcript.
      { id: 'c11-03', text: 'It is a short guide for you and your agent: the rules, the formats with examples, and the words of this course.' },
      // The lock on the skill; right-click › "Duplicate into …".
      { id: 'c11-04', text: 'It is read only. To change it, duplicate it into your vault, and make it your own.' },
      // The duplicate in the vault; an update arrow on the built-in skill.
      { id: 'c11-05', text: 'Your copy syncs with your vault. The built-in skill still gets each update of the app.' },
      // A terminal: `yaseendocs card guide` prints the skill's first page.
      { id: 'c11-06', text: 'Your agent can find it too. One command prints its first page.' },
      // Settings › Review: "Card skill in the sidebar" and "Open the course".
      { id: 'c11-07', text: 'In Settings, under Review, one switch shows or hides the card skill. Open the course brings you back here.' },
      // A week of seven days appears.
      { id: 'c11-08', text: 'Now, your first week.' },
      // Day 1: one card, made from something the person already understands.
      { id: 'c11-09', text: 'Today, make one card, from something you already understand well.' },
      // Each day ticks: the Inbox row lights up.
      { id: 'c11-10', text: 'Each day, open the Inbox, and answer what is due.' },
      // A capture note fills during the week; on one day, a desk and a few new cards.
      { id: 'c11-11', text: 'Keep one place to capture things as you hear them. Once this week, set time aside to make a few cards from it.' },
      // In the Inbox, a small fix to a card.
      { id: 'c11-12', text: 'As you review, fix what is unclear. That is tending, and it is how your card base stays yours.' },
      // A small seedling in fresh soil.
      // SOURCE: Ryan Holiday, YouTube video UBdlprawTkA: the best time to start was long ago; the second best time is now.
      { id: 'c11-13', text: 'Ryan Holiday says the best time to start a system like this was years ago. The second best time is now.' },
      // One new card, then a calendar page turns to tomorrow and the Inbox lights up.
      { id: 'c11-14', text: "That's the whole course. Make one card today. Open the Inbox tomorrow." },
      // The course's end screen: cards made, cards that pass the check, when they come back.
      { id: 'c11-15', text: 'Your card base is your knowledge base. Build it one digested card at a time, and what you learn stays with you.' },
    ],
    tryIt: [
      { target: 'card-skill-row', say: 'This is the card skill. Click it to open it.', done: 'click' },
      { target: 'settings-review', say: 'Now press Command comma to open Settings, and click Review.', done: 'click' },
      { target: 'settings-card-skill', say: 'This switch shows or hides the card skill in the sidebar.', done: { event: 'tour-next' } },
      { target: 'settings-course', say: 'And this button brings you back to the course, at any time.', done: { event: 'tour-next' } },
    ],
  },
]
