import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { SavedComponentsInventory } from "./SavedComponents";

import type { SavedComponentSummary } from "./SavedComponents";

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
  onAdd: vi.fn(),
  onInsert: vi.fn(),
  onRename: vi.fn().mockResolvedValue(undefined),
  onDelete: vi.fn().mockResolvedValue(undefined),
};

describe("SavedComponentsInventory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a searchable, accessible component inventory", () => {
    const onQueryChange = vi.fn();
    const onAdd = vi.fn();
    const onInsert = vi.fn();

    render(
      <SavedComponentsInventory
        {...baseProps}
        onQueryChange={onQueryChange}
        onAdd={onAdd}
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
    fireEvent.click(screen.getByRole("button", { name: "Add component" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Insert Pricing card" }),
    );

    expect(onQueryChange).toHaveBeenCalledWith("pricing");
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(component);
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
});
