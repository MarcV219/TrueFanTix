type ExternalAccount = {
  id: string;
  object?: string;
  currency?: string | null;
  available_payout_methods?: string[] | null;
};

export function instantPayoutDestination(accounts: ExternalAccount[], currency: string) {
  const normalizedCurrency = currency.trim().toLowerCase();
  return accounts.find((account) =>
    account.currency?.toLowerCase() === normalizedCurrency &&
    account.available_payout_methods?.includes("instant")
  ) ?? null;
}

export function instantPayoutStatusLabel(eligible: boolean, hasExternalAccount: boolean) {
  if (eligible) return "INSTANT_READY" as const;
  if (hasExternalAccount) return "STANDARD_ONLY" as const;
  return "SETUP_REQUIRED" as const;
}
