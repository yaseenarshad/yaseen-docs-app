import React from "react";

import { EXPORT_DATA_TYPES, MIME_TYPES } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "@excalidraw/element/types";

import {
  clearAppStateForDatabase,
  clearAppStateForLocalStorage,
  cleanAppStateForExport,
  getDefaultAppState,
} from "../appState";
import { Excalidraw } from "../index";
import { getResponsiveTextFontSize } from "../textCreation";

import { API } from "./helpers/api";
import { Pointer, UI } from "./helpers/ui";
import { fireEvent, render, waitFor } from "./test-utils";

const { h } = window;

describe("appState", () => {
  it("persists Writing preferences only in browser storage", () => {
    const appState = {
      ...getDefaultAppState(),
      writingMode: true,
      currentItemWritingStrokeWidth: 0.7,
    };

    expect(clearAppStateForLocalStorage(appState)).toMatchObject({
      writingMode: true,
      currentItemWritingStrokeWidth: 0.7,
    });
    for (const filtered of [
      cleanAppStateForExport(appState),
      clearAppStateForDatabase(appState),
    ]) {
      expect(filtered).not.toHaveProperty("writingMode");
      expect(filtered).not.toHaveProperty("currentItemWritingStrokeWidth");
    }
  });

  it("keeps local Writing preferences when importing fractional ink", async () => {
    await render(
      <Excalidraw
        initialData={{
          appState: {
            writingMode: true,
            currentItemWritingStrokeWidth: 0.7,
            currentItemVectorStrokeWidth: 7.5,
          },
        }}
      />,
    );

    await API.drop([
      {
        kind: "file",
        file: new Blob(
          [
            JSON.stringify({
              type: EXPORT_DATA_TYPES.excalidraw,
              appState: { viewBackgroundColor: "#fff" },
              elements: [
                API.createElement({
                  id: "imported-ink",
                  type: "freedraw",
                  strokeWidth: 0.3,
                }),
              ],
            }),
          ],
          { type: MIME_TYPES.json },
        ),
      },
    ]);

    await waitFor(() => {
      expect(h.elements).toEqual([
        expect.objectContaining({ id: "imported-ink", strokeWidth: 0.3 }),
      ]);
      expect(h.state.writingMode).toBe(true);
      expect(h.state.currentItemWritingStrokeWidth).toBe(0.7);
      expect(h.state.currentItemVectorStrokeWidth).toBe(7.5);
    });
  });

  it("drag&drop file doesn't reset non-persisted appState", async () => {
    const defaultAppState = getDefaultAppState();
    const exportBackground = !defaultAppState.exportBackground;

    await render(
      <Excalidraw
        initialData={{
          appState: {
            exportBackground,
            viewBackgroundColor: "#F00",
          },
        }}
      />,
      {},
    );

    await waitFor(() => {
      expect(h.state.exportBackground).toBe(exportBackground);
      expect(h.state.viewBackgroundColor).toBe("#F00");
    });

    await API.drop([
      {
        kind: "file",
        file: new Blob(
          [
            JSON.stringify({
              type: EXPORT_DATA_TYPES.excalidraw,
              appState: {
                viewBackgroundColor: "#000",
              },
              elements: [API.createElement({ type: "rectangle", id: "A" })],
            }),
          ],
          { type: MIME_TYPES.json },
        ),
      },
    ]);

    await waitFor(() => {
      expect(h.elements).toEqual([expect.objectContaining({ id: "A" })]);
      // non-imported prop → retain
      expect(h.state.exportBackground).toBe(exportBackground);
      // imported prop → overwrite
      expect(h.state.viewBackgroundColor).toBe("#000");
    });
  });

  it("keeps the chosen text default while free text uses responsive sizing", async () => {
    const { container } = await render(
      <Excalidraw
        initialData={{
          appState: {
            currentItemFontSize: 30,
          },
        }}
      />,
    );

    UI.clickTool("text");

    expect(h.state.currentItemFontSize).toBe(30);
    const fontSizeInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Exact font size"]',
    )!;
    fireEvent.change(fontSizeInput, { target: { value: "16" } });
    fireEvent.blur(fontSizeInput);
    expect(h.state.currentItemFontSize).toBe(16);

    const mouse = new Pointer("mouse");

    mouse.clickAt(100, 100);

    expect((h.elements[0] as ExcalidrawTextElement).fontSize).toBe(
      getResponsiveTextFontSize(h.state.zoom.value),
    );
  });
});
