import type { FileId } from "@excalidraw/element/types";

import type { BinaryFiles, DataURL } from "../../types";
import type { StoryboardPresentation } from "../sceneContract";

const slideCopy = [
  [
    "The map",
    "The first three words live in the brain",
    "Every AI tool has a brain at its center, the model; the first three words describe that brain: what it is, the unit it thinks in, and how much it can hold at once.",
  ],
  [
    "The model",
    "It predicts the next word",
    "A large language model is a brain trained on a huge slice of the internet; it works by predicting the next piece of text, one step at a time.",
  ],
  [
    "So what",
    "Brilliant, and sometimes confidently wrong",
    "Because it predicts instead of looking things up, it can sound completely sure and still be wrong; the move is to use it like a sharp intern and check anything that matters.",
  ],
  [
    "The unit and the meter",
    "It reads in pieces, not words",
    "Every word gets chopped into small chunks called tokens; that's the unit the brain reads in, and the unit everything gets counted in.",
  ],
  [
    "Working memory",
    "How much it holds in its head",
    "The context window is the brain's working memory: everything it can keep in mind at once, measured in tokens.",
  ],
  [
    "So what",
    "Fill it up, the early stuff slips out",
    "When the working memory fills, the oldest things fall away, which is why a long chat forgets how it started, and why a bigger window can take on a whole document at once.",
  ],
  [
    "Hands and feet",
    "Brilliant, but it just sits there",
    "That was the original ChatGPT: a brilliant brain to talk to that couldn't reach an inbox, a file, or the web, or take a single action. What a brain needs is hands and feet.",
  ],
  [
    "The body",
    "The harness gives it hands and feet",
    "The harness is the body built around the brain: everything that lets it reach real tools, remember, and take action.",
  ],
  [
    "So what",
    "The product is the harness, not the brain",
    "The AI tools anyone actually uses are harnesses wrapped around a model they never see, and the same brain in a better harness does dramatically more.",
  ],
  [
    "Why now",
    "The harnesses finally got good",
    "The brains were already smart a while ago; what changed in 2025 and 2026 is the harnesses got good, and that's what set agents loose.",
  ],
  [
    "Putting it together",
    "The brain gets its body",
    "The first three words built the brain; the harness gave it hands and feet. Together that's a whole body, and a brain with a body can finally go do the work.",
  ],
  [
    "The agent",
    "Brain plus body equals a worker",
    "An agent is the brain and the harness working together: it takes action, checks its own work, and keeps going until the job is done.",
  ],
  [
    "Sales",
    "Sales — the busywork, handled",
    "Point an agent at a deal and it does the steps a rep never has time for, so the rep walks in warm and follows up fast.",
  ],
  [
    "Marketing",
    "Marketing — more output, same team",
    "Hand an agent one idea and it carries it through the steps, turning a single brief into a week of content.",
  ],
  [
    "Ops and Support",
    "Ops and Support — the repetitive work, handled",
    "An agent takes the multi-step tasks that eat a team's day and runs them start to finish, with a person approving the result.",
  ],
  [
    "The lens",
    "Read any tool in five words",
    "Put any AI product on these five words and its whole story shows up: how capable it is, what it costs, how much it holds, what it can do, and whether it can act.",
  ],
  [
    "Action steps",
    "The one move this week",
    "Next time an AI tool or vendor shows up, place it on the five words and ask what its harness can actually reach and do; that one habit is what separates the people who get AI from the people who don't.",
  ],
] as const;

export const FOUNDATIONS_OF_AI_STORYBOARD: StoryboardPresentation = {
  presentationId: "foundations-of-ai-17-slide-fixture",
  generatorVersion: "canvas-skill@1.0.0",
  slides: slideCopy.map(([eyebrow, headline, body], index) => {
    const slideNumber = String(index + 1).padStart(2, "0");
    return {
      id: `slide-${slideNumber}`,
      order: index + 1,
      eyebrow,
      headline,
      body,
      cards: [],
      templateId: "foundations-editorial",
      templateVersion: "1.0.0",
      renderMode: "image" as const,
      visual: {
        kind: "image" as const,
        assetId: `slide-${slideNumber}-visual`,
      },
    };
  }),
};

const sourceGeometry: Record<string, readonly [number, number]> = {
  "slide-01": [623, 730],
  "slide-02": [240, 1551],
  "slide-03": [1005, 1551],
  "slide-04": [623, 2371],
  "slide-05": [240, 3191],
  "slide-06": [1005, 3191],
  "slide-07": [1870, 730],
  "slide-08": [2635, 730],
  "slide-09": [1870, 1463],
  "slide-10": [2635, 1463],
  "slide-11": [3500, 730],
  "slide-12": [4265, 730],
  "slide-13": [3500, 1551],
  "slide-14": [4265, 1551],
  "slide-15": [3883, 2284],
  "slide-16": [3500, 3104],
  "slide-17": [4265, 3104],
};

export const FOUNDATIONS_OF_AI_LAYOUT = {
  sourceCanvas: { width: 5240, height: 4045 },
  origins: Object.fromEntries(
    Object.entries(sourceGeometry).map(([slideId, [x, y]]) => [
      slideId,
      {
        x: Math.round(x * (1280 / 735)),
        y: Math.round(y * (720 / 703)),
      },
    ]),
  ),
};

export const FOUNDATIONS_OF_AI_ASSETS: BinaryFiles = Object.fromEntries(
  FOUNDATIONS_OF_AI_STORYBOARD.slides.map((slide) => {
    const fileId = `${slide.id}-visual` as FileId;
    return [
      fileId,
      {
        id: fileId,
        mimeType: "image/png" as const,
        dataURL:
          "data:image/png;base64,Zm91bmRhdGlvbnMtb2YtYWktZml4dHVyZQ==" as DataURL,
        created: 0,
      },
    ];
  }),
);
