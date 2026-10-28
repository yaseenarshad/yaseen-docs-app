import { CommandPalette, Excalidraw } from "@excalidraw/excalidraw";
import {
  act,
  fireEvent,
  queryByTestId,
  render,
  screen,
  toggleMenu,
  waitFor,
} from "@excalidraw/excalidraw/tests/test-utils";

import { Provider } from "../app-jotai";

import { AppMainMenu } from "./AppMainMenu";

describe("AppMainMenu", () => {
  it("keeps only self-hosted product actions and omits canvas reset", async () => {
    const { container } = await render(
      <Provider>
        <Excalidraw>
          <AppMainMenu
            onCollabDialogOpen={() => {}}
            isCollaborating={false}
            isCollabEnabled={true}
            theme="light"
            refresh={() => {}}
          />
        </Excalidraw>
      </Provider>,
    );

    toggleMenu(container);

    expect(screen.getByText("Open")).toBeVisible();
    expect(queryByTestId(container, "json-export-button")).not.toBeNull();
    expect(queryByTestId(container, "image-export-button")).not.toBeNull();
    expect(screen.getByText("Help")).toBeVisible();
    expect(queryByTestId(container, "clear-canvas-button")).toBeNull();
    expect(screen.queryByText("Excalidraw+")).not.toBeInTheDocument();
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    expect(screen.queryByText("Follow us")).not.toBeInTheDocument();
    expect(screen.queryByText("Discord")).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign (in|up)/)).not.toBeInTheDocument();
  });

  it("omits canvas reset from the command palette when disabled", async () => {
    await render(
      <Excalidraw UIOptions={{ canvasActions: { clearCanvas: false } }}>
        <CommandPalette />
      </Excalidraw>,
    );

    act(() => {
      window.h.app.setState({
        openDialog: { name: "commandPalette" },
      });
    });

    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(
          "Search menus, commands, and discover hidden gems",
        ),
      ).toBeVisible(),
    );
    await waitFor(() => expect(screen.getByText("Zoom in")).toBeVisible());
    expect(screen.queryByText("Clear canvas")).not.toBeInTheDocument();

    act(() => {
      window.h.app.setState({ openDialog: null });
    });
    fireEvent.keyDown(document, {
      key: "Delete",
      ctrlKey: true,
      metaKey: true,
    });
    expect(
      screen.queryByText("This will clear the whole canvas. Are you sure?"),
    ).not.toBeInTheDocument();
  });
});
