import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";

import { createMilkdownAdapter } from "./milkdownAdapter";

const CANONICAL_MARKDOWN = `# Doc title

Paragraph with **bold**, _emphasis_, [a link](https://example.com), and ~~strike~~.

> A blockquote

- Parent
  - Child
- [x] Complete
- [ ] Pending

1. First
2. Second

| Name | Value |
| --- | --- |
| Alpha | One |

\`\`\`ts
const answer = 42;
\`\`\`

---
`;

const MILKDOWN_NORMALIZED_MARKDOWN = `# Doc title

Paragraph with **bold**, _emphasis_, [a link](https://example.com), and ~~strike~~.

> A blockquote

* Parent
  * Child
* [x] Complete
* [ ] Pending

1. First
2. Second

| Name  | Value |
| ----- | ----- |
| Alpha | One   |

\`\`\`ts
const answer = 42;
\`\`\`

***

`;

describe("createMilkdownAdapter", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        disconnect() {}
        observe() {}
        takeRecords() {
          return [];
        }
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("round-trips the approved canonical Markdown through Crepe", async () => {
    const root = document.createElement("div");
    document.body.append(root);

    const editor = await createMilkdownAdapter({
      root,
      markdown: CANONICAL_MARKDOWN,
    });

    expect(editor.getMarkdown()).toBe(MILKDOWN_NORMALIZED_MARKDOWN);

    await editor.destroy();
    expect(root).toBeEmptyDOMElement();
  }, 15_000);

  it("publishes Markdown changes and can be destroyed more than once", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const onMarkdownChange = vi.fn();
    const editor = await createMilkdownAdapter({
      root,
      markdown: "# Before",
      onMarkdownChange,
    });

    editor.replaceMarkdown("# After");

    expect(editor.getMarkdown()).toBe("# After\n");
    await vi.waitFor(() =>
      expect(onMarkdownChange).toHaveBeenLastCalledWith("# After\n"),
    );

    await editor.destroy();
    await editor.destroy();
    expect(root).toBeEmptyDOMElement();
  });

  it("normalizes an outdented third-level item back to valid second-level Markdown", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const editor = await createMilkdownAdapter({
      root,
      markdown:
        "* Parent\n  * Second\n    * Third\n  * And then\n\n1. Ordered\n   1. Child\n",
    });

    expect(editor.getMarkdown()).toContain(
      "* Parent\n  * Second\n    * Third\n  * And then",
    );
    expect(editor.getMarkdown()).toContain("1. Ordered\n   1. Child");
    await editor.destroy();
  });

  it("folds only a parent list item's subtree without changing Markdown", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const markdown = `* Parent
  * Child
    * Grandchild
* Leaf

1. Ordered parent
   1. Ordered child

* [ ] Task parent
  * Task child
`;
    const editor = await createMilkdownAdapter({ root, markdown });
    const queries = within(root);

    expect(
      queries.queryByRole("button", { name: "Collapse Leaf" }),
    ).not.toBeInTheDocument();
    const parentToggle = queries.getByRole("button", {
      name: "Collapse Parent",
    });
    expect(parentToggle).toHaveAttribute("aria-expanded", "true");

    const beforeFold = editor.getMarkdown();
    fireEvent.click(parentToggle);

    expect(
      queries.getByRole("button", { name: "Expand Parent" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      root.querySelector("[data-yaseendraw-outline-folded='true']"),
    ).not.toBe(null);
    expect(editor.getMarkdown()).toBe(beforeFold);

    await editor.destroy();
  });

  it("restores per-placement outline folds from stable keys", async () => {
    const markdown = "* Parent\n  * Child\n";
    const firstRoot = document.createElement("div");
    document.body.append(firstRoot);
    const onCollapsedOutlineKeysChange = vi.fn();
    const firstEditor = await createMilkdownAdapter({
      root: firstRoot,
      markdown,
      onCollapsedOutlineKeysChange,
    });
    const firstToggle = within(firstRoot).getByRole("button", {
      name: "Collapse Parent",
    });
    const foldKey = firstToggle.dataset.outlineFoldKey;
    expect(foldKey).toBeTruthy();

    fireEvent.click(firstToggle);
    await vi.waitFor(() =>
      expect(onCollapsedOutlineKeysChange).toHaveBeenLastCalledWith([foldKey]),
    );
    await firstEditor.destroy();

    const secondRoot = document.createElement("div");
    document.body.append(secondRoot);
    const secondEditor = await createMilkdownAdapter({
      root: secondRoot,
      markdown,
      collapsedOutlineKeys: new Set([foldKey!]),
    });

    expect(
      within(secondRoot).getByRole("button", { name: "Expand Parent" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(secondEditor.getMarkdown()).toBe(firstEditor.getMarkdown());

    await secondEditor.destroy();
  });

  it("mounts and round-trips a 1,000-item outline", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const markdown = Array.from({ length: 250 }, (_, parent) =>
      [
        `* Parent ${parent}`,
        `  * Child ${parent}.1`,
        `  * Child ${parent}.2`,
        `  * Child ${parent}.3`,
      ].join("\n"),
    ).join("\n");

    const editor = await createMilkdownAdapter({ root, markdown });

    expect(editor.getMarkdown()).toContain("* Parent 249\n  * Child 249.1");
    expect(
      within(root).getAllByRole("button", { name: /Collapse Parent/ }),
    ).toHaveLength(250);
    await editor.destroy();
  }, 30_000);
});
