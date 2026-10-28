import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";

import { CloudLoginGate, CloudProfile } from "./CloudAccount";

describe("CloudLoginGate", () => {
  it("signs in with Bitwarden-friendly username and password fields", async () => {
    const onAuthenticate = vi.fn().mockResolvedValue(undefined);

    render(<CloudLoginGate onAuthenticate={onAuthenticate} />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "yaseen" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password-from-the-user" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open boards" }));

    await waitFor(() => {
      expect(onAuthenticate).toHaveBeenCalledWith({
        username: "yaseen",
        password: "password-from-the-user",
        flow: "signIn",
      });
    });

    expect(screen.queryByRole("button", { name: "Yaseen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Trevor" })).toBeNull();
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "autocomplete",
      "username",
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("can create a fixed account when local development enables it", async () => {
    const onAuthenticate = vi.fn().mockResolvedValue(undefined);

    render(
      <CloudLoginGate allowAccountCreation onAuthenticate={onAuthenticate} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create local account" }),
    );
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "yaseen" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "local-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(onAuthenticate).toHaveBeenCalledWith({
        username: "yaseen",
        password: "local-password",
        flow: "signUp",
      });
    });
  });

  it("does not offer account creation by default", () => {
    render(<CloudLoginGate onAuthenticate={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "Create local account" }),
    ).toBeNull();
  });
});

describe("CloudProfile", () => {
  const renderProfile = (props?: { menuItems?: React.ReactNode }) =>
    render(
      <CloudProfile
        username="yaseen"
        onSignOut={vi.fn().mockResolvedValue(undefined)}
        menuItems={props?.menuItems}
      />,
    );

  it("uses an icon-only profile trigger", () => {
    renderProfile();

    const trigger = screen.getByRole("button", { name: "Yaseen profile" });
    expect(trigger).toHaveTextContent(/^Y$/);
    expect(trigger).not.toHaveTextContent("Yaseen");
  });

  it("shows the active profile and signs out", async () => {
    const onSignOut = vi.fn().mockResolvedValue(undefined);

    render(<CloudProfile username="yaseen" onSignOut={onSignOut} />);

    fireEvent.click(screen.getByRole("button", { name: "Yaseen profile" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => {
      expect(onSignOut).toHaveBeenCalledTimes(1);
    });
  });

  it("hosts editor commands in the profile menu", () => {
    renderProfile({ menuItems: <div>Editor settings</div> });

    fireEvent.click(screen.getByRole("button", { name: "Yaseen profile" }));

    expect(screen.getByText("Editor settings")).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  });

  it("closes the profile menu when clicking outside", async () => {
    renderProfile({ menuItems: <div>Editor settings</div> });

    fireEvent.click(screen.getByRole("button", { name: "Yaseen profile" }));
    expect(screen.getByText("Editor settings")).toBeVisible();

    fireEvent.pointerDown(document.body);

    await waitFor(() =>
      expect(screen.queryByText("Editor settings")).not.toBeInTheDocument(),
    );
  });
});
