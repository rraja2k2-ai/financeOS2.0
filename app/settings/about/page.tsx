import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";

export default function AboutSettingsPage() {
  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader title="About" />

      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
        <p className="text-[15px] font-bold">FinanceOS</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Version 2.0</p>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          AI-first personal finance tracker. Next.js, Supabase, Google Cloud Vision, and Gemini.
        </p>
      </div>
    </div>
  );
}
