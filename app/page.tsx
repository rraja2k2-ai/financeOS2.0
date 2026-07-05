import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex max-w-lg flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">FinanceOS</h1>
        <p className="text-muted-foreground text-lg">
          AI-first personal finance application
        </p>
      </div>
      <Button variant="outline" disabled>
        Foundation ready
      </Button>
    </main>
  );
}
