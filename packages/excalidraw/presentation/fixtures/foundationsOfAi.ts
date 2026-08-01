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

export const FOUNDATIONS_OF_AI_ANIMATION_SLIDE_ORDERS = [
  2, 5, 8, 11, 14, 17,
] as const;
export const FOUNDATIONS_OF_AI_FAILURE_SLIDE_ORDER = 11;

const createProofAnimationHtml = (slideOrder: number) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#f8f7f3;font-family:Inter,system-ui,sans-serif;color:#14251f}
body{display:grid;place-items:center}.stage{position:relative;width:82%;height:70%;border:2px solid #0f5843;border-radius:24px;background:linear-gradient(135deg,#fff,#dff3e8);overflow:hidden}
.label{position:absolute;left:7%;top:10%;font:700 14px IBM Plex Mono,monospace;letter-spacing:2px;color:#0f5843}.counter{position:absolute;right:7%;top:9%;font:800 24px IBM Plex Mono,monospace}
.track{position:absolute;left:8%;right:8%;top:52%;height:4px;background:#b7d9ca}.orb{position:absolute;left:8%;top:calc(52% - 23px);width:50px;height:50px;border-radius:50%;background:#19c37d;box-shadow:0 12px 30px rgba(25,195,125,.32);transform:translateX(0) scale(.82)}
.caption{position:absolute;left:7%;bottom:10%;font-size:18px;font-weight:700}
</style></head><body><div class="stage"><div class="label">LIVE TEACHING VISUAL</div><div class="counter">0.00</div><div class="track"></div><div class="orb"></div><div class="caption">Slide ${slideOrder} · deterministic restart</div></div>
<script>(()=>{let time=0;let playing=false;let raf=0;let started=0;const orb=document.querySelector('.orb');const counter=document.querySelector('.counter');const render=()=>{const phase=(time%3)/3;orb.style.transform='translateX('+phase*520+'px) scale('+(0.82+Math.sin(phase*Math.PI)*0.25)+')';counter.textContent=time.toFixed(2)};const tick=(now)=>{if(!playing)return;if(!started)started=now;time=((now-started)/1000)%3;render();raf=requestAnimationFrame(tick)};const timeline={pause(){playing=false;cancelAnimationFrame(raf);return this},play(){if(!playing){playing=true;started=performance.now()-time*1000;raf=requestAnimationFrame(tick)}return this},time(value){if(typeof value==='number'){time=value;started=performance.now()-time*1000;render();return this}return time}};window.__timelines={proof:timeline};timeline.pause();timeline.time(0)})();</script></body></html>`;

/**
 * Reproducible stress fixture: 17 slides, six managed animations, and eleven
 * image slides. The browser proof generator can hydrate the image assets from
 * any previously generated Foundations deck.
 */
export const FOUNDATIONS_OF_AI_MIXED_STORYBOARD: StoryboardPresentation = {
  ...FOUNDATIONS_OF_AI_STORYBOARD,
  presentationId: "foundations-of-ai-mixed-animation-proof",
  slides: FOUNDATIONS_OF_AI_STORYBOARD.slides.map((slide) =>
    FOUNDATIONS_OF_AI_ANIMATION_SLIDE_ORDERS.includes(
      slide.order as typeof FOUNDATIONS_OF_AI_ANIMATION_SLIDE_ORDERS[number],
    )
      ? {
          ...slide,
          renderMode: "animation" as const,
          visual: {
            kind: "animation" as const,
            source: {
              kind: "embedded-html" as const,
              html:
                slide.order === FOUNDATIONS_OF_AI_FAILURE_SLIDE_ORDER
                  ? "<!doctype html><html><body><p>Intentional proof fixture: timeline unavailable.</p></body></html>"
                  : createProofAnimationHtml(slide.order),
            },
          },
        }
      : slide,
  ),
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
