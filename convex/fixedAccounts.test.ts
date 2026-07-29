import { getFixedAccount } from "./fixedAccounts";

describe("getFixedAccount", () => {
  it("normalizes the two configured usernames", () => {
    expect(getFixedAccount(" YASEEN ")).toEqual({
      email: "yaseen@draw.local",
      username: "yaseen",
    });
    expect(getFixedAccount("Trevor")).toEqual({
      email: "trevor@draw.local",
      username: "trevor",
    });
  });

  it("rejects every other username", () => {
    expect(getFixedAccount("visitor")).toBeNull();
  });
});
