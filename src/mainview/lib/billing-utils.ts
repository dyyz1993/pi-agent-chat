/**
 * Checks whether an error message indicates a billing / insufficient-balance
 * problem that should be treated specially (e.g. show "switch model & retry").
 */
export function isBillingErrorMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /insufficient[_ ]?balance|quota.?exceeded|billing|out.?of.?budget|\b402\b|available.?balance|insufficient_quota/i.test(
    message,
  );
}
