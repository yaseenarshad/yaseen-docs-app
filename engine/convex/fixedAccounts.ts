const FIXED_ACCOUNTS = {
  trevor: {
    email: "trevor@draw.local",
    username: "trevor",
  },
  yaseen: {
    email: "yaseen@draw.local",
    username: "yaseen",
  },
} as const;

export type FixedUsername = keyof typeof FIXED_ACCOUNTS;

export const getFixedAccount = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }
  const username = value.trim().toLowerCase() as FixedUsername;
  return FIXED_ACCOUNTS[username] ?? null;
};

export const fixedAccounts = Object.values(FIXED_ACCOUNTS);
