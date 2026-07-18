/**
 * Loads versioned prompt markdown from prompts/ (TAD-005 §12) and splits it into a
 * system instruction and a user prompt, with {{VAR}} substitution.
 *
 * Convention: each prompt file has a `## System` section, then one or more further
 * `## ` sections that together form the user prompt. Everything before `## System`
 * (title, `version:` line) is ignored.
 *
 * NOTE (deployment): this reads .md files from disk relative to process.cwd(), which
 * works in local dev and in node scripts. Before deploying to Vercel, ensure the
 * prompts/ folder ships with the serverless bundle via next.config
 * `outputFileTracingIncludes` — loose .md files are not auto-traced.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type LoadedPrompt = {
  system: string;
  user: string;
};

export type PromptVars = Record<string, string>;

function promptPath(relPath: string): string {
  return join(process.cwd(), "prompts", relPath);
}

function substitute(text: string, vars: PromptVars): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

/**
 * @param relPath path under prompts/, e.g. "phase1/extract.md"
 */
export function loadPrompt(relPath: string, vars: PromptVars = {}): LoadedPrompt {
  const raw = readFileSync(promptPath(relPath), "utf8");

  const systemHeading = raw.indexOf("## System");
  if (systemHeading === -1) {
    throw new Error(`[FinanceOS] Prompt "${relPath}" is missing a "## System" section.`);
  }

  const afterSystem = raw.slice(systemHeading + "## System".length);
  const nextHeading = afterSystem.indexOf("\n## ");

  const system = (nextHeading === -1 ? afterSystem : afterSystem.slice(0, nextHeading)).trim();
  const user = nextHeading === -1 ? "" : afterSystem.slice(nextHeading).trim();

  return {
    system: substitute(system, vars),
    user: substitute(user, vars),
  };
}
