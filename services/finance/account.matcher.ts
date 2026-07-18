/**
 * Account Matcher (TAD-004 §3 Finance Services).
 *
 * Deterministic, no AI. Resolves the AI's free-text suggestion (never an id — TAD-005
 * §15) to a real Account by name. Never guesses: an ambiguous or absent match returns
 * null rather than picking "close enough," matching TAD-005's "suggest, do not decide."
 */
import type { Account } from "@/domain/account";

export type AccountMatchResult = {
  account: Account | null;
  /** Why nothing matched, or how confident the match is — surfaced as a Review warning. */
  note: string | null;
};

export function matchAccount(candidateText: string | null, accounts: Account[]): AccountMatchResult {
  if (!candidateText || !candidateText.trim()) {
    return { account: null, note: null };
  }

  const needle = normalize(candidateText);

  // 1. Exact name match (case/space-insensitive).
  const exact = accounts.find((a) => normalize(a.account_name) === needle);
  if (exact) return { account: exact, note: null };

  // 2. One name fully contains the other (e.g. "POSB" inside "POSB Bank").
  const substring = accounts.find(
    (a) => normalize(a.account_name).includes(needle) || needle.includes(normalize(a.account_name))
  );
  if (substring) return { account: substring, note: null };

  // 3. Token overlap (e.g. "Mari credit card" vs account "Mari Credit Card") — already
  //    covered by 1/2 with normalization, so this catches partial multi-word overlap
  //    like "posb savings" matching "POSB Bank" only weakly; require >=1 shared token
  //    of length >= 3 to avoid noise matches, and only accept if exactly one candidate.
  const needleTokens = needle.split(" ").filter((t) => t.length >= 3);
  const tokenMatches = accounts.filter((a) => {
    const nameTokens = normalize(a.account_name).split(" ");
    return needleTokens.some((t) => nameTokens.includes(t));
  });
  if (tokenMatches.length === 1) {
    return { account: tokenMatches[0], note: null };
  }
  if (tokenMatches.length > 1) {
    return {
      account: null,
      note: `"${candidateText}" matched multiple accounts (${tokenMatches.map((a) => a.account_name).join(", ")}) — needs manual selection.`,
    };
  }

  return { account: null, note: `Could not match account for "${candidateText}" — needs manual selection.` };
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
