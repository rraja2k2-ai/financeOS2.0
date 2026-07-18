import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";

const PIPELINE_STEPS = [
  { label: "OCR", detail: "Google Cloud Vision reads text off the receipt image." },
  { label: "Extract + Classify", detail: "Gemini 2.5 Flash turns the raw OCR text into structured line items and categories in a single call." },
  { label: "Save", detail: "Header, items, and attachment are saved atomically." },
];

export default function AiSettingsPage() {
  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader title="AI" />

      <section className="mb-6">
        <p className="mb-2.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Capture pipeline</p>
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.label} className={`p-4 ${i > 0 ? "border-t border-border" : ""}`}>
              <p className="text-[13.5px] font-bold">
                {i + 1}. {step.label}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{step.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="rounded-[var(--radius-md)] border border-dashed border-border p-3.5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
        No configurable AI settings yet — model, quota, and prompt tuning aren&apos;t exposed here.
      </p>
    </div>
  );
}
