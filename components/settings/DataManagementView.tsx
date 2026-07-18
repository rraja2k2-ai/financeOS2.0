"use client";

import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";

type Group = {
  title: string;
  items: string[];
};

const GROUPS: Group[] = [
  { title: "Export", items: ["Transactions CSV", "Budgets CSV", "Accounts CSV", "Full Backup (JSON)"] },
  { title: "Reports", items: ["Monthly Report (PDF)", "Net Worth Report (PDF)"] },
  { title: "Import", items: ["Restore Backup", "Import CSV"] },
];

export function DataManagementView() {
  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader title="Data Management" />

      {GROUPS.map((group) => (
        <section key={group.title} className="mb-6">
          <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">{group.title}</p>
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
            {group.items.map((item, i) => (
              <button
                key={item}
                type="button"
                disabled
                title="Coming soon"
                className={`flex w-full items-center justify-between p-4 text-left opacity-50 ${i > 0 ? "border-t border-border" : ""}`}
              >
                <span className="text-[14px] font-semibold">{item}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary-foreground">
                  Soon
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <p className="rounded-[var(--radius-md)] border border-dashed border-border p-3.5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
        Placeholders only — no export, report, or import logic is wired up yet.
      </p>
    </div>
  );
}
