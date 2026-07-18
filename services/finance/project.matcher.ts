/**
 * Project Matcher (TAD-004 §3 Finance Services).
 *
 * Deterministic, no AI. Resolves a free-text project suggestion to a real Project.
 * Unlike accounts, an unmatched project is NOT left null — it defaults to "Generic"
 * (TAD-009 §3: "if none is supplied, the Generic project is assigned"), since every
 * budget belongs to a project and Generic is where regular day-to-day spend lives.
 */
import type { Project } from "@/domain/project";

export type ProjectMatchResult = {
  project: Project | null;
  note: string | null;
};

const GENERIC_PROJECT_NAME = "Generic";

export function matchProject(candidateText: string | null, projects: Project[]): ProjectMatchResult {
  const generic = projects.find((p) => normalize(p.project_name) === normalize(GENERIC_PROJECT_NAME)) ?? null;

  if (!candidateText || !candidateText.trim()) {
    return { project: generic, note: generic ? null : `No "${GENERIC_PROJECT_NAME}" project found in this workspace.` };
  }

  const needle = normalize(candidateText);

  const exact = projects.find((p) => normalize(p.project_name) === needle);
  if (exact) return { project: exact, note: null };

  const substring = projects.find(
    (p) => normalize(p.project_name).includes(needle) || needle.includes(normalize(p.project_name))
  );
  if (substring) return { project: substring, note: null };

  return {
    project: generic,
    note: `Could not match project for "${candidateText}" — defaulted to ${GENERIC_PROJECT_NAME}.`,
  };
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
