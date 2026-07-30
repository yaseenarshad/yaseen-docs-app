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
});

describe("CloudProfile", () => {
  it("uses an icon-only profile trigger", () => {
    render(<CloudProfile username="yaseen" onSignOut={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: "Yaseen profile" });
    expect(trigger).toHaveTextContent(/^Y$/);
    expect(trigger).not.toHaveTextContent("Yaseen");
  });

  it("shows the active profile and signs out", async () => {
    const onSignOut = vi.fn().mockResolvedValue(undefined);

    render(<CloudProfile username="yaseen" onSignOut={onSignOut} />);

    fireEvent.click(screen.getByRole("button", { name: "Yaseen profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(onSignOut).toHaveBeenCalledTimes(1);
    });
  });
});
