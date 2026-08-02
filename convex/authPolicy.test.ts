import { canCreateFixedAccount } from "./authPolicy";

describe("canCreateFixedAccount", () => {
  it("allows sign-up only when the development bootstrap flag is enabled", () => {
    expect(canCreateFixedAccount("signUp", "true")).toBe(true);
    expect(canCreateFixedAccount("signUp", undefined)).toBe(false);
    expect(canCreateFixedAccount("signUp", "false")).toBe(false);
  });

  it("does not treat normal sign-in as account creation", () => {
    expect(canCreateFixedAccount("signIn", "true")).toBe(false);
  });
});
