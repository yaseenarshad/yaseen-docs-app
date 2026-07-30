import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";

type AuthenticationRequest = {
  password: string;
  username: string;
  flow: "signIn";
};

const profileNames = {
  yaseen: "Yaseen",
  trevor: "Trevor",
} as const;

export const CloudLoginGate = ({
  onAuthenticate,
}: {
  onAuthenticate: (request: AuthenticationRequest) => Promise<void>;
}) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="cloud-login">
      <section className="cloud-login__card">
        <span className="cloud-account__eyebrow">DRAW.YASEENARSHAD.COM</span>
        <h1>Sign in to your boards</h1>
        <p>Enter your username and password.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setIsWorking(true);
            void onAuthenticate({
              username: username.trim().toLowerCase(),
              password,
              flow: "signIn",
            })
              .catch(() => {
                setError("The username or password was incorrect.");
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
            {isWorking ? "Opening…" : "Open boards"}
          </button>
        </form>
      </section>
    </main>
  );
};

export const CloudProfile = ({
  username,
  onSignOut,
}: {
  username: string;
  onSignOut: () => Promise<void>;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const displayName =
    profileNames[username as keyof typeof profileNames] ?? username;

  return (
    <div className="cloud-account">
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
      {isOpen && (
        <div className="cloud-account__menu">
          <strong>{displayName}</strong>
          <span>Your boards follow this profile.</span>
          <button
            type="button"
            onClick={() => {
              setIsWorking(true);
              void onSignOut().finally(() => setIsWorking(false));
            }}
            disabled={isWorking}
          >
            {isWorking ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
};

const goHome = () => {
  window.history.pushState({}, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export const CloudAccount = () => {
  const account = useQuery(api.account.current, {});
  const { signOut } = useAuthActions();

  if (!account || account.isAnonymous || !account.username) {
    return null;
  }

  return (
    <CloudProfile
      username={account.username}
      onSignOut={async () => {
        await signOut();
        goHome();
      }}
    />
  );
};
