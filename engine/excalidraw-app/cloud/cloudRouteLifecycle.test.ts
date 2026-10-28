import { describe, expect, it } from "vitest";

import {
  getCloudRouteIdentity,
  isCurrentRouteCompletion,
} from "./cloudRouteLifecycle";

describe("cloud route lifecycle identity", () => {
  it("keys owners and viewers by their route-scoped durable identity", () => {
    expect(
      getCloudRouteIdentity({
        kind: "owner",
        slug: "board-a",
        isLegacyPath: false,
      }),
    ).toBe("owner:board-a");
    expect(
      getCloudRouteIdentity({
        kind: "shared",
        shareToken: "viewer-a",
      }),
    ).toBe("shared:viewer-a");
    expect(getCloudRouteIdentity({ kind: "home" })).toBe("home");
  });

  it("rejects late A completions after A→B and A→B→A generations", () => {
    const firstA = { identity: "owner:a", generation: 1 };
    const boardB = { identity: "owner:b", generation: 2 };
    const secondA = { identity: "owner:a", generation: 3 };

    expect(isCurrentRouteCompletion(firstA, boardB)).toBe(false);
    expect(isCurrentRouteCompletion(firstA, secondA)).toBe(false);
    expect(isCurrentRouteCompletion(secondA, secondA)).toBe(true);
  });
});
