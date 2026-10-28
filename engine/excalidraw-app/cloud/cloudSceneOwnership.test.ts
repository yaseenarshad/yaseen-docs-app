import { describe, expect, it } from "vitest";

import {
  cloudRouteOwnsScene,
  selectInitialLocalElements,
  shouldRunLocalSceneSync,
} from "./cloudSceneOwnership";

describe("cloud scene ownership gate", () => {
  it("gives owner and viewer Board routes sole scene authority", () => {
    expect(
      cloudRouteOwnsScene({
        kind: "owner",
        slug: "one",
        isLegacyPath: false,
      }),
    ).toBe(true);
    expect(
      cloudRouteOwnsScene({
        kind: "shared",
        shareToken: "viewer-token",
      }),
    ).toBe(true);
    expect(cloudRouteOwnsScene({ kind: "home" })).toBe(false);
  });

  it("does not bootstrap origin-global elements into a cloud route", () => {
    const localElements = [{ id: "from-another-tab" }];

    expect(selectInitialLocalElements(localElements, true)).toEqual([]);
    expect(selectInitialLocalElements(localElements, false)).toBe(
      localElements,
    );
  });

  it("blocks local writes and rehydration on cloud routes but preserves local behavior elsewhere", () => {
    expect(
      shouldRunLocalSceneSync({
        routeOwnsScene: true,
        documentHidden: false,
        collaborationActive: false,
      }),
    ).toBe(false);
    expect(
      shouldRunLocalSceneSync({
        routeOwnsScene: false,
        documentHidden: false,
        collaborationActive: false,
      }),
    ).toBe(true);
    expect(
      shouldRunLocalSceneSync({
        routeOwnsScene: false,
        documentHidden: true,
        collaborationActive: false,
      }),
    ).toBe(false);
    expect(
      shouldRunLocalSceneSync({
        routeOwnsScene: false,
        documentHidden: false,
        collaborationActive: true,
      }),
    ).toBe(false);
  });
});
