import { cn } from "@/lib/utils";

interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function GlassPanel({ children, className, ...props }: GlassPanelProps) {
  return (
    <div className={cn("glass-panel rounded-xl p-4", className)} {...props}>
      {children}
    </div>
  );
}
