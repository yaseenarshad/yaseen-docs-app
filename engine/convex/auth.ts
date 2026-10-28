import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";

import { env } from "./_generated/server";
import { canCreateFixedAccount } from "./authPolicy";
import { getFixedAccount } from "./fixedAccounts";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Anonymous,
    Password({
      profile: (params) => {
        const account = getFixedAccount(params.username);
        if (!account) {
          throw new Error("Unknown username");
        }
        if (
          params.flow === "signUp" &&
          !canCreateFixedAccount(params.flow, env.ALLOW_DEV_ACCOUNT_CREATION)
        ) {
          throw new Error("Account creation is disabled");
        }
        return {
          email: account.email,
          name: account.username,
        };
      },
    }),
  ],
});
