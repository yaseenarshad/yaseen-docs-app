export const canCreateFixedAccount = (
  flow: unknown,
  allowDevAccountCreation: string | undefined,
) => flow === "signUp" && allowDevAccountCreation === "true";
