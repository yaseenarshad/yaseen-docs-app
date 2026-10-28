import { newElement } from "@excalidraw/element";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";

import {
  SavedComponentCreationDialog,
  SavedComponentsInventory,
} from "./SavedComponents";

import type {
  CreationDialogState,
  SavedComponentSummary,
} from "./SavedComponents";

vi.mock("@excalidraw/excalidraw/components/Dialog", () => ({
  Dialog: ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));

vi.mock("@excalidraw/excalidraw/hooks/useLibraryItemSvg", () => ({
  useLibraryCache: () => ({
    svgCache: new Map(),
    deleteItemsFromLibraryCache: vi.fn(),
  }),
  useLibraryItemSvg: (
    _id: string,
    _elements: unknown,
    _cache: Map<string, SVGSVGElement>,
    ref: { current: HTMLDivElement | null },
  ) => {
    if (ref.current) {
      ref.current.textContent = "preview";
    }
  },
}));

const component: SavedComponentSummary = {
  _id: "component-1",
  _creationTime: 1_725_000_000_000,
  name: "Pricing card",
  normalizedName: "pricing card",
  elementsJson: JSON.stringify({
    type: "growprofit/saved-component",
    schemaVersion: 1,
    elements: [
      {
        id: "rectangle-1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 60,
      },
    ],
  }),
  elementCount: 1,
  schemaVersion: 1,
  createdAt: 1_725_000_000_000,
  updatedAt: 1_725_000_000_000,
};

const baseProps = {
  authState: "authenticated" as const,
  components: [component],
  query: "",
  queryStatus: "success" as const,
  queryError: null,
  canLoadMore: false,
  isLoadingMore: false,
  onQueryChange: vi.fn(),
  onRetryQuery: vi.fn(),
  onLoadMore: vi.fn(),
  canSaveSelection: true,
  onSaveSelection: vi.fn(),
  onImportJson: vi.fn(),
  onInsert: vi.fn().mockResolvedValue(undefined),
  onRename: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn().mockResolvedValue(undefined),
};

describe("SavedComponentsInventory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a searchable, accessible component inventory", async () => {
    const onQueryChange = vi.fn();
    const onSaveSelection = vi.fn();
    const onImportJson = vi.fn();
    const onInsert = vi.fn().mockResolvedValue(undefined);

    render(
      <SavedComponentsInventory
        {...baseProps}
        onQueryChange={onQueryChange}
        onSaveSelection={onSaveSelection}
        onImportJson={onImportJson}
        onInsert={onInsert}
      />,
    );

    expect(screen.getByRole("heading", { name: "Components" })).toBeVisible();
    expect(screen.getByText("1 saved component")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Insert Pricing card" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Preview of Pricing card")).toBeVisible();

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search components" }),
      { target: { value: "pricing" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save selection" }));
    fireEvent.click(screen.getByRole("button", { name: "Import JSON" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Insert Pricing card" }),
    );

    expect(onQueryChange).toHaveBeenCalledWith("pricing");
    expect(onSaveSelection).toHaveBeenCalledTimes(1);
    expect(onImportJson).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith(component));
  });

  it("disables Save selection when the canvas has no selection", () => {
    render(
      <SavedComponentsInventory {...baseProps} canSaveSelection={false} />,
    );

    expect(
      screen.getByRole("button", { name: "Save selection" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import JSON" })).toBeEnabled();
  });

  it("exposes auth, loading, empty, no-results, and retryable query states", () => {
    const { rerender } = render(
      <SavedComponentsInventory
        {...baseProps}
        authState="loading"
        components={[]}
        queryStatus="loading"
      />,
    );
    expect(screen.getByText("Connecting to your components…")).toBeVisible();

    rerender(
      <SavedComponentsInventory
        {...baseProps}
        authState="signed-out"
        components={[]}
      />,
    );
    expect(
      screen.getByText("Sign in to access your saved components."),
    ).toBeVisible();

    rerender(
      <SavedComponentsInventory {...baseProps} components={[]} query="" />,
    );
    expect(screen.getByText("No saved components yet")).toBeVisible();

    rerender(
      <SavedComponentsInventory
        {...baseProps}
        components={[]}
        query="missing"
      />,
    );
    expect(screen.getByText("No components match “missing”")).toBeVisible();

    rerender(
      <SavedComponentsInventory
        {...baseProps}
        components={[]}
        queryStatus="error"
        queryError="Components could not be loaded."
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(baseProps.onRetryQuery).toHaveBeenCalledTimes(1);
  });

  it("renames and confirms deletion without inserting the card", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const onInsert = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("Pricing card v2");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <SavedComponentsInventory
        {...baseProps}
        onRename={onRename}
        onDelete={onDelete}
        onInsert={onInsert}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Options for Pricing card" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rename Pricing card" }),
    );

    await waitFor(() =>
      expect(onRename).toHaveBeenCalledWith(component, "Pricing card v2"),
    );
    expect(onInsert).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Options for Pricing card" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Delete Pricing card" }),
    );

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(component));
    expect(window.confirm).toHaveBeenCalledWith(
      "Delete “Pricing card”? This cannot be undone.",
    );
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("retains failed mutations as retryable actions", async () => {
    const onRename = vi
      .fn()
      .mockRejectedValueOnce(new Error("Rename unavailable"))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(window, "prompt").mockReturnValue("New name");

    render(<SavedComponentsInventory {...baseProps} onRename={onRename} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Options for Pricing card" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rename Pricing card" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Rename unavailable",
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry rename" }));
    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Insert Pricing card" }),
    ).toBeVisible();
  });

  it("requires a name and saves the captured selection from its preview dialog", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const element = newElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    });

    render(
      <SavedComponentCreationDialog
        state={{
          mode: "selection",
          elements: [element],
          files: {},
          error: null,
        }}
        onStateChange={vi.fn()}
        onClose={onClose}
        onCreate={onCreate}
      />,
    );

    expect(
      screen.getByRole("dialog", {
        name: "Save selection as a component",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save component" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox", { name: "Component name" }), {
      target: { value: "Pricing CTA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save component" }));

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith("Pricing CTA", [element], {}),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves invalid imported JSON for correction and previews valid JSON", () => {
    const ImportHarness = () => {
      const [state, setState] = useState<CreationDialogState>({
        mode: "import" as const,
        source: "",
        elements: undefined,
        error: null,
      });
      return (
        <SavedComponentCreationDialog
          state={state}
          onStateChange={setState}
          onClose={vi.fn()}
          onCreate={vi.fn()}
        />
      );
    };
    render(<ImportHarness />);
    const source = screen.getByRole("textbox", { name: "Component JSON" });

    fireEvent.change(source, { target: { value: "not-json" } });
    expect(source).toHaveValue("not-json");
    expect(screen.getByRole("alert")).toHaveTextContent("Paste valid JSON");

    fireEvent.change(source, {
      target: {
        value: JSON.stringify({
          type: "excalidraw/clipboard",
          elements: [
            newElement({
              type: "rectangle",
              x: 0,
              y: 0,
              width: 100,
              height: 60,
            }),
          ],
        }),
      },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Preview of new component")).toBeVisible();
  });
});
