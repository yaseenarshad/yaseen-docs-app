import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
});

for (const [name, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLCanvasElement: dom.window.HTMLCanvasElement,
  HTMLImageElement: dom.window.HTMLImageElement,
  Image: dom.window.Image,
  localStorage: dom.window.localStorage,
})) {
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

Object.defineProperty(globalThis, "devicePixelRatio", {
  configurable: true,
  value: 1,
});
Object.defineProperty(dom.window, "devicePixelRatio", {
  configurable: true,
  value: 1,
});
