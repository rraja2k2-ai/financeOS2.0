"use client";

import { useState } from "react";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { RETENTION_OPTIONS, type RetentionDays } from "@/services/finance/attachment-cleanup.service";
import { runAttachmentCleanupAction } from "@/app/settings/data-management/actions";

type Group = {
  title: string;
  items: string[];
};

const GROUPS: Group[] = [
  { title: "Export", items: ["Transactions CSV", "Budgets CSV", "Accounts CSV", "Full Backup (JSON)"] },
  { title: "Reports", items: ["Monthly Report (PDF)", "Net Worth Report (PDF)"] },
  { title: "Import", items: ["Restore Backup", "Import CSV"] },
];

/** "Never" is represented as `null` — the cleanup service treats it as a pure no-op
 *  (Attachment Management MVP: no separate "disabled" retention concept needed). */
const RETENTION_CHOICES: { label: string; value: RetentionDays | null }[] = [
  ...RETENTION_OPTIONS.map((days) => ({ label: `${days} days`, value: days })),
  { label: "Never", value: null },
];

function AttachmentCleanupSection() {
  const [retention, setRetention] = useState<RetentionDays | null>(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleRunCleanup() {
    setBusy(true);
    setMessage(null);
    const result = await runAttachmentCleanupAction(retention);
    setMessage(
      result.deletedCount === 0
        ? "No attachments were eligible for cleanup."
        : `Removed ${result.deletedCount} attachment file${result.deletedCount === 1 ? "" : "s"}.`
    );
    setBusy(false);
  }

  return (
    <section className="mb-6">
      <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Attachment Cleanup</p>
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
        <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
          Deletes original receipt files older than the retention period below. The transaction, its items, and every
          financial field are always kept — only the original file is removed, and never for an attachment marked
          Keep Attachment.
        </p>

        <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Retention Period</label>
        <select
          value={retention === null ? "never" : String(retention)}
          onChange={(e) => setRetention(e.target.value === "never" ? null : (Number(e.target.value) as RetentionDays))}
          disabled={busy}
          className="mb-3 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-[13.5px] font-semibold disabled:opacity-50"
        >
          {RETENTION_CHOICES.map((choice) => (
            <option key={choice.label} value={choice.value === null ? "never" : String(choice.value)}>
              {choice.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleRunCleanup}
          disabled={busy || retention === null}
          title={retention === null ? "Nothing is deleted while Never is selected." : undefined}
          className="w-full rounded-[var(--radius-md)] bg-primary py-2.5 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Running…" : "Run Cleanup Now"}
        </button>

        {message && <p className="mt-3 text-[12px] font-semibold text-foreground">{message}</p>}
      </div>
    </section>
  );
}

export function DataManagementView() {
  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader title="Data Management" />

      <AttachmentCleanupSection />

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
