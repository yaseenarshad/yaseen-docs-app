import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import { getNormalizedZoom } from "@excalidraw/excalidraw/scene";
import { newElement } from "@excalidraw/element";

import {
  getCloudSceneRevision,
  isSameCloudRoute,
  preserveCloudViewport,
  resolveCloudViewport,
  shouldApplyCloudScene,
  shouldSuppressCloudSceneSaveForAppliedRevision,
} from "./cloudSceneSync";
import * as cloudSceneSync from "./cloudSceneSync";

describe("cloud scene synchronization", () => {
  it("recognizes a delayed onChange echo without suppressing a newer local revision", () => {
    const appliedElements = [
      { id: "shape", version: 2, versionNonce: 20, isDeleted: false },
      { id: "deleted", version: 4, versionNonce: 40, isDeleted: true },
    ];
    const appliedRevision = getCloudSceneRevision(appliedElements);

    expect(
      shouldSuppressCloudSceneSaveForAppliedRevision(
        appliedRevision,
        appliedElements.map((element) => ({ ...element })),
      ),
    ).toBe(true);
    expect(
      shouldSuppressCloudSceneSaveForAppliedRevision(appliedRevision, [
        { ...appliedElements[0], version: 3, versionNonce: 30 },
        appliedElements[1],
      ]),
    ).toBe(false);
    expect(
      shouldSuppressCloudSceneSaveForAppliedRevision(
        appliedRevision,
        [...appliedElements].reverse(),
      ),
    ).toBe(false);
  });

  it("keeps suppressing repeated binding-repair echoes until a semantic change occurs", () => {
    const getCloudSceneSemanticRevision = (
      cloudSceneSync as Record<string, unknown>
    ).getCloudSceneSemanticRevision;
    const classifyAppliedCloudSceneChange = (
      cloudSceneSync as Record<string, unknown>
    ).classifyAppliedCloudSceneChange;

    expect(typeof getCloudSceneSemanticRevision).toBe("function");
    expect(typeof classifyAppliedCloudSceneChange).toBe("function");
    if (
      typeof getCloudSceneSemanticRevision !== "function" ||
      typeof classifyAppliedCloudSceneChange !== "function"
    ) {
      return;
    }

    const serverScene = JSON.stringify({
      elements: [
        {
          id: "container",
          type: "rectangle",
          version: 4,
          versionNonce: 40,
          boundElements: [{ id: "label", type: "text" }],
        },
        {
          id: "label",
          type: "text",
          version: 2,
          versionNonce: 20,
          containerId: "container",
        },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });
    const repairedEcho = JSON.stringify({
      elements: [
        {
          id: "container",
          type: "rectangle",
          version: 4,
          versionNonce: 40,
          boundElements: [],
        },
        {
          id: "label",
          type: "text",
          version: 2,
          versionNonce: 20,
          containerId: "container",
        },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });
    const appStateEdit = JSON.stringify({
      ...JSON.parse(repairedEcho),
      appState: { viewBackgroundColor: "#f5f5f5" },
    });
    const appliedRevision = getCloudSceneSemanticRevision(serverScene);

    expect(getCloudSceneSemanticRevision(repairedEcho)).toBe(appliedRevision);
    expect(
      classifyAppliedCloudSceneChange(appliedRevision, repairedEcho),
    ).toEqual({
      suppress: true,
      nextAppliedRevision: appliedRevision,
    });
    expect(
      classifyAppliedCloudSceneChange(appliedRevision, repairedEcho),
    ).toEqual({
      suppress: true,
      nextAppliedRevision: appliedRevision,
    });
    expect(
      classifyAppliedCloudSceneChange(appliedRevision, appStateEdit),
    ).toEqual({
      suppress: false,
      nextAppliedRevision: null,
    });
  });

  it("detects a reconciled element that is newer than the server echo", () => {
    const hasUnpersistedCloudElements = (
      cloudSceneSync as Record<string, unknown>
    ).hasUnpersistedCloudElements;

    expect(typeof hasUnpersistedCloudElements).toBe("function");
    if (typeof hasUnpersistedCloudElements !== "function") {
      return;
    }
    expect(
      hasUnpersistedCloudElements(
        [{ id: "shape", version: 3, versionNonce: 30 }],
        [{ id: "shape", version: 2, versionNonce: 20 }],
      ),
    ).toBe(true);
    expect(
      hasUnpersistedCloudElements(
        [{ id: "shape", version: 2, versionNonce: 20 }],
        [{ id: "shape", version: 2, versionNonce: 20 }],
      ),
    ).toBe(false);
  });

  it("applies a newer server version for an owner route", () => {
    expect(
      shouldApplyCloudScene(
        { routeKey: "owner:board", version: 10 },
        { routeKey: "owner:board", version: 11 },
      ),
    ).toBe(true);
  });

  it("does not reapply the same route and version", () => {
    expect(
      shouldApplyCloudScene(
        { routeKey: "owner:board", version: 11 },
        { routeKey: "owner:board", version: 11 },
      ),
    ).toBe(false);
  });

  it("distinguishes a route change from a same-route update", () => {
    expect(
      isSameCloudRoute({ routeKey: "owner:first", version: 4 }, "owner:first"),
    ).toBe(true);
    expect(
      isSameCloudRoute({ routeKey: "owner:first", version: 4 }, "owner:second"),
    ).toBe(false);
    expect(isSameCloudRoute(null, "owner:first")).toBe(false);
  });

  it("identifies same-route owner and shared refreshes independently of access", () => {
    expect(
      isSameCloudRoute({ routeKey: "owner:first", version: 4 }, "owner:first"),
    ).toBe(true);
    expect(
      isSameCloudRoute(
        { routeKey: "shared:token", version: 4 },
        "shared:token",
      ),
    ).toBe(true);
    expect(
      isSameCloudRoute({ routeKey: "owner:first", version: 4 }, "owner:second"),
    ).toBe(false);
    expect(isSameCloudRoute(null, "shared:token")).toBe(false);
  });

  it("preserves the local viewport when merging a same-route cloud update", () => {
    const restoredAppState = {
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 as const },
      viewModeEnabled: false,
    };
    const localAppState = {
      scrollX: -420,
      scrollY: 180,
      zoom: { value: 1.6 as const },
    };

    expect(
      preserveCloudViewport(restoredAppState, localAppState, true),
    ).toEqual({
      ...restoredAppState,
      ...localAppState,
    });
  });

  it("fits fresh route content using the live viewport without zooming past 100%", () => {
    const localAppState = {
      ...getDefaultAppState(),
      width: 900,
      height: 600,
      offsetLeft: 80,
      offsetTop: 40,
      scrollX: 700,
      scrollY: -300,
      zoom: { value: getNormalizedZoom(0.8) },
    };
    const restoredAppState = {
      ...localAppState,
      width: 120,
      height: 80,
      scrollX: -10_000,
      scrollY: 8_000,
      zoom: { value: 1.5 as const },
      viewModeEnabled: true,
    };
    const elements = [
      newElement({
        type: "rectangle",
        x: 1_000,
        y: 500,
        width: 200,
        height: 100,
      }),
    ];

    const resolved = resolveCloudViewport(
      restoredAppState,
      localAppState,
      elements,
      false,
    );

    expect(resolved.zoom.value).toBe(1);
    expect(resolved.scrollX).toBeCloseTo(900 / 2 - 1_100);
    expect(resolved.scrollY).toBeCloseTo(600 / 2 - 550);
    expect(resolved.viewModeEnabled).toBe(true);
  });

  it("zooms out until every item fits on a fresh route", () => {
    const localAppState = {
      ...getDefaultAppState(),
      width: 900,
      height: 600,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const restoredAppState = {
      ...localAppState,
      scrollX: -10_000,
      scrollY: 8_000,
      zoom: { value: 1.5 as const },
    };
    const elements = [
      newElement({
        type: "rectangle",
        x: 1_000,
        y: 500,
        width: 1_800,
        height: 1_200,
      }),
    ];

    const resolved = resolveCloudViewport(
      restoredAppState,
      localAppState,
      elements,
      false,
    );

    expect(resolved.zoom.value).toBeCloseTo(0.5);
    expect(resolved.scrollX).toBeCloseTo(900 / 2 / 0.5 - 1_900);
    expect(resolved.scrollY).toBeCloseTo(600 / 2 / 0.5 - 1_100);
  });

  it("opens an empty fresh route at the origin and default zoom", () => {
    const localAppState = {
      ...getDefaultAppState(),
      width: 900,
      height: 600,
      offsetLeft: 0,
      offsetTop: 0,
    };
    const restoredAppState = {
      ...localAppState,
      scrollX: -10_000,
      scrollY: 8_000,
      zoom: { value: 1.5 as const },
    };

    expect(
      resolveCloudViewport(restoredAppState, localAppState, [], false),
    ).toMatchObject({
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
    });
  });

  it("preserves a live viewport on same-route owner or shared updates", () => {
    const localAppState = {
      ...getDefaultAppState(),
      width: 900,
      height: 600,
      offsetLeft: 0,
      offsetTop: 0,
      scrollX: -420,
      scrollY: 180,
      zoom: { value: getNormalizedZoom(1.6) },
    };
    const restoredAppState = {
      ...localAppState,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 as const },
    };
    const farAwayElement = newElement({
      type: "rectangle",
      x: 10_000,
      y: 10_000,
      width: 200,
      height: 100,
    });

    expect(
      resolveCloudViewport(
        restoredAppState,
        localAppState,
        [farAwayElement],
        true,
      ),
    ).toMatchObject({
      scrollX: localAppState.scrollX,
      scrollY: localAppState.scrollY,
      zoom: localAppState.zoom,
    });
  });
});
