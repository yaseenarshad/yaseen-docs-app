import {
  APPROVED_MILKDOWN_FEATURES,
  EXCLUDED_MILKDOWN_FEATURES,
  normalizeMarkdownInput,
} from "./milkdownFeatureConfig";

describe("Milkdown feature allowlist", () => {
  it("keeps v1 explicit and excludes the rejected scope", () => {
    expect(APPROVED_MILKDOWN_FEATURES).toEqual([
      "block-edit",
      "cursor",
      "link-tooltip",
      "list-item",
      "placeholder",
      "table",
      "toolbar",
    ]);
    expect(
      APPROVED_MILKDOWN_FEATURES.filter((feature) =>
        (EXCLUDED_MILKDOWN_FEATURES as readonly string[]).includes(feature),
      ),
    ).toEqual([]);
  });

  it("normalizes pasted CRLF and tab-indented outline Markdown", () => {
    expect(normalizeMarkdownInput("- Parent\r\n\t- Child\r\n\t\t- Third")).toBe(
      "- Parent\n  - Child\n    - Third",
    );
  });
});
