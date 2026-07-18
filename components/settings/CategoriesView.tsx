import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";

type CategoryGroup = {
  primary: string;
  secondaries: string[];
};

export function CategoriesView({ categories }: { categories: CategoryGroup[] }) {
  return (
    <div className="px-5 pt-6 pb-8">
      <SettingsPageHeader title="Categories" />

      {categories.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border p-6 text-center text-[12.5px] text-muted-foreground">
          No categories found.
        </div>
      ) : (
        <div className="space-y-2.5">
          {categories.map((cat) => (
            <div key={cat.primary} className="rounded-[var(--radius-lg)] border border-border bg-card p-3.5">
              <p className="text-[13.5px] font-bold">{cat.primary}</p>
              {cat.secondaries.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cat.secondaries.map((sub) => (
                    <span key={sub} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                      {sub}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 rounded-[var(--radius-md)] border border-dashed border-border p-3.5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
        Read-only view derived from categorization rules. Editing isn&apos;t wired up yet.
      </p>
    </div>
  );
}
