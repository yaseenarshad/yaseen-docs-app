import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocEmbeddable } from "./DocEmbeddable";

import type { MilkdownAdapter } from "./milkdownAdapter";

const makeEditor = (): MilkdownAdapter => ({
  destroy: vi.fn().mockResolvedValue(undefined),
  getMarkdown: vi.fn().mockReturnValue("# Doc"),
  replaceMarkdown: vi.fn(),
  setReadonly: vi.fn(),
  insertFiles: vi.fn().mockResolvedValue(undefined),
});

describe("DocEmbeddable", () => {
  it("groups the title and controls so narrow cards can wrap without clipping the editor", () => {
    const { container } = render(
      <DocEmbeddable
        active={false}
        title="A very long strategy title"
        markdown="# Strategy"
        saveStatus="conflict"
        onMarkdownChange={vi.fn()}
        onLoadLatest={vi.fn()}
        onSaveDraftAsNew={vi.fn()}
      />,
    );

    const header = container.querySelector(
      ".yaseendraw-doc-embeddable__header",
    );
    const title = header?.querySelector(".yaseendraw-doc-embeddable__title");
    const actions = header?.querySelector(
      ".yaseendraw-doc-embeddable__actions",
    );

    expect(title).toHaveTextContent("A very long strategy title");
    expect(actions).toContainElement(
      screen.getByRole("button", {
        name: "Copy A very long strategy title Markdown",
      }),
    );
    expect(actions).toContainElement(
      screen.getByRole("button", { name: "Download .md" }),
    );
    expect(actions).toContainElement(screen.getByText("Conflict"));
  });

  it("stays static until active and destroys the editor on deactivation", async () => {
    const editor = makeEditor();
    const createEditor = vi.fn().mockResolvedValue(editor);
    const { rerender } = render(
      <DocEmbeddable
        active={false}
        title="Strategy"
        markdown="# Strategy"
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );

    expect(screen.getByLabelText("Strategy preview")).toBeVisible();
    expect(createEditor).not.toHaveBeenCalled();

    rerender(
      <DocEmbeddable
        active={true}
        title="Strategy"
        markdown="# Strategy"
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );

    await waitFor(() => expect(createEditor).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Editing Strategy")).toBeVisible();

    rerender(
      <DocEmbeddable
        active={false}
        title="Strategy"
        markdown="# Strategy"
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );

    await waitFor(() => expect(editor.destroy).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Strategy preview")).toBeVisible();
  });

  it("destroys a late editor when activation ends before loading finishes", async () => {
    const editor = makeEditor();
    let resolveEditor: ((value: MilkdownAdapter) => void) | undefined;
    const createEditor = vi.fn().mockReturnValue(
      new Promise<MilkdownAdapter>((resolve) => {
        resolveEditor = resolve;
      }),
    );
    const { rerender } = render(
      <DocEmbeddable
        active={true}
        title="Strategy"
        markdown="# Strategy"
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );

    rerender(
      <DocEmbeddable
        active={false}
        title="Strategy"
        markdown="# Strategy"
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );
    resolveEditor?.(editor);

    await waitFor(() => expect(editor.destroy).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Strategy preview")).toBeVisible();
  });

  it("makes viewer activation read-only and flushes Markdown before destroy", async () => {
    const editor = makeEditor();
    vi.mocked(editor.getMarkdown).mockReturnValue("latest local Markdown");
    const onDeactivate = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <DocEmbeddable
        active
        readonly
        title="Strategy"
        markdown="# Strategy"
        onMarkdownChange={vi.fn()}
        onDeactivate={onDeactivate}
        createEditor={vi.fn().mockResolvedValue(editor)}
      />,
    );

    await waitFor(() => expect(editor.setReadonly).toHaveBeenCalledWith(true));
    rerender(
      <DocEmbeddable
        active={false}
        readonly
        title="Strategy"
        markdown="# Strategy"
        onMarkdownChange={vi.fn()}
        onDeactivate={onDeactivate}
        createEditor={vi.fn().mockResolvedValue(editor)}
      />,
    );

    await waitFor(() =>
      expect(onDeactivate).toHaveBeenCalledWith("latest local Markdown"),
    );
    await waitFor(() => expect(editor.destroy).toHaveBeenCalledTimes(1));
    expect(onDeactivate.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(editor.destroy).mock.invocationCallOrder[0],
    );
  });

  it("keeps the React preview separate while Milkdown teardown finishes", async () => {
    const editor = makeEditor();
    let editorRoot: HTMLElement | null = null;
    let finishDeactivation: (() => void) | undefined;
    const onDeactivate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDeactivation = resolve;
        }),
    );
    const createEditor = vi.fn(async ({ root }: { root: HTMLElement }) => {
      editorRoot = root;
      vi.mocked(editor.destroy).mockImplementation(async () => {
        editorRoot?.replaceChildren();
      });
      return editor;
    });
    const props = {
      title: "Strategy",
      markdown: "# Strategy",
      onMarkdownChange: vi.fn(),
      onDeactivate,
      createEditor,
    };
    const { rerender } = render(<DocEmbeddable {...props} active />);

    await waitFor(() => expect(createEditor).toHaveBeenCalledTimes(1));
    const editorHost = screen.getByLabelText("Editing Strategy");
    rerender(<DocEmbeddable {...props} active={false} />);

    const preview = screen.getByLabelText("Strategy preview");
    expect(preview).not.toBe(editorHost);
    finishDeactivation?.();
    await waitFor(() => expect(editor.destroy).toHaveBeenCalledTimes(1));
    expect(preview).toHaveTextContent("Strategy");
  });

  it("renders lightweight loading, empty, error, and deleted static states", () => {
    const createEditor = vi.fn();
    const { rerender } = render(
      <DocEmbeddable
        active={false}
        title="Strategy"
        status="loading"
        markdown=""
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );
    expect(screen.getByText("Loading Doc…")).toBeVisible();

    rerender(
      <DocEmbeddable
        active={false}
        title="Strategy"
        status="empty"
        markdown=""
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );
    expect(screen.getByText("Start writing…")).toBeVisible();

    rerender(
      <DocEmbeddable
        active={false}
        title="Strategy"
        status="error"
        markdown=""
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );
    expect(screen.getByText("Doc unavailable")).toBeVisible();

    rerender(
      <DocEmbeddable
        active={true}
        title="Strategy"
        status="deleted"
        markdown=""
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );
    expect(screen.getByText("“Strategy” was deleted")).toBeVisible();
    expect(createEditor).not.toHaveBeenCalled();
  });

  it("renders Markdown structure without mounting Milkdown while static", () => {
    const createEditor = vi.fn();
    render(
      <DocEmbeddable
        active={false}
        title="Strategy"
        status="ready"
        markdown={"## Plan\n\n- First\n  - Nested\n\nFinish"}
        onMarkdownChange={vi.fn()}
        createEditor={createEditor}
      />,
    );

    expect(screen.getByRole("heading", { name: "Plan" })).toBeVisible();
    expect(screen.getByText("First")).toBeVisible();
    expect(screen.getByText("Nested")).toBeVisible();
    expect(screen.getByText("Finish")).toBeVisible();
    expect(createEditor).not.toHaveBeenCalled();
  });

  it("mirrors parent-subtree folding in the static renderer", () => {
    const onCollapsedOutlineKeysChange = vi.fn();
    const { rerender } = render(
      <DocEmbeddable
        active={false}
        title="Outline"
        markdown={"* Parent\n  * Child\n    * Grandchild\n* Leaf\n"}
        collapsedOutlineKeys={new Set()}
        onCollapsedOutlineKeysChange={onCollapsedOutlineKeysChange}
        onMarkdownChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse Parent" }));
    const [key] = onCollapsedOutlineKeysChange.mock.calls[0][0];
    rerender(
      <DocEmbeddable
        active={false}
        title="Outline"
        markdown={"* Parent\n  * Child\n    * Grandchild\n* Leaf\n"}
        collapsedOutlineKeys={new Set([key])}
        onCollapsedOutlineKeysChange={onCollapsedOutlineKeysChange}
        onMarkdownChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Expand Parent" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Child")).toBeNull();
    expect(screen.queryByText("Grandchild")).toBeNull();
    expect(screen.getByText("Leaf")).toBeVisible();
  });

  it("keeps approved formatting, links, code, quotes, rules, and tables in static parity", () => {
    render(
      <DocEmbeddable
        active={false}
        title="Formatted"
        markdown={
          "**Bold** and [safe](https://example.com) and `code`\n\n> Quote\n\n| A | B |\n| --- | --- |\n| One | Two |\n\n```ts\nconst x = 1;\n```\n\n---\n"
        }
        onMarkdownChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Bold", { selector: "strong" })).toBeVisible();
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(screen.getByText("Quote").closest("blockquote")).not.toBeNull();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("const x = 1;")).toBeVisible();
  });
});
