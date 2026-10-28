import { describe, expect, it } from "vitest";

import { actionToggleSearchMenu } from "./actionToggleSearchMenu";

describe("actionToggleSearchMenu", () => {
  it("keeps canvas search available without owning Cmd/Ctrl+F", () => {
    expect(actionToggleSearchMenu.keyTest).toBeUndefined();
    expect(actionToggleSearchMenu.perform).toBeTypeOf("function");
  });
});
