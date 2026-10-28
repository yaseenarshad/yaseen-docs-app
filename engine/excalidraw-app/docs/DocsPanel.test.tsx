import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { DocsPanel } from "./DocsPanel";

import type { DocFolderSummary, DocLibrarySummary } from "./DocsPanel";

const folders: DocFolderSummary[] = [
  { _id: "folder-1", name: "Projects", createdAt: 1, updatedAt: 1 },
];

const docs: DocLibrarySummary[] = [
  {
    _id: "doc-unfiled",
    title: "Inbox",
    lifecycle: "active",
    createdAt: 1,
    updatedAt: 2,
  },
  {
    _id: "doc-project",
    title: "Launch plan",
    folderId: "folder-1",
    lifecycle: "active",
    createdAt: 2,
    updatedAt: 3,
  },
];

const createProps = () => ({
  docs,
  folders,
  isLoading: false,
  isLoadingMore: false,
  canLoadMore: false,
  errorMessage: null,
  search: "",
  sort: "modified-desc" as const,
  onSearchChange: vi.fn(),
  onSortChange: vi.fn(),
  onLoadMore: vi.fn(),
  onCreate: vi.fn().mockResolvedValue({
    docId: "doc-new",
    title: "Untitled Doc",
  }),
  onCreateFolder: vi.fn().mockResolvedValue(undefined),
  onRename: vi.fn().mockResolvedValue(undefined),
  onRenameFolder: vi.fn().mockResolvedValue(undefined),
  onDeleteFolder: vi.fn().mockResolvedValue(undefined),
  onMove: vi.fn().mockResolvedValue(undefined),
  onActivate: vi.fn(),
});

describe("DocsPanel", () => {
  beforeEach(() => window.localStorage.clear());

  it("groups Docs, searches, sorts, and activates a Doc", () => {
    const props = createProps();
    render(<DocsPanel {...props} />);

    expect(screen.getByText("Unfiled", { selector: "strong" })).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Rename folder Projects" }),
    ).toBeVisible();
    expect(screen.getByDisplayValue("Inbox")).toBeVisible();
    expect(screen.getByDisplayValue("Launch plan")).toBeVisible();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search Docs" }), {
      target: { value: "launch" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort Docs" }), {
      target: { value: "name-asc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open Launch plan" }));

    expect(props.onSearchChange).toHaveBeenCalledWith("launch");
    expect(props.onSortChange).toHaveBeenCalledWith("name-asc");
    expect(props.onActivate).toHaveBeenCalledWith("doc-project", "Launch plan");
  });

  it("focuses and selects a newly created Doc title after the query adds it", async () => {
    const props = createProps();
    const { rerender } = render(<DocsPanel {...props} docs={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "New Doc" }));
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onActivate).toHaveBeenCalledWith("doc-new", "Untitled Doc");

    rerender(
      <DocsPanel
        {...props}
        docs={[
          {
            _id: "doc-new",
            title: "Untitled Doc",
            lifecycle: "active",
            createdAt: 4,
            updatedAt: 4,
          },
        ]}
      />,
    );

    const title = await screen.findByRole("textbox", {
      name: "Rename Untitled Doc",
    });
    await waitFor(() => expect(title).toHaveFocus());
    expect((title as HTMLInputElement).selectionStart).toBe(0);
    expect((title as HTMLInputElement).selectionEnd).toBe(
      "Untitled Doc".length,
    );
  });

  it("preserves a rejected rename draft and surfaces the conflict", async () => {
    const props = createProps();
    props.onRename.mockRejectedValue(
      new Error("A Doc with that title already exists in this folder"),
    );
    render(<DocsPanel {...props} />);

    const title = screen.getByRole("textbox", { name: "Rename Inbox" });
    fireEvent.change(title, { target: { value: "Launch plan" } });
    fireEvent.blur(title);

    expect(
      await screen.findByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent("A Doc with that title already exists in this folder");
    expect(title).toHaveValue("Launch plan");
  });

  it("moves Docs with an accessible selector and folder drop target", async () => {
    const props = createProps();
    render(<DocsPanel {...props} />);

    fireEvent.change(screen.getByRole("combobox", { name: "Move Inbox" }), {
      target: { value: "folder-1" },
    });
    await waitFor(() =>
      expect(props.onMove).toHaveBeenCalledWith("doc-unfiled", "folder-1"),
    );

    const values = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      types: ["application/x-yaseendraw-doc-id"],
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? "",
    };
    const launchDoc = screen.getByDisplayValue("Launch plan").closest("li");
    const unfiled = screen
      .getByText("Unfiled", { selector: "strong" })
      .closest("section");
    expect(launchDoc).not.toBeNull();
    expect(unfiled).not.toBeNull();

    fireEvent.dragStart(launchDoc!, { dataTransfer });
    fireEvent.dragOver(unfiled!, { dataTransfer });
    fireEvent.drop(unfiled!, { dataTransfer });

    await waitFor(() =>
      expect(props.onMove).toHaveBeenCalledWith("doc-project", null),
    );
  });

  it("moves Docs to Trash and exposes restore/delete-forever recovery", async () => {
    const props = {
      ...createProps(),
      trashDocs: [
        {
          _id: "doc-trashed",
          title: "Former plan",
          lifecycle: "trashed" as const,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      onTrash: vi.fn().mockResolvedValue(undefined),
      onRestore: vi.fn().mockResolvedValue(undefined),
      onDeleteForever: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<DocsPanel {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Move Inbox to Trash" }),
    );
    await waitFor(() =>
      expect(props.onTrash).toHaveBeenCalledWith("doc-unfiled"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Trash (1)" }));
    const trashTitle = screen.getByText("Former plan");
    expect(trashTitle).toHaveClass("docs-panel__trash-title");
    expect(trashTitle.closest("li")).toHaveClass("docs-panel__trash-item");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => {
      expect(props.onRestore).toHaveBeenCalledWith("doc-trashed");
      expect(props.onDeleteForever).toHaveBeenCalledWith("doc-trashed");
    });
  });
});
