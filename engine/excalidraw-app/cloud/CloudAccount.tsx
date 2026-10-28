import { useAuthActions } from "@convex-dev/auth/react";
import { useCallback, useRef, useState } from "react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { DropdownMenuContentPropsContext } from "@excalidraw/excalidraw/components/dropdownMenu/common";
import { useOutsideClick } from "@excalidraw/excalidraw/hooks/useOutsideClick";

import { useCloudProfileUsername } from "./CloudProfileContext";

type AuthenticationRequest = {
  password: string;
  username: string;
  flow: "signIn" | "signUp";
};

const profileNames = {
  yaseen: "Yaseen",
  trevor: "Trevor",
} as const;

export const CloudLoginGate = ({
  allowAccountCreation = false,
  onAuthenticate,
}: {
  allowAccountCreation?: boolean;
  onAuthenticate: (request: AuthenticationRequest) => Promise<void>;
}) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [flow, setFlow] = useState<AuthenticationRequest["flow"]>("signIn");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCreatingAccount = flow === "signUp";

  return (
    <main className="cloud-login">
      <section className="cloud-login__card">
        <span className="cloud-account__eyebrow">DRAW.YASEENARSHAD.COM</span>
        <h1>
          {isCreatingAccount
            ? "Create your local account"
            : "Sign in to your boards"}
        </h1>
        <p>
          {isCreatingAccount
            ? "Choose a password for this development deployment."
            : "Enter your username and password."}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setIsWorking(true);
            void onAuthenticate({
              username: username.trim().toLowerCase(),
              password,
              flow,
            })
              .catch(() => {
                setError(
                  isCreatingAccount
                    ? "The local account could not be created."
                    : "The username or password was incorrect.",
                );
              })
              .finally(() => setIsWorking(false));
          }}
        >
          <label>
            Username
            <input
              type="text"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setError(null);
              }}
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
            />
          </label>
          {error && <div className="cloud-account__error">{error}</div>}
          <button type="submit" disabled={isWorking}>
            {isWorking
              ? isCreatingAccount
                ? "Creating…"
                : "Opening…"
              : isCreatingAccount
              ? "Create account"
              : "Open boards"}
          </button>
        </form>
        {allowAccountCreation && (
          <button
            className="cloud-login__mode-toggle"
            type="button"
            onClick={() => {
              setFlow(isCreatingAccount ? "signIn" : "signUp");
              setError(null);
            }}
          >
            {isCreatingAccount ? "Back to sign in" : "Create local account"}
          </button>
        )}
      </section>
    </main>
  );
};

export const CloudProfile = ({
  username,
  onSignOut,
  menuItems,
}: {
  username: string;
  onSignOut: () => Promise<void>;
  menuItems?: React.ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const displayName =
    profileNames[username as keyof typeof profileNames] ?? username;
  const closeMenu = useCallback(() => setIsOpen(false), []);

  useOutsideClick(accountRef, closeMenu);

  return (
    <DropdownMenuPrimitive.Root open={isOpen} modal={false}>
      <div className="cloud-account" ref={accountRef}>
        <DropdownMenuPrimitive.Trigger asChild>
          <button
            className="cloud-account__trigger"
            type="button"
            aria-label={`${displayName} profile`}
            aria-expanded={isOpen}
            onClick={() => setIsOpen((value) => !value)}
          >
            <span className="cloud-account__avatar" aria-hidden="true">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
          </button>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Content
          className="cloud-account__menu dropdown-menu"
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          data-prevent-outside-click
          onPointerDownOutside={() => setIsOpen(false)}
          onEscapeKeyDown={() => setIsOpen(false)}
        >
          <div className="dropdown-menu-container">
            <div className="cloud-account__identity">
              <strong>{displayName}</strong>
              <span>Your boards follow this profile.</span>
            </div>
            <DropdownMenuContentPropsContext.Provider
              value={{ onSelect: () => setIsOpen(false) }}
            >
              {menuItems}
            </DropdownMenuContentPropsContext.Provider>
            {menuItems && <div className="cloud-account__separator" />}
            <DropdownMenuPrimitive.Item asChild>
              <button
                className="cloud-account__sign-out"
                type="button"
                onClick={() => {
                  setIsWorking(true);
                  void onSignOut().finally(() => setIsWorking(false));
                }}
                disabled={isWorking}
              >
                {isWorking ? "Signing out…" : "Sign out"}
              </button>
            </DropdownMenuPrimitive.Item>
          </div>
        </DropdownMenuPrimitive.Content>
      </div>
    </DropdownMenuPrimitive.Root>
  );
};

const goHome = () => {
  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export const CloudAccount = ({
  menuItems,
}: {
  menuItems?: React.ReactNode;
}) => {
  const username = useCloudProfileUsername();
  const { signOut } = useAuthActions();

  if (!username) {
    return null;
  }

  return (
    <CloudProfile
      username={username}
      menuItems={menuItems}
      onSignOut={async () => {
        await signOut();
        goHome();
      }}
    />
  );
};
