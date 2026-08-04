import { Excalidraw } from "@excalidraw/excalidraw";
import { render, screen } from "@excalidraw/excalidraw/tests/test-utils";

import { AppWelcomeScreen } from "./AppWelcomeScreen";

describe("AppWelcomeScreen", () => {
  it("shows only the Yaseen Whiteboard lockup in the welcome center", async () => {
    await render(
      <Excalidraw>
        <AppWelcomeScreen
          onCollabDialogOpen={() => {}}
          isCollabEnabled={true}
        />
      </Excalidraw>,
    );

    expect(
      screen.getByRole("heading", { name: "Yaseen’s Whiteboard" }),
    ).toBeVisible();
    expect(
      document.querySelector<HTMLImageElement>(
        '.yaseen-welcome-lockup__logo[src="/favicon.svg"]',
      ),
    ).not.toBeNull();

    expect(document.querySelector(".ExcalidrawLogo")).toBeNull();
    expect(document.querySelector(".welcome-screen-decor-hint")).toBeNull();
    expect(document.querySelector(".welcome-screen-menu")).toBeNull();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.queryByText("Help")).not.toBeInTheDocument();
    expect(screen.queryByText("Live collaboration")).not.toBeInTheDocument();
    expect(screen.queryByText("Sign up")).not.toBeInTheDocument();
  });
});
