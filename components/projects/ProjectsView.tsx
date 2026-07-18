"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createProjectAction } from "@/app/projects/actions";
import { ProjectForm, type ProjectFormValues } from "@/components/projects/ProjectForm";
import type { ProjectSummary } from "@/services/finance/project.service";

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex items-center gap-2 text-[12px] font-semibold text-muted-foreground"
      aria-pressed={on}
    >
      <span className={cn("relative h-4 w-7 rounded-full transition-colors", on ? "bg-primary" : "bg-secondary")}>
        <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-card transition-all", on ? "left-3.5" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

export function ProjectsView({ summaries }: { summaries: ProjectSummary[] }) {
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const [showGeneric, setShowGeneric] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const visible = summaries.filter(({ project }) => {
    if (project.project_name === "Generic" && !showGeneric) return false;
    if (project.status === "Inactive" && !showInactive) return false;
    return true;
  });

  function handleCreate(values: ProjectFormValues) {
    setError(null);
    startTransition(async () => {
      try {
        const id = await createProjectAction({
          projectName: values.projectName,
          description: values.description,
          startDate: values.startDate,
          endDate: values.endDate,
          budgetType: values.budgetType,
          budgetCurrency: values.budgetCurrency,
        });
        setCreating(false);
        router.push(`/projects/${id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create project.");
      }
    });
  }

  return (
    <div className="px-5 pt-6 pb-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-[22px] font-bold tracking-tight">Projects</h1>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground"
        >
          {creating ? "Close" : "+ New"}
        </button>
      </div>

      {creating && (
        <div className="mb-5 rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <p className="mb-3 text-[13px] font-bold">New project</p>
          <ProjectForm submitLabel="Create project" pending={pending} onSubmit={handleCreate} onCancel={() => setCreating(false)} />
          {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
        </div>
      )}

      <div className="mb-4 flex items-center gap-4">
        <Toggle label="Show inactive" on={showInactive} onChange={setShowInactive} />
        <Toggle label="Show Generic" on={showGeneric} onChange={setShowGeneric} />
      </div>

      {visible.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          No projects to show. Create one, or enable a toggle above.
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.map(({ project, analytics }) => {
            const isGeneric = project.project_name === "Generic";
            const isFixed = project.budget_type === "Fixed";
            const util = analytics.utilizationPct;
            const over = util !== null && util >= 100;
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-[var(--radius-lg)] border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[14.5px] font-bold">
                      {project.project_name}
                      {isGeneric && (
                        <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                          System
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {project.status} · {isFixed ? "Fixed budget" : "Track only"} · {analytics.transactionCount} txn{analytics.transactionCount === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      project.status === "Active" ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground"
                    )}
                  >
                    {project.status}
                  </span>
                </div>

                {isFixed && analytics.totalBudgetSgd > 0 ? (
                  <>
                    <div className="mt-3 h-[6px] overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn("h-full rounded-full", over ? "bg-destructive" : util !== null && util >= 80 ? "bg-amber" : "bg-primary")}
                        style={{ width: util === null ? "0%" : `${Math.min(100, Math.max(4, util))}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                      SGD {fmt(analytics.totalSpentSgd)} spent of {fmt(analytics.totalBudgetSgd)} · {util ?? "—"}%
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-[11.5px] text-muted-foreground">SGD {fmt(analytics.totalSpentSgd)} spent</p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
