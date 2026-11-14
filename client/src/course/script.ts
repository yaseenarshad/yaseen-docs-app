/**
 * The card course's words (YAZ-5119, issue 6A of YAZ-5118). Each clip is one or two spoken sentences, and it is also the
 * caption. The comment above each clip says what the scene shows (issue 6C) and, after "WAITS:", where the person acts.
 * Chapter 1 keeps the approved sample's ids and words (`s1a` to `s3b`).
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

/** Chapter 6: the one line after 60 seconds with no new card from the agent (YAZ-5124). The course keeps waiting. */
export const NO_CARDS_YET = 'No new cards yet. Did you check with your agent?'

export const COURSE: CourseChapter[] = [
  {
    id: 'why',
    title: 'Why you forget, and the fix',
    clips: [
      // A fact glows on the stage.
      { id: 's1a', text: 'You learn something today.' },
      // The forgetting curve falls; the fact fades.
      { id: 's1b', text: 'A week later, most of it is gone.' },
      // A review just before the curve drops; the curve lifts and falls slower.
      { id: 's2a', text: 'But look at it again, right before you forget, and it sticks longer.' },
      // Three reviews; the gaps label "1 day", "1 week", "1 month" on the marks.
      { id: 's2b', text: 'Each time, the gap grows. A day. A week. A month.', marks: [0.439, 0.597, 0.74] },
      // The words "Spaced repetition" settle under the curve.
      { id: 's3a', text: "That's all spaced repetition is." },
      // A calendar fills itself; two buttons, Forgot and Remembered.
      { id: 's3b', text: 'The app keeps the calendar. You only answer: forgot, or remembered.' },
      // The app's real card: a title, a fact, one word as a blank.
      { id: 'c1-01', text: 'The thing you look at is a card. A card is one small fact, with part of it hidden.' },
      // The blank fills in; a check mark.
      { id: 'c1-02', text: 'You try to recall the hidden part. Then you check.' },
      // A stack of cards; the ones you know drift further away.
      { id: 'c1-03', text: 'A few minutes a day is enough. The cards you know well come back less and less.' },
      // The chapter list lights up, 1 to 8.
      { id: 'c1-04', text: 'This course takes about twelve minutes, in eight short chapters.' },
      // The "Try it in the app" button, with "Optional" beside it.
      { id: 'c1-05', text: 'Some chapters let you try the steps in the real app. That part is always your choice.' },
      // The stage clears for chapter 2.
      { id: 'c1-06', text: "By the end, you will have real cards of your own. Let's make the first one." },
    ],
  },
  {
    id: 'first-card',
    title: 'Your first card',
    clips: [
      // A blank card in the middle of the stage.
      { id: 'c2-01', text: 'A good card holds one small fact. Think of something you learned this week.' },
      // An empty card with a blinking caret. WAITS: the person types a fact.
      { id: 'c2-02', text: 'Type one thing you want to remember. One short sentence is best.' },
      // The fact's words become buttons. WAITS: the person taps the word to hide.
      { id: 'c2-03', text: 'Now tap the word you want to hide.' },
      // The word turns into a blank; the card takes its frame.
      { id: 'c2-04', text: "That's a card. The hidden word is the part you will try to recall." },
      // The card, front only. WAITS: the person taps the card to show the word.
      { id: 'c2-05', text: 'Tap it to check yourself.' },
      // Forgot and Remembered under the card. WAITS: the person picks one.
      { id: 'c2-06', text: 'Did you remember it?' },
      // The answer's quiet line under the card.
      { id: 'c2-07', text: 'Either answer is fine. The app saves it with the card.' },
      // Two check marks in a row, then a calendar page turns.
      { id: 'c2-08', text: 'A new card asks you twice. Remember it two times in a row, and then it waits a day or more.' },
      // The sidebar: the folder "Course Cards" opens and shows the new card file.
      { id: 'c2-09', text: 'Your card is now a real file, in a folder called Course Cards. It sits at the top of your vault, the folder the app has open.' },
      // The card file's tab: the title line is marked "Title".
      { id: 'c2-10', text: 'A card file holds one card. Its first line is the title.' },
      // The card's ⋯ menu, "Title on the front" › Hide; the title leaves the front.
      { id: 'c2-11', text: "If the title gives the answer away, hide it. Open the card's menu, and choose Title on the front." },
      // A folder's right-click menu; "New card" lights up.
      { id: 'c2-12', text: 'In the app, you make a card yourself. Right-click a folder, and choose New card.' },
      // The new card in Edit card, with "Title" selected; text is typed in.
      { id: 'c2-13', text: 'The card opens, ready to edit. Type the title, then the fact.' },
      // A word is selected; the key row shows "⌘L hide word"; the word is marked.
      { id: 'c2-14', text: 'To hide a word, select it and press Command L.' },
      // Three dashes on an empty line; the card splits into a front and a back.
      { id: 'c2-15', text: 'To add a back side, type three dashes on an empty line. What comes after them is the back.' },
      // The back side: the answer, and one short line that explains it.
      { id: 'c2-16', text: 'On the back, put the answer, or a short line that explains it.' },
      // Esc; the card shows again and the tab takes the title as its name.
      { id: 'c2-17', text: 'When you are done, press Escape. The card saves, and the file takes its name from the title.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c2-18', text: 'To make one in the real app now, choose Try it in the app. Or go on to the next chapter.' },
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
      // A calendar with many cards on many days; it fades.
      { id: 'c3-01', text: 'So which card do you look at, and when?' },
      // The real sidebar; the Inbox row lights up.
      { id: 'c3-02', text: 'The app keeps track of the dates for you. All you do is open the Inbox every day.' },
      // The Inbox row's number, "4".
      { id: 'c3-03', text: 'The Inbox is in the sidebar. The number beside it is how many cards are due now.' },
      // The real Inbox on sample cards: one card in the middle, "1 of 4".
      { id: 'c3-04', text: 'The Inbox shows one card at a time. Look at the card, and try to recall what is hidden.' },
      // Space; the hidden word shows, then the back.
      { id: 'c3-05', text: 'Press Space to show the hidden words, one at a time, and then the back.' },
      // Forgot and Remembered show under the card.
      { id: 'c3-06', text: 'Then choose Forgot or Remembered. Be honest. It only helps you.' },
      // The hover on Remembered: "Remembered · 9 days".
      { id: 'c3-07', text: 'Hold the pointer on a button to see when the card comes back.' },
      // The key row: 1 and 2 on the buttons; ⌘Z.
      { id: 'c3-08', text: 'You can also press 1 for Forgot and 2 for Remembered. Command Z takes back the last answer.' },
      // The calendar again, under the card.
      { id: 'c3-09', text: 'Based on that, the app moves the calendar for you.' },
      // Forgot; the card's date moves closer.
      { id: 'c3-10', text: 'If you forgot, the card comes back sooner, so you can learn it again.' },
      // The forgotten card goes to the end of the queue and comes round again.
      { id: 'c3-11', text: 'In fact, a card you forgot comes back later in the same review, until you remember it.' },
      // Remembered; the card's date moves further, a bigger gap each time.
      { id: 'c3-12', text: 'If you remembered, the card waits longer. Each time you remember it, the wait grows.' },
      // A new card: two check marks, then it leaves for a later day.
      { id: 'c3-13', text: 'A new card needs two Remembered in a row. Then it leaves for a day or more.' },
      // The dates fill in by themselves.
      { id: 'c3-14', text: 'You never set a date. The app works out each date from your answers.' },
      // A few days pass on the calendar; the due cards wait in the Inbox.
      { id: 'c3-15', text: "Missed a day? That's fine. The cards that are due wait in the Inbox until you come back." },
      // "New cards a day: 10" in Settings › Review.
      { id: 'c3-16', text: 'To keep it light, the Inbox brings at most ten new cards a day. You can change that number in Settings.' },
      // The done screen: "Inbox complete."
      { id: 'c3-17', text: "When nothing is left, the Inbox says Inbox complete. That's it for today." },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c3-18', text: 'To answer your own card in the real app, choose Try it in the app.' },
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
      // Three empty frames side by side: "By itself", "In a page", "Embedded".
      { id: 'c4-01', text: 'A card can live in three places. The review works the same in each one.' },
      // The card file from chapter 2 in its own tab.
      { id: 'c4-02', text: "First, a card by itself. That's the card file you made: one file, one card." },
      // A page of notes with a card between two paragraphs.
      { id: 'c4-03', text: 'Second, a card inside a page. Your notes on a topic can hold cards right beside the text.' },
      // A "/card" typed in a page; a new card opens for editing.
      { id: 'c4-04', text: 'In a page, type slash card, and press Return. A new card opens, ready to edit.' },
      // A card in a page with its ⋯ menu, its Reviews, and the Inbox behind it.
      { id: 'c4-05', text: 'A card in a page has the same menu, the same history, and the same Inbox.' },
      // A page's right-click menu: "Review this page".
      { id: 'c4-06', text: 'To review only the cards of one page, right-click the page, and choose Review this page.' },
      // A page shows a card that lives in another file; an arrow back to the card file.
      { id: 'c4-07', text: 'Third, a card embedded in a page. The card lives in one place, and the page shows it.' },
      // The card's ⋯ menu, "Copy card link"; a paste in the page; the choice "Embed".
      { id: 'c4-08', text: "To embed one, copy the card's link from its menu. Paste it in a page, and choose Embed." },
      // The embed's head: ↗ Embedded from "…" · ID.
      { id: 'c4-09', text: "The embed has a small head that says Embedded from, with the card's title." },
      // Edit card on the embed; the card file changes too.
      { id: 'c4-10', text: 'Edit an embed, and you change the one real card. Its history stays with it.' },
      // A card moves between the three frames; its history line follows.
      { id: 'c4-11', text: 'You can move a card between these places at any time. Its history goes with it.' },
      // Two labels: "A fact on its own" under the card file, "Part of your notes" under the page.
      { id: 'c4-12', text: 'Use a card file for a fact on its own. Use a card in a page when it belongs with your notes.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c4-13', text: 'To embed your first card in a page, choose Try it in the app.' },
    ],
    tryIt: [
      { target: 'card-menu', say: "Open your card's menu: the three dots in its head.", done: 'click' },
      { target: 'card-copy-link', say: 'Choose Copy card link.', done: 'click' },
      { target: 'course-page', say: 'Now open Course page, in the Course Cards folder.', done: 'click' },
      { target: 'page-editor', say: 'Click in the page, and paste with Command V. Then choose Embed.', done: { event: 'card-embedded' } },
    ],
  },
  {
    id: 'good-card',
    title: 'What makes a good card',
    clips: [
      // A clean card next to a messy one.
      { id: 'c5-01', text: 'Now the most important part: what to put on a card.' },
      // A long page of notes is pasted into one card; the card bulges.
      { id: 'c5-02', text: 'Many people paste a whole page of notes into one card. Then they review it, and nothing sticks.' },
      // The wall of notes, with a question mark over it.
      { id: 'c5-03', text: 'A wall of notes is not a card. It asks you to recall everything at once, so you recall nothing well.' },
      // One sentence in the wall lights up.
      { id: 'c5-04', text: 'Before you make a card, ask one question. What is the one thing I want to recall?' },
      // The wall splits into four small cards, one fact each.
      { id: 'c5-05', text: 'Then split it. One card for each thing. Small cards are quick to answer, and easy to remember.' },
      // Notes about one word become four cards: meaning, how to say it, an example, where it comes from.
      { id: 'c5-06', text: 'For example, notes about a new word become four cards. What it means, how to say it, one example, and where it comes from.' },
      // A card that turns red each time splits in two.
      { id: 'c5-07', text: 'If a card is hard every time, it is often two cards in one. Split it again.' },
      // Card A: "What does {{DNS}} stand for?" Card B: "What does DNS stand for?" with the back "{{Domain Name System}}". WAITS: the person picks one.
      { id: 'c5-08', text: 'Your turn. Which of these two cards is better?' },
      // Card B gets the check; card A's blank shows it hides the subject.
      { id: 'c5-09', text: 'The second one. The first card hides the subject of its own question. Without it, there is no clue to recall from.' },
      // Rule 1 as a title; card B's front shows, the answer hidden.
      { id: 'c5-10', text: 'So, rule one. Hide the answer, not the clue. The front must make sense to someone who does not know the answer.' },
      // Rule 2; "What does DNS stand for?" with "DNS" underlined.
      { id: 'c5-11', text: 'Rule two. In a question, keep the subject in view. Ask what DNS stands for, and hide only the meaning.' },
      // Rule 3; a sentence with three scattered blanks, then one blank over a whole phrase.
      { id: 'c5-12', text: 'Rule three. Hide a phrase that means something, not a few scattered words.' },
      // Four small cards: a word, a person, a process, a quote.
      { id: 'c5-13', text: 'Different things need different cards. A word, a person, a process, or a quote each has its own format.' },
      // A list of format names; a few light up: Acronym, Comparison, Procedure, Quote.
      { id: 'c5-14', text: 'There is a format for acronyms, for concepts, for comparisons, for steps, for quotes, and more.' },
      // The card skill's Formats folder, one page for each format.
      { id: 'c5-15', text: 'Each format is a short page in the card skill, with an example. You will see where it is in the last chapter.' },
      // The four small cards from before, side by side.
      { id: 'c5-16', text: 'One thing to recall. Hide the answer, not the clue. Small cards beat big ones.' },
    ],
  },
  {
    id: 'ai',
    title: 'Make cards with your AI',
    clips: [
      // A pile of notes; a cursor writes cards from it, slowly.
      { id: 'c6-01', text: 'Good cards take time to write. An AI agent can write the first draft for you.' },
      // A terminal window with an agent in it, next to the app.
      { id: 'c6-02', text: 'An agent is an AI tool that can read and write files on your computer. Any agent like that works here.' },
      // The app with a line through a cloud: no AI inside, nothing sent.
      { id: 'c6-03', text: 'The app has no AI inside, and it sends nothing anywhere. You use your own agent.' },
      // A text box with "Use the example notes" under it. WAITS: the person pastes notes or picks the example.
      { id: 'c6-04', text: 'First, paste some of your notes here. Or use the example notes.' },
      // The prompt with a Copy button. WAITS: the person clicks Copy.
      { id: 'c6-05', text: 'Next, copy the prompt.' },
      // The prompt's lines light up one by one: the skill, three cards, Course Cards, the check.
      { id: 'c6-06', text: 'The prompt tells your agent to read the card skill first. Then it asks for three cards from your notes, in Course Cards.' },
      // The prompt's last line: the card check command.
      { id: 'c6-07', text: "It also asks the agent to check each card with the app's own command." },
      // The card skill's pages flow into the agent.
      { id: 'c6-08', text: 'The skill teaches your agent the same rules you just learned.' },
      // The agent's window; a paste. WAITS: the agent writes card files in Course Cards.
      { id: 'c6-09', text: 'Paste the prompt into your agent, and let it work.' },
      // Card files appear in the course, one by one.
      { id: 'c6-10', text: 'The cards show up here as soon as your agent writes them. You do not need to do anything else.' },
      // The quiet line "No new cards yet. Did you check with your agent?"
      { id: 'c6-11', text: 'If nothing shows up after a minute, check with your agent. The course keeps waiting.' },
      // Each new card gets a check mark or "1 thing to check".
      { id: 'c6-12', text: 'Then the app checks each card for sure mistakes. For example, a card with nothing hidden.' },
      // "3 cards. 2 pass the check." with the fault listed under the third.
      { id: 'c6-13', text: 'You see how many cards pass, and what to fix in the others. Fix them yourself, or ask your agent.' },
      // A card's head with "1 thing to check".
      { id: 'c6-14', text: 'Later, the same check shows on the card itself. A card with a fault says 1 thing to check, in its head.' },
      // Skip, then three ready example cards with "Make these cards".
      { id: 'c6-15', text: 'No agent? Skip this step. The course shows three example cards, and makes them only if you say so.' },
      // A person reads a card and deletes one.
      { id: 'c6-16', text: 'An agent drafts fast, but you decide. Read each card, and keep only what you want to recall.' },
      // The card skill's right-click menu: "Copy prompt for your agent".
      { id: 'c6-17', text: 'You can copy the same prompt at any time. Right-click the card skill in the sidebar, and choose Copy prompt for your agent.' },
    ],
  },
  {
    id: 'care',
    title: 'Look after your cards',
    clips: [
      // A row of cards with a small tool tray.
      { id: 'c7-01', text: 'Cards need a little care over time. Here are the things you will use most.' },
      // Edit card on a card; then E in the Inbox.
      { id: 'c7-02', text: 'To fix a card, click Edit card, or press E in the Inbox. Press Escape when you are done.' },
      // The card's ⋯ menu, "Archive card"; the card turns muted.
      { id: 'c7-03', text: 'To stop reviewing a card, open its menu and choose Archive card. It keeps its history.' },
      // The Inbox's All cards menu, the Archived row, and Unarchive.
      { id: 'c7-04', text: 'Archived cards are at the bottom of the All cards menu, in the Inbox. Unarchive brings one back.' },
      // ⋯ › Put at top of Inbox; the chip "Up next".
      { id: 'c7-05', text: 'To see a card first, choose Put at top of Inbox. It gets the Up next mark, and comes before the others.' },
      // The first answer; the Up next chip goes.
      { id: 'c7-06', text: 'The mark comes off when you answer the card.' },
      // Reviews under a card in a page opens: each answer, and the Next row.
      { id: 'c7-07', text: 'Under each card is its review history. Click Reviews to see each answer, and when it comes next.' },
      // A row of Reviews with its ×.
      { id: 'c7-08', text: 'Each row has a small cross. Use it to delete one wrong answer.' },
      // ⋯ › Reset history; the card shows New.
      { id: 'c7-09', text: 'If a card changed a lot, choose Reset history. It starts again as a new card.' },
      // The All cards menu: "New cards · 38 more" and its Add button.
      { id: 'c7-10', text: 'Want more today? In the All cards menu, click Add for more new cards. Tomorrow, the usual number comes back.' },
      // ⌘Z; the added cards leave again.
      { id: 'c7-11', text: 'Changed your mind? Command Z takes the add back.' },
      // A folder's right-click menu: "Review this folder".
      { id: 'c7-12', text: 'To review only one folder, right-click it, and choose Review this folder.' },
      // The "Try it in the app" button and "Next chapter".
      { id: 'c7-13', text: 'To try Archive and Up next on your own card, choose Try it in the app.' },
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
    title: 'Where things are',
    clips: [
      // The real sidebar; the card skill's row at the bottom lights up.
      { id: 'c8-01', text: 'Last, where to find things. The card skill is at the bottom of the sidebar.' },
      // The card skill opens: Start here, the rules, Formats, Course transcript.
      { id: 'c8-02', text: 'It is a short guide for you and your agent: the rules, the formats with examples, and the words of this course.' },
      // The lock on the skill; right-click › "Duplicate into …".
      { id: 'c8-03', text: 'It is read only. To change it, duplicate it into your vault, and make it your own.' },
      // The duplicate in the vault; an update arrow on the built-in skill.
      { id: 'c8-04', text: 'Your copy syncs with your vault. The built-in skill still gets each update of the app.' },
      // A terminal: yaseendocs card guide prints the skill's first page.
      { id: 'c8-05', text: 'Your agent can find it too. The command yaseendocs card guide prints its first page.' },
      // Settings › Review: "Card skill in the sidebar" and "Open the course".
      { id: 'c8-06', text: 'In Settings, under Review, one switch shows or hides the card skill. Open the course brings you back here.' },
      // Settings › Review: New cards a day, and two or four answer buttons.
      { id: 'c8-07', text: 'The same place holds your review settings, like new cards a day, and two or four answer buttons.' },
      // One new card, then a calendar page turns to tomorrow and the Inbox lights up.
      { id: 'c8-08', text: "That's the whole course. Make one card today. Open the Inbox tomorrow." },
      // The course's end screen: cards made, cards that pass the check, when they come back.
      { id: 'c8-09', text: 'A few minutes a day, and what you learn stays with you.' },
    ],
    tryIt: [
      { target: 'card-skill-row', say: 'This is the card skill. Click it to open it.', done: 'click' },
      { target: 'settings-review', say: 'Now press Command comma to open Settings, and click Review.', done: 'click' },
      { target: 'settings-card-skill', say: 'This switch shows or hides the card skill in the sidebar.', done: { event: 'tour-next' } },
      { target: 'settings-course', say: 'And this button brings you back to the course, at any time.', done: { event: 'tour-next' } },
    ],
  },
]
