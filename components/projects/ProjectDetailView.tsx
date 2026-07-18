"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  updateProjectAction,
  setProjectStatusAction,
  deleteProjectAction,
  saveProjectCategoryBudgetAction,
} from "@/app/projects/actions";
import { ProjectForm, type ProjectFormValues } from "@/components/projects/ProjectForm";
import { isGenericProject } from "@/domain/project";
import type { Project, ProjectStatus } from "@/domain/project";
import type { ProjectDetail, ProjectCategorySummary, ProjectCategoryTransaction } from "@/services/finance/project.service";

function fmt(n: number, decimals = 0) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function barColor(pct: number | null): string {
  if (pct === null) return "bg-muted-foreground";
  if (pct >= 100) return "bg-destructive";
  if (pct >= 80) return "bg-amber";
  return "bg-primary";
}

export function ProjectDetailView({ project, detail }: { project: Project; detail: ProjectDetail }) {
  const generic = isGenericProject(project);
  const isFixed = project.budget_type === "Fixed";

  const [editing, setEditing] = useState(false);

  return (
    <div className="px-5 pt-6 pb-8">
      <div className="mb-4 flex items-center gap-2">
        <Link href="/projects" aria-label="Back to Projects" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="flex-1 truncate text-[19px] font-bold tracking-tight">{project.project_name}</h1>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-semibold">
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <EditSection project={project} onDone={() => setEditing(false)} />
      ) : (
        <>
          {project.description && <p className="mb-4 text-[12.5px] leading-relaxed text-muted-foreground">{project.description}</p>}

          <SummarySection project={project} detail={detail} isFixed={isFixed} />

          <CategorySummarySection
            projectId={project.id}
            currency={project.budget_currency ?? "SGD"}
            categories={detail.categories}
            transactionsByCategory={detail.transactionsByCategory}
            isFixed={isFixed}
          />

          <PlaceholderSection title="Timeline" note="Project timeline & duration view — coming soon." />
          <PlaceholderSection title="AI Insights" note="AI-generated spending insights — coming soon." />

          {!generic && <DangerZone project={project} />}
        </>
      )}
    </div>
  );
}

function SummarySection({ project, detail, isFixed }: { project: Project; detail: ProjectDetail; isFixed: boolean }) {
  const { analytics } = detail;
  const rows: { label: string; value: string }[] = [
    { label: "Status", value: project.status },
    { label: "Start date", value: project.start_date ?? "—" },
    { label: "End date", value: project.end_date ?? "—" },
    { label: "Budget type", value: isFixed ? "Fixed budget" : "Track only" },
  ];
  if (isFixed) {
    rows.push(
      { label: "Budget", value: `SGD ${fmt(analytics.totalBudgetSgd)}` },
      { label: "Actual spending", value: `SGD ${fmt(analytics.totalSpentSgd)}` },
      { label: analytics.remainingSgd >= 0 ? "Remaining" : "Overspent", value: `SGD ${fmt(Math.abs(analytics.remainingSgd))}` },
      { label: "Utilization", value: analytics.utilizationPct === null ? "—" : `${analytics.utilizationPct}%` }
    );
  } else {
    rows.push({ label: "Actual spending", value: `SGD ${fmt(analytics.totalSpentSgd)}` });
  }
  rows.push(
    { label: "Transactions", value: String(analytics.transactionCount) },
    { label: "Categories used", value: String(analytics.categoriesUsed) }
  );

  return (
    <section className="mb-6">
      <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Project summary</p>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border">
        {rows.map((r) => (
          <div key={r.label} className="bg-card p-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{r.label}</p>
            <p className={cn("mt-0.5 font-mono text-[14px] font-bold tabular-nums", r.label === "Overspent" && "text-destructive")}>{r.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CategorySummarySection({
  projectId,
  currency,
  categories,
  transactionsByCategory,
  isFixed,
}: {
  projectId: string;
  currency: string;
  categories: ProjectCategorySummary[];
  transactionsByCategory: Record<string, ProjectCategoryTransaction[]>;
  isFixed: boolean;
}) {
  return (
    <section className="mb-6">
      <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Category summary</p>

      {categories.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          No spending or budgets in this project yet.
        </div>
      ) : (
        <div className="space-y-2.5">
          {categories.map((cat) => (
            <CategoryCard
              key={cat.primaryCategory}
              projectId={projectId}
              currency={currency}
              cat={cat}
              transactions={transactionsByCategory[cat.primaryCategory] ?? []}
              isFixed={isFixed}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryCard({
  projectId,
  currency,
  cat,
  transactions,
  isFixed,
}: {
  projectId: string;
  currency: string;
  cat: ProjectCategorySummary;
  transactions: ProjectCategoryTransaction[];
  isFixed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [draft, setDraft] = useState(cat.budgetSgd > 0 ? String(cat.budgetSgd) : "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const pct = cat.budgetSgd > 0 ? Math.round((cat.spentSgd / cat.budgetSgd) * 100) : null;
  const over = cat.budgetSgd > 0 && cat.spentSgd > cat.budgetSgd;

  function saveBudget() {
    const amount = Number(draft);
    if (draft !== "" && (Number.isNaN(amount) || amount < 0)) return;
    startTransition(async () => {
      await saveProjectCategoryBudgetAction({
        budgetLineId: cat.budgetLineId,
        projectId,
        primaryCategory: cat.primaryCategory,
        currency,
        amount: draft === "" ? 0 : amount,
      });
      setEditingBudget(false);
      router.refresh();
    });
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-3.5">
      <button className="flex w-full items-baseline justify-between text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
          {cat.primaryCategory}
          {over && (
            <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-destructive">Over</span>
          )}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={cn("text-muted-foreground transition-transform duration-300", open && "rotate-180")}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
        <span className="text-right font-mono text-[12.5px] font-semibold tabular-nums text-muted-foreground">
          {fmt(cat.spentSgd)}{isFixed ? ` / ${cat.budgetSgd > 0 ? fmt(cat.budgetSgd) : "—"}` : ""}
        </span>
      </button>

      {isFixed && (
        <>
          <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full", barColor(pct))} style={{ width: pct === null ? "0%" : `${Math.min(100, Math.max(4, pct))}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              {cat.budgetSgd > 0
                ? cat.remainingSgd >= 0
                  ? `SGD ${fmt(cat.remainingSgd)} remaining`
                  : `SGD ${fmt(Math.abs(cat.remainingSgd))} over`
                : "No budget set"}
            </p>
            {editingBudget ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10.5px] text-muted-foreground">{currency}</span>
                <input
                  type="number" inputMode="decimal" step="0.01" min="0" autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-20 rounded-md border border-border bg-background px-1.5 py-0.5 text-right font-mono text-[12px] tabular-nums outline-none focus:border-primary"
                />
                <button type="button" onClick={saveBudget} disabled={pending} className="text-[11px] font-semibold text-primary disabled:opacity-50">
                  {pending ? "…" : "Save"}
                </button>
                <button type="button" onClick={() => setEditingBudget(false)} className="text-[11px] font-semibold text-muted-foreground">
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setEditingBudget(true)} className="text-[11px] font-semibold text-primary underline decoration-dotted">
                {cat.budgetSgd > 0 ? "Edit budget" : "Set budget"}
              </button>
            )}
          </div>
        </>
      )}

      <div className="grid transition-[grid-template-rows] duration-300 ease-in-out" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className="mt-2.5 space-y-1">
            {transactions.length === 0 ? (
              <p className="border-l-2 border-border py-1 pl-3 text-[11.5px] text-muted-foreground">No transactions.</p>
            ) : (
              transactions.map((t) => (
                <Link
                  key={t.id}
                  href={`/activity?highlight=${t.id}`}
                  className="flex items-center justify-between gap-2 border-l-2 border-border py-1 pl-3 text-[12px]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t.merchant ?? "—"}</span>
                    <span className="block text-[10.5px] text-muted-foreground">{t.transactionDate}</span>
                  </span>
                  <span className="flex-none text-right font-mono font-semibold tabular-nums">
                    {t.currency === "SGD" ? `SGD ${fmt(t.originalAmount, 2)}` : `SGD ${fmt(t.sgdAmount, 2)}`}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EditSection({ project, onDone }: { project: Project; onDone: () => void }) {
  const generic = isGenericProject(project);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(values: ProjectFormValues) {
    setError(null);
    startTransition(async () => {
      try {
        await updateProjectAction(project.id, {
          projectName: values.projectName,
          description: values.description,
          startDate: values.startDate,
          endDate: values.endDate,
          budgetType: values.budgetType,
          budgetCurrency: values.budgetCurrency,
        });
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
      <p className="mb-3 text-[13px] font-bold">Edit project</p>
      <ProjectForm
        submitLabel="Save changes"
        pending={pending}
        nameLocked={generic}
        initial={{
          projectName: project.project_name,
          description: project.description ?? "",
          startDate: project.start_date ?? "",
          endDate: project.end_date ?? "",
          budgetType: project.budget_type === "Fixed" ? "Fixed" : "Track Only",
          budgetCurrency: project.budget_currency ?? "SGD",
        }}
        onSubmit={handleSubmit}
        onCancel={onDone}
      />
      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
    </div>
  );
}

function DangerZone({ project }: { project: Project }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus: ProjectStatus = project.status === "Active" ? "Inactive" : "Active";

  function toggleStatus() {
    setError(null);
    startTransition(async () => {
      try {
        await setProjectStatusAction(project.id, nextStatus);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update status.");
      }
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteProjectAction(project.id);
        router.push("/projects");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not delete.");
        setConfirmingDelete(false);
      }
    });
  }

  return (
    <section className="mt-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={toggleStatus}
          disabled={pending}
          className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50"
        >
          {nextStatus === "Inactive" ? "Mark inactive" : "Reactivate"}
        </button>

        {confirmingDelete ? (
          <>
            <span className="text-[11.5px] text-muted-foreground">Delete this project?</span>
            <button type="button" onClick={handleDelete} disabled={pending} className="rounded-lg bg-destructive px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
              {pending ? "…" : "Confirm delete"}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-semibold">
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirmingDelete(true)} className="text-[12px] font-semibold text-destructive underline decoration-dotted">
            Delete project
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
    </section>
  );
}

function PlaceholderSection({ title, note }: { title: string; note: string }) {
  return (
    <section className="mb-4">
      <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-5 text-center text-[11.5px] text-muted-foreground">{note}</div>
    </section>
  );
}
