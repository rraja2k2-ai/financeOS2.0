/**
 * Generic, throwaway-simple stage-timing utility for performance profiling logs. No
 * domain knowledge, no persistence — console-only, for a profiling pass (Capture
 * performance profiling). Not a metrics/observability platform; deliberately minimal per
 * CLAUDE.md's "no speculative complexity."
 */
export type StageTimer = {
  /** Times an async function and records its duration under `label`. Returns fn's result untouched. */
  time<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** Records an already-measured duration — for stages that can't be wrapped in `.time()` (e.g. a loop with early returns from the enclosing function). */
  mark(label: string, ms: number): void;
  /** Prints every recorded stage, in recording order, plus the total elapsed since the timer was created. */
  report(title: string): void;
};

export function createStageTimer(): StageTimer {
  const stages: { label: string; ms: number }[] = [];
  const start = performance.now();

  return {
    async time(label, fn) {
      const t0 = performance.now();
      try {
        return await fn();
      } finally {
        stages.push({ label, ms: performance.now() - t0 });
      }
    },
    mark(label, ms) {
      stages.push({ label, ms });
    },
    report(title) {
      const total = performance.now() - start;
      const width = Math.max(...stages.map((s) => s.label.length), "TOTAL CAPTURE TIME".length) + 2;
      const lines = stages.map((s) => formatStage(s.label, s.ms, width));
      lines.push(formatStage("TOTAL CAPTURE TIME", total, width));
      console.log(`\n${title}\n${lines.join("\n")}\n`);
    },
  };
}

function formatStage(label: string, ms: number, width: number): string {
  const dots = ".".repeat(Math.max(3, width - label.length));
  return `${label} ${dots} ${Math.round(ms).toLocaleString("en-US")} ms`;
}
