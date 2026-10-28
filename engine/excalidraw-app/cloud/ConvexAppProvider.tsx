import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../convex/_generated/api";

import { CloudLoginGate } from "./CloudAccount";
import { CloudProfileContext } from "./CloudProfileContext";

import type { ReactNode } from "react";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is required");
}

const convex = new ConvexReactClient(convexUrl);

const AnonymousSession = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn } = useAuthActions();
  const signInStarted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const isSharedRoute = /^\/s\/[^/]+\/?$/.test(window.location.pathname);
  const account = useQuery(api.account.current, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (
      !isSharedRoute ||
      isLoading ||
      isAuthenticated ||
      signInStarted.current
    ) {
      return;
    }
    signInStarted.current = true;
    void signIn("anonymous").catch((cause) => {
      signInStarted.current = false;
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start cloud session",
      );
    });
  }, [isAuthenticated, isLoading, isSharedRoute, signIn]);

  if (error) {
    return (
      <div className="cloud-bootstrap cloud-bootstrap--error">
        <strong>Cloud connection failed</strong>
        <span>{error}</span>
        <button
          type="button"
          onClick={() => {
            setError(null);
            signInStarted.current = false;
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading || (isSharedRoute && !isAuthenticated)) {
    return (
      <div className="cloud-bootstrap">
        <span className="cloud-bootstrap__spinner" />
        Connecting your canvas…
      </div>
    );
  }

  if (!isAuthenticated || (account?.isAnonymous && !isSharedRoute)) {
    return (
      <CloudLoginGate
        allowAccountCreation={import.meta.env.MODE === "development"}
        onAuthenticate={async ({ username, password, flow }) => {
          await signIn("password", { username, password, flow });
        }}
      />
    );
  }

  if (account === undefined) {
    return (
      <div className="cloud-bootstrap">
        <span className="cloud-bootstrap__spinner" />
        Opening your profile…
      </div>
    );
  }

  return (
    <CloudProfileContext.Provider value={account?.username ?? null}>
      {children}
    </CloudProfileContext.Provider>
  );
};

export const ConvexAppProvider = ({ children }: { children: ReactNode }) => (
  <ConvexAuthProvider client={convex}>
    <AnonymousSession>{children}</AnonymousSession>
  </ConvexAuthProvider>
);
